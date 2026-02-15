/**
 * RAG 检索器
 *
 * 使用 text-embedding-v4 (DashScope) 将旋律特征向量化
 * 从 Hooktheory 片段库中检索最相似的和弦进行
 */

import OpenAI from 'openai';
import { readFileSync, existsSync } from 'fs';

/** 片段数据结构（与 hooktheory_phrases.json 对齐） */
export interface PhraseEntry {
  song_id: string;
  artist: string;
  song: string;
  mode: string;
  chord_sequence: string[];
  melody_intervals: number[];
  embedding?: number[];
}

/** 检索结果 */
export interface RetrievalResult {
  phrase: PhraseEntry;
  similarity: number;
}

/** DashScope 客户端配置 */
interface RAGConfig {
  apiKey: string;
  /** 片段数据路径 */
  phrasesPath?: string;
  /** 预计算的嵌入缓存路径 */
  embeddingCachePath?: string;
  /** 检索时返回的最大结果数 */
  topK?: number;
}

/**
 * 余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 将片段转为可嵌入的文本描述
 */
function phraseToText(phrase: PhraseEntry): string {
  const parts: string[] = [];
  parts.push(`mode:${phrase.mode}`);
  if (phrase.melody_intervals.length > 0) {
    const contour = phrase.melody_intervals.map(i =>
      i > 0 ? `+${i}` : i < 0 ? `${i}` : '0'
    ).join(',');
    parts.push(`intervals:[${contour}]`);
  }
  parts.push(`chords:[${phrase.chord_sequence.join(' ')}]`);
  return parts.join(' ');
}

/** Embedding 维度（text-embedding-v4） */
const EMBEDDING_DIM = 1024;

export class RAGRetriever {
  private client: OpenAI;
  private phrases: PhraseEntry[] = [];
  private phraseEmbeddings: number[][] = [];
  /** 二进制模式：用 Float32Array 存储，避免 number[][] 的 GC 压力 */
  private embeddingBuffer: Float32Array | null = null;
  private topK: number;
  private initialized = false;

  constructor(config: RAGConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    this.topK = config.topK ?? 5;
  }

  /**
   * 加载片段数据和预计算的 embedding
   *
   * 加载优先级:
   *   1. 二进制格式: phrase_meta.json + phrase_embeddings.bin（最快，推荐）
   *   2. JSON 格式:  phrase_embeddings.json（2.7GB，可能因 V8 字符串限制失败）
   *   3. 无 embedding: hooktheory_phrases.json（回退，检索时实时 embed，极慢）
   */
  loadPhrases(phrasesPath: string): void {
    const dataDir = phrasesPath.replace(/[/\\][^/\\]+$/, '');

    // 1. 尝试二进制格式（phrase_meta.json + phrase_embeddings.bin）
    const metaPath = `${dataDir}/phrase_meta.json`;
    const binPath = `${dataDir}/phrase_embeddings.bin`;
    if (existsSync(metaPath) && existsSync(binPath)) {
      try {
        const t0 = Date.now();
        this.phrases = JSON.parse(readFileSync(metaPath, 'utf-8'));
        const binBuf = readFileSync(binPath);
        this.embeddingBuffer = new Float32Array(
          binBuf.buffer, binBuf.byteOffset, binBuf.byteLength / 4
        );
        this.phraseEmbeddings = []; // 不再使用 number[][]
        const loadMs = Date.now() - t0;
        console.log(`Loaded ${this.phrases.length} phrases with binary embeddings (${loadMs}ms)`);
        this.initialized = true;
        return;
      } catch (err) {
        console.warn('Failed to load binary embeddings, falling back:', (err as Error).message);
      }
    }

    // 2. 尝试 JSON 格式（phrase_embeddings.json）
    const embeddingsPath = phrasesPath.replace('hooktheory_phrases.json', 'phrase_embeddings.json');
    if (existsSync(embeddingsPath)) {
      try {
        const raw = readFileSync(embeddingsPath, 'utf-8');
        const data = JSON.parse(raw);
        this.phrases = data.phrases;
        this.phraseEmbeddings = data.embeddings;
        this.embeddingBuffer = null;
        console.log(`Loaded ${this.phrases.length} phrases with precomputed embeddings (JSON)`);
        this.initialized = true;
        return;
      } catch (err) {
        console.warn('Failed to load JSON embeddings (file too large?), falling back:', (err as Error).message);
      }
    }

    // 3. 回退：加载纯片段数据（检索时需要实时 embed 候选片段）
    const raw = readFileSync(phrasesPath, 'utf-8');
    const allPhrases: PhraseEntry[] = JSON.parse(raw);
    this.phrases = allPhrases.filter(
      p => p.chord_sequence.length > 0 && p.melody_intervals.length > 0
    );
    this.phraseEmbeddings = [];
    this.embeddingBuffer = null;
    console.log(`Loaded ${this.phrases.length} phrases (no precomputed embeddings, will embed on-the-fly)`);
    this.initialized = true;
  }

