/**
 * 端到端和声分析管线
 *
 * MusicXML → 解析 → 调性分析 → 特征提取 → RAG检索 → LLM生成 → 写回Score
 */

import type { Score } from '../core/types.js';
import { parseMusicXML } from '../parser/musicxml-parser.js';
import { analyzeKeySegmented, formatKey } from '../analyzer/key-analyzer.js';
import { extractMelodyFeatures, featuresToSearchQueries } from './melody-features.js';
import { RAGRetriever } from './rag-retriever.js';
import { LLMHarmonizer, type AnnotatedRAGResult } from './llm-harmonizer.js';
import { loadTransitionMatrix, validateHarmonization, type ValidationAnomaly } from './chord-validator.js';
import { filterMeasureChords } from './difficulty-filter.js';

export type { ValidationAnomaly };

/** 管线配置 */
export interface PipelineConfig {
  /** DashScope API Key */
  apiKey: string;
  /** Hooktheory 片段数据路径 */
  phrasesPath: string;
  /** LLM 模型 */
  model?: string;
  /** 难度级别 */
  difficulty?: 'basic' | 'intermediate' | 'advanced';
  /** RAG 检索 top-K */
  topK?: number;
  /** 是否启用 RAG（可关闭以节省 API 调用） */
  enableRAG?: boolean;
  /** 转移概率矩阵路径 */
  transitionMatrixPath?: string;
  /** 转换概率异常阈值 */
  transitionThreshold?: number;
  /** 是否启用后处理验证 */
  enableValidation?: boolean;
}

/** 管线执行结果 */
export interface PipelineResult {
  /** 带和弦标注的 Score */
  score: Score;
  /** 调性分析结果 */
  keyAnalysis: {
    key: string;
    confidence: number;
    source: string;
    /** 转调信息 */
    modulations?: Array<{
      measureNumber: number;
      newKey: string;
      confidence: number;
    }>;
  };
  /** 执行统计 */
  stats: {
    totalMeasures: number;
    apiCalls: number;
    durationMs: number;
    /** 各阶段耗时明细 (ms) */
    stageTiming: {
      parseMs: number;
      keyAnalysisMs: number;
      featureExtractionMs: number;
      /** 每个 chunk 的处理耗时 (RAG + LLM) */
      chunks: Array<{ startMeasure: number; endMeasure: number; ragMs: number; llmMs: number; filterMs: number; totalMs: number }>;
      validationMs?: number;
    };
  };
  /** 验证统计 */
  validation?: {
    coveragePassRate: number;
    transitionPassRate: number;
    anomalyCount: number;
    anomalies: ValidationAnomaly[];
  };
  /** 难度过滤统计 */
  difficultyFilter?: {
    totalChords: number;
    replacedCount: number;
    replacements: Array<{ measure: number; original: string; replacement: string }>;
  };
}

export class HarmonizePipeline {
  private retriever: RAGRetriever | null = null;
  private harmonizer: LLMHarmonizer;
  private config: PipelineConfig;
  private transitionMatrix?: Record<string, Record<string, number>>;

  constructor(config: PipelineConfig) {
    this.config = config;

    // 初始化 LLM
    this.harmonizer = new LLMHarmonizer({
      apiKey: config.apiKey,
      model: config.model,
      difficulty: config.difficulty,
    });

    // 初始化 RAG（可选）
    if (config.enableRAG !== false) {
      this.retriever = new RAGRetriever({
        apiKey: config.apiKey,
        topK: config.topK ?? 5,
      });
      this.retriever.loadPhrases(config.phrasesPath);
    }

    // 加载转移概率矩阵（用于验证）
    if (config.transitionMatrixPath) {
      this.transitionMatrix = loadTransitionMatrix(config.transitionMatrixPath);
    }
  }