  /**
   * 判断是否有预计算 embedding 可用
   */
  private hasPrecomputedEmbeddings(): boolean {
    return this.embeddingBuffer !== null || this.phraseEmbeddings.length > 0;
  }

  /**
   * 获取第 i 条 phrase 的 embedding（从 buffer 或 number[][] 中读取）
   */
  private getEmbeddingAt(i: number): number[] {
    if (this.embeddingBuffer) {
      const offset = i * EMBEDDING_DIM;
      // Float32Array.slice 返回新的 Float32Array，转为普通数组
      return Array.from(this.embeddingBuffer.subarray(offset, offset + EMBEDDING_DIM));
    }
    return this.phraseEmbeddings[i];
  }

  /**
   * 用 Float32Array 直接计算余弦相似度（避免创建中间数组）
   */
  private cosineSimilarityWithBuffer(queryEmb: number[], phraseIndex: number): number {
    if (this.embeddingBuffer) {
      const offset = phraseIndex * EMBEDDING_DIM;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        const a = queryEmb[i];
        const b = this.embeddingBuffer[offset + i];
        dot += a * b;
        normA += a * a;
        normB += b * b;
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    }
    return -1; // 不可用，调用方应回退到普通 cosineSimilarity
  }

  /**
   * 按模式和音程模式做快速预筛选
   */
  private preFilter(query: string, mode: string, maxCandidates: number = 200): { indices: number[]; phrases: PhraseEntry[]; embeddings: number[][] } {
    // 先按调式过滤
    const indices: number[] = [];
    for (let i = 0; i < this.phrases.length; i++) {
      if (this.phrases[i].mode === mode) {
        indices.push(i);
      }
    }

    let filtered = indices;

    // 如果候选太多且没有预计算 embedding，按旋律长度粗筛
    if (filtered.length > maxCandidates && !this.hasPrecomputedEmbeddings()) {
      const intervalMatch = query.match(/intervals:\[([^\]]*)\]/);
      const queryIntervalCount = intervalMatch
        ? intervalMatch[1].split(',').filter(s => s.length > 0).length
        : 0;

      filtered.sort((a, b) => {
        const diffA = Math.abs(this.phrases[a].melody_intervals.length - queryIntervalCount);
        const diffB = Math.abs(this.phrases[b].melody_intervals.length - queryIntervalCount);
        return diffA - diffB;
      });
      filtered = filtered.slice(0, maxCandidates);
    }

    return {
      indices: filtered,
      phrases: filtered.map(i => this.phrases[i]),
      embeddings: this.phraseEmbeddings.length > 0
        ? filtered.map(i => this.phraseEmbeddings[i])
        : [],
    };
  }

  /**
   * 调用 text-embedding-v4 获取嵌入向量
   */
  async getEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-v4',
      input: text,
    });
    return response.data[0].embedding;
  }

  /**
   * 批量获取嵌入向量
   */
  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const batchSize = 10;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await this.client.embeddings.create({
        model: 'text-embedding-v4',
        input: batch,
      });
      for (const item of response.data) {
        results.push(item.embedding);
      }
    }

    return results;
  }

  /**
   * 检索最相似的和弦进行片段
   *
   * 如果有预计算 embedding，只需 embed 查询文本（1 次 API 调用）
   * 否则回退到实时 embed 候选片段（多次 API 调用）
   */
  async retrieve(query: string, mode: string): Promise<RetrievalResult[]> {
    if (!this.initialized) {
      throw new Error('RAGRetriever not initialized. Call loadPhrases() first.');
    }

    // 1. 预筛选
    const { indices, phrases: candidates, embeddings: candidateEmbeddings } = this.preFilter(query, mode);
    if (candidates.length === 0) {
      return [];
    }

    // 2. 获取查询嵌入（始终只需 1 次 API 调用）
    const queryEmbedding = await this.getEmbedding(query);

    // 3. 计算相似度
    let results: RetrievalResult[];

    if (this.embeddingBuffer) {
      // 二进制模式：直接从 Float32Array 计算，零额外内存分配
      results = candidates.map((phrase, i) => ({
        phrase,
        similarity: this.cosineSimilarityWithBuffer(queryEmbedding, indices[i]),
      }));
    } else if (candidateEmbeddings.length > 0) {
      // JSON 预计算模式
      results = candidates.map((phrase, i) => ({
        phrase,
        similarity: cosineSimilarity(queryEmbedding, candidateEmbeddings[i]),
      }));
    } else {
      // 回退：实时 embed 候选片段
      const candidateTexts = candidates.map(phraseToText);
      const finalEmbeddings = await this.getEmbeddings(candidateTexts);
      results = candidates.map((phrase, i) => ({
        phrase,
        similarity: cosineSimilarity(queryEmbedding, finalEmbeddings[i]),
      }));
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, this.topK);
  }

  /**
   * 批量检索（多个查询）
   */
  async retrieveBatch(
    queries: string[],
    mode: string
  ): Promise<RetrievalResult[][]> {
    const results: RetrievalResult[][] = [];
    for (const query of queries) {
      const result = await this.retrieve(query, mode);
      results.push(result);
    }
    return results;
  }
}