  /**
   * 从 MusicXML 字符串执行完整管线
   */
  async harmonizeFromXML(xml: string): Promise<PipelineResult> {
    const startTime = Date.now();
    let apiCalls = 0;

    // Stage timing
    const chunkTimings: Array<{ startMeasure: number; endMeasure: number; ragMs: number; llmMs: number; filterMs: number; totalMs: number }> = [];

    // 1. 解析 MusicXML
    const t1 = Date.now();
    const score = parseMusicXML(xml);
    const parseMs = Date.now() - t1;
    console.log(`[Pipeline] 解析完成: "${score.title}", ${score.measures.length} 小节 (${parseMs}ms)`);

    // 2. 分段调性分析
    const t2 = Date.now();
    const segmentedKey = analyzeKeySegmented(score);
    const keyResult = segmentedKey.initialKey;
    const keyAnalysisMs = Date.now() - t2;
    console.log(`[Pipeline] 调性: ${formatKey(keyResult.key)} (置信度: ${(keyResult.confidence * 100).toFixed(0)}%, 来源: ${keyResult.source}) (${keyAnalysisMs}ms)`);

    // 将转调信息写入 Score
    for (const mod of segmentedKey.modulations) {
      const measure = score.measures.find(m => m.number === mod.measureNumber);
      if (measure) measure.keyChange = mod.newKey;
    }
    if (segmentedKey.modulations.length > 0) {
      console.log(`[Pipeline] 检测到 ${segmentedKey.modulations.length} 个转调点`);
    }

    // 3. 特征提取
    const t3 = Date.now();
    const features = extractMelodyFeatures(score);
    const queries = featuresToSearchQueries(features);
    const featureExtractionMs = Date.now() - t3;
    console.log(`[Pipeline] 特征提取完成: ${queries.length} 个查询片段 (${featureExtractionMs}ms)`);

    // 4. 分块处理（每 4 小节一组调用 LLM）
    const chunkSize = 4;
    let previousChords: string[] = [];
    let totalFilteredChords = 0;
    let totalReplacedCount = 0;
    const allReplacements: Array<{ measure: number; original: string; replacement: string }> = [];

    for (let i = 0; i < score.measures.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, score.measures.length);
      const chunkStart = Date.now();
      console.log(`[Pipeline] 处理小节 ${i + 1}-${end}...`);

      // RAG 检索（带小节范围标注）
      const ragStart = Date.now();
      let annotatedResults: AnnotatedRAGResult[] = [];
      if (this.retriever) {
        const queryStart = Math.floor(i / 2);
        const queryEnd = Math.min(Math.ceil(end / 2), queries.length);
        for (let qi = queryStart; qi < queryEnd; qi++) {
          const results = await this.retriever.retrieve(queries[qi], features.mode);
          const measureRangeStart = qi * 2;
          const measureRangeEnd = Math.min(measureRangeStart + 2, score.measures.length);
          for (const r of results) {
            annotatedResults.push({
              result: r,
              measureRange: { start: measureRangeStart + 1, end: measureRangeEnd },
            });
          }
          apiCalls++;
        }
        // 去重并取 top-5
        const seen = new Set<string>();
        annotatedResults = annotatedResults.filter(ar => {
          const key = `${ar.result.phrase.song_id}-${ar.result.phrase.chord_sequence.join(',')}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 5);
      }
      const ragMs = Date.now() - ragStart;

      // LLM 生成（带上下文 + previousChords）
      const llmStart = Date.now();
      let measureChords = await this.harmonizer.harmonize(
        features, i, end, annotatedResults.map(ar => ar.result), previousChords
      );
      apiCalls++;
      const llmMs = Date.now() - llmStart;

      // 难度白名单过滤
      const filterStart = Date.now();
      if (this.config.difficulty && this.config.difficulty !== 'advanced') {
        const filterResult = filterMeasureChords(measureChords, this.config.difficulty);
        measureChords = filterResult.filtered;
        for (const rep of filterResult.replacements) {
          if (rep.wasReplaced && rep.original) {
            totalReplacedCount++;
            allReplacements.push({
              measure: i + 1,
              original: rep.original,
              replacement: rep.filtered,
            });
          }
        }
        totalFilteredChords += measureChords.reduce((sum, mc) => sum + mc.chords.length, 0);
      }
      const filterMs = Date.now() - filterStart;

      // 写入 Score
      this.harmonizer.applyToScore(score, measureChords);

      // 更新 previousChords（记录本分块最后 1-2 个和弦）
      if (measureChords.length > 0) {
        const lastMeasure = measureChords[measureChords.length - 1];
        previousChords = lastMeasure.chords.slice(-2);
      }

      const chunkTotalMs = Date.now() - chunkStart;
      chunkTimings.push({ startMeasure: i + 1, endMeasure: end, ragMs, llmMs, filterMs, totalMs: chunkTotalMs });
      console.log(`[Pipeline]   小节 ${i + 1}-${end}: RAG=${ragMs}ms LLM=${llmMs}ms Filter=${filterMs}ms Total=${chunkTotalMs}ms`);
    }

    // Validation timing
    let validationMs: number | undefined;
    const durationMs = Date.now() - startTime;
    console.log(`[Pipeline] 完成! 耗时 ${(durationMs / 1000).toFixed(1)}s, API调用 ${apiCalls} 次`);
    console.log(`[Pipeline] 阶段耗时: 解析=${parseMs}ms 调性分析=${keyAnalysisMs}ms 特征提取=${featureExtractionMs}ms`);

    // 构建结果
    const result: PipelineResult = {
      score,
      keyAnalysis: {
        key: formatKey(keyResult.key),
        confidence: keyResult.confidence,
        source: keyResult.source,
        modulations: segmentedKey.modulations.map(m => ({
          measureNumber: m.measureNumber,
          newKey: formatKey(m.newKey),
          confidence: m.confidence,
        })),
      },
      stats: {
        totalMeasures: score.measures.length,
        apiCalls,
        durationMs,
        stageTiming: {
          parseMs,
          keyAnalysisMs,
          featureExtractionMs,
          chunks: chunkTimings,
        },
      },
    };

    // 验证统计
    if (this.config.enableValidation !== false && this.transitionMatrix) {
      const valStart = Date.now();
      const finalValidation = validateHarmonization(score, this.transitionMatrix, this.config.transitionThreshold);
      result.stats.stageTiming.validationMs = Date.now() - valStart;
      result.validation = {
        coveragePassRate: finalValidation.coveragePassRate,
        transitionPassRate: finalValidation.transitionPassRate,
        anomalyCount: finalValidation.anomalies.length,
        anomalies: finalValidation.anomalies,
      };
    }

    // 难度过滤统计
    if (this.config.difficulty && this.config.difficulty !== 'advanced' && totalFilteredChords > 0) {
      result.difficultyFilter = {
        totalChords: totalFilteredChords,
        replacedCount: totalReplacedCount,
        replacements: allReplacements,
      };
    }

    return result;
  }


  /**
   * 从已解析的 Score 执行管线（跳过解析步骤）
   */
  async harmonizeScore(score: Score): Promise<PipelineResult> {
    const startTime = Date.now();
    let apiCalls = 0;

    // 分段调性分析（替代原来的单次分析）
    const segmentedKey = analyzeKeySegmented(score);
    const keyResult = segmentedKey.initialKey;

    // 将转调信息写入 Score
    for (const mod of segmentedKey.modulations) {
      const measure = score.measures.find(m => m.number === mod.measureNumber);
      if (measure) measure.keyChange = mod.newKey;
    }

    const features = extractMelodyFeatures(score);
    const queries = featuresToSearchQueries(features);

    const chunkSize = 4;
    let previousChords: string[] = [];
    let totalFilteredChords = 0;
    let totalReplacedCount = 0;
    const allReplacements: Array<{ measure: number; original: string; replacement: string }> = [];

    for (let i = 0; i < score.measures.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, score.measures.length);

      // RAG 检索（带小节范围标注）
      let annotatedResults: AnnotatedRAGResult[] = [];
      if (this.retriever) {
        const queryStart = Math.floor(i / 2);
        const queryEnd = Math.min(Math.ceil(end / 2), queries.length);
        for (let qi = queryStart; qi < queryEnd; qi++) {
          const results = await this.retriever.retrieve(queries[qi], features.mode);
          const measureRangeStart = qi * 2;
          const measureRangeEnd = Math.min(measureRangeStart + 2, score.measures.length);
          for (const r of results) {
            annotatedResults.push({
              result: r,
              measureRange: { start: measureRangeStart + 1, end: measureRangeEnd },
            });
          }
          apiCalls++;
        }
        // 去重并取 top-5
        const seen = new Set<string>();
        annotatedResults = annotatedResults.filter(ar => {
          const key = `${ar.result.phrase.song_id}-${ar.result.phrase.chord_sequence.join(',')}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 5);
      }

      // LLM 生成（带上下文 + previousChords）
      let measureChords = await this.harmonizer.harmonize(
        features, i, end, annotatedResults.map(ar => ar.result), previousChords
      );
      apiCalls++;

      // 难度白名单过滤
      if (this.config.difficulty && this.config.difficulty !== 'advanced') {
        const filterResult = filterMeasureChords(measureChords, this.config.difficulty);
        measureChords = filterResult.filtered;
        for (const rep of filterResult.replacements) {
          if (rep.wasReplaced && rep.original) {
            totalReplacedCount++;
            allReplacements.push({
              measure: i + 1,
              original: rep.original,
              replacement: rep.filtered,
            });
          }
        }
        totalFilteredChords += measureChords.reduce((sum, mc) => sum + mc.chords.length, 0);
      }

      // 写入 Score
      this.harmonizer.applyToScore(score, measureChords);

      // 更新 previousChords（记录本分块最后 1-2 个和弦）
      if (measureChords.length > 0) {
        const lastMeasure = measureChords[measureChords.length - 1];
        previousChords = lastMeasure.chords.slice(-2);
      }
    }

    // 构建结果
    const result: PipelineResult = {
      score,
      keyAnalysis: {
        key: formatKey(keyResult.key),
        confidence: keyResult.confidence,
        source: keyResult.source,
        modulations: segmentedKey.modulations.map(m => ({
          measureNumber: m.measureNumber,
          newKey: formatKey(m.newKey),
          confidence: m.confidence,
        })),
      },
      stats: {
        totalMeasures: score.measures.length,
        apiCalls,
        durationMs: Date.now() - startTime,
        stageTiming: {
          parseMs: 0, // Score was already parsed
          keyAnalysisMs: 0,
          featureExtractionMs: 0,
          chunks: [],
        },
      },
    };

    // 验证统计
    if (this.config.enableValidation !== false && this.transitionMatrix) {
      const finalValidation = validateHarmonization(score, this.transitionMatrix, this.config.transitionThreshold);
      result.validation = {
        coveragePassRate: finalValidation.coveragePassRate,
        transitionPassRate: finalValidation.transitionPassRate,
        anomalyCount: finalValidation.anomalies.length,
        anomalies: finalValidation.anomalies,
      };
    }

    // 难度过滤统计
    if (this.config.difficulty && this.config.difficulty !== 'advanced' && totalFilteredChords > 0) {
      result.difficultyFilter = {
        totalChords: totalFilteredChords,
        replacedCount: totalReplacedCount,
        replacements: allReplacements,
      };
    }

    return result;
  }
}
