/**
 * LLM 和弦生成器
 *
 * 使用 Qwen (DashScope) 根据旋律特征 + RAG 检索结果生成和弦方案
 */

import OpenAI from 'openai';
import type { Score, ChordSymbol, NoteLetter, Accidental, ChordQuality } from '../core/types.js';
import type { MelodyFeatures } from './melody-features.js';
import type { RetrievalResult } from './rag-retriever.js';
import { featuresToPromptDescription } from './melody-features.js';

/** 和弦生成配置 */
export interface HarmonizerConfig {
  apiKey: string;
  /** LLM 模型名称 */
  model?: string;
  /** 难度级别 */
  difficulty?: 'basic' | 'intermediate' | 'advanced';
}

/** 单个小节的和弦生成结果 */
export interface MeasureChords {
  measureNumber: number;
  chords: string[]; // RNA 格式，如 ["I", "V7"]
  /** 每个和弦的拍位置（LLM 输出，1-based），长度应与 chords 一致 */
  beats?: number[];
}

/** 带小节范围标注的 RAG 检索结果 */
export interface AnnotatedRAGResult {
  result: RetrievalResult;
  measureRange: { start: number; end: number };
}

/**
 * RNA 和弦符号 → ChordSymbol 转换
 * 需要知道当前调性才能将级数转为具体和弦
 */
function rnaToChordSymbol(
  rna: string,
  tonicSemitone: number,
  mode: string,
  beat: number
): ChordSymbol | null {
  // 大调音阶半音位置
  const majorScale = [0, 2, 4, 5, 7, 9, 11];
  const minorScale = [0, 2, 3, 5, 7, 8, 10];
  const scale = mode === 'minor' ? minorScale : majorScale;

  // 解析 RNA
  let cleaned = rna.trim();

  // 去掉转位标记
  cleaned = cleaned.replace(/\/\d+$/, '');

  // 提取级数和质量
  const degreeMap: Record<string, number> = {
    'I': 0, 'II': 1, 'III': 2, 'IV': 3, 'V': 4, 'VI': 5, 'VII': 6,
    'i': 0, 'ii': 1, 'iii': 2, 'iv': 3, 'v': 4, 'vi': 5, 'vii': 6,
  };

  // 检测升降号前缀
  let chromatic = 0;
  if (cleaned.startsWith('#')) {
    chromatic = 1;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('b')) {
    chromatic = -1;
    cleaned = cleaned.slice(1);
  }

  // 提取级数部分（罗马数字）
  // 大写: VII, VI, V, IV, III, II, I（从长到短匹配）
  // 小写: vii, vi, v, iv, iii, ii, i
  const romanMatch = cleaned.match(/^(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)/);
  if (!romanMatch || romanMatch[0].length === 0) return null;

  const romanStr = romanMatch[0];
  const suffix = cleaned.slice(romanStr.length);

  const degreeIndex = degreeMap[romanStr];
  if (degreeIndex === undefined) return null;

  // 计算根音半音
  const rootSemitone = (tonicSemitone + scale[degreeIndex] + chromatic + 12) % 12;

  // 半音 → 音名
  const semitoneToNote: { step: NoteLetter; accidental: Accidental }[] = [
    { step: 'C', accidental: 'none' },
    { step: 'C', accidental: 'sharp' },
    { step: 'D', accidental: 'none' },
    { step: 'E', accidental: 'flat' },
    { step: 'E', accidental: 'none' },
    { step: 'F', accidental: 'none' },
    { step: 'F', accidental: 'sharp' },
    { step: 'G', accidental: 'none' },
    { step: 'A', accidental: 'flat' },
    { step: 'A', accidental: 'none' },
    { step: 'B', accidental: 'flat' },
    { step: 'B', accidental: 'none' },
  ];

  const noteInfo = semitoneToNote[rootSemitone];

  // 判断和弦质量
  const isUpper = romanStr === romanStr.toUpperCase();
  let quality: ChordQuality = isUpper ? 'major' : 'minor';

  if (suffix.includes('°7') || suffix.includes('dim7')) {
    quality = 'diminished7';
  } else if (suffix.includes('ø7') || suffix.includes('hdim7')) {
    quality = 'half-dim7';
  } else if (suffix.includes('°') || suffix.includes('dim')) {
    quality = 'diminished';
  } else if (suffix.includes('+') || suffix.includes('aug')) {
    quality = 'augmented';
  } else if (suffix.includes('maj7')) {
    quality = 'major7';
  } else if (suffix.includes('7')) {
    quality = isUpper ? 'dominant7' : 'minor7';
  } else if (suffix.includes('sus4')) {
    quality = 'sus4';
  } else if (suffix.includes('sus2')) {
    quality = 'sus2';
  }

  return {
    root: noteInfo.step,
    rootAccidental: noteInfo.accidental,
    quality,
    beat,
  };
}

/** 构建系统 prompt */
function buildSystemPrompt(difficulty: string): string {
  const difficultyGuide = {
    basic: '只使用 I, IV, V, vi 这四个基本和弦。适合初学者伴奏。',
    intermediate: '可以使用顺阶七和弦（如 ii7, V7, IVmaj7）和常见替代和弦。',
    advanced: '可以使用离调和弦、借用和弦、挂留和弦等高级和声手法。',
  };

  return `你是一位专业的和声分析师和编曲师。你的任务是为给定的旋律配和弦。

规则：
1. 输出格式：每个小节一行，格式为 "小节号: 和弦1(拍位置) [和弦2(拍位置)]"
2. 拍位置从 1 开始，可以是小数（如 3.5 表示第三拍后半拍）
3. 使用罗马数字级数（RNA）标记：大写=大和弦，小写=小和弦
4. 每小节通常配 1-2 个和弦，4/4 拍中和弦通常在第 1 拍和第 3 拍
5. 和弦必须与旋律音协调（和弦音应包含强拍上的旋律音）
6. 和弦进行要自然流畅，遵循常见的功能和声逻辑
7. ${difficultyGuide[difficulty as keyof typeof difficultyGuide] || difficultyGuide.basic}

输出示例（4/4 拍，4 小节）：
1: I(1)
2: IV(1) V(3)
3: vi(1) IV(2.5)
4: V(1) I(3)

只输出和弦标记，不要解释。`;
}

/** 构建用户 prompt */
function buildUserPrompt(
  features: MelodyFeatures,
  measureStart: number,
  measureEnd: number,
  ragResults: AnnotatedRAGResult[],
  previousChords?: string[]
): string {
  const parts: string[] = [];

  // 前一段结尾和弦上下文（分块上下文传递）
  if (previousChords && previousChords.length > 0) {
    parts.push('=== 前一段结尾和弦 ===');
    parts.push(previousChords.join(' → '));
    parts.push('请确保和弦进行与上述结尾和弦自然衔接。\n');
  }

  // 旋律描述
  parts.push('=== 旋律信息 ===');
  parts.push(featuresToPromptDescription(features, measureStart, measureEnd));

  // RAG 参考（按小节范围分组展示）
  if (ragResults.length > 0) {
    parts.push('\n=== 参考和弦进行（来自相似旋律） ===');

    // 按 measureRange 分组
    const groups = new Map<string, AnnotatedRAGResult[]>();
    for (const ar of ragResults) {
      const key = `${ar.measureRange.start}-${ar.measureRange.end}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ar);
    }

    for (const [rangeKey, items] of groups) {
      parts.push(`小节 ${rangeKey} 的参考:`);
      for (let i = 0; i < Math.min(3, items.length); i++) {
        const r = items[i].result;
        parts.push(`  参考${i + 1} (${r.phrase.artist}/${r.phrase.song}, 相似度${(r.similarity * 100).toFixed(0)}%): ${r.phrase.chord_sequence.join(' → ')}`);
      }
    }
  }

  parts.push('\n请为上述旋律配和弦：');

  return parts.join('\n');
}



/** 解析 LLM 输出为结构化和弦数据 */
function parseLLMOutput(output: string): MeasureChords[] {
  const results: MeasureChords[] = [];
  const lines = output.trim().split('\n');

  // Regex to match chord with beat position, e.g. "I(1)" or "V7(3.5)" or "#iv(2)"
  const chordWithBeatRegex = /([#b]?[IiVv][IiVv]*[^(\s]*)\((\d+(?:\.\d+)?)\)/g;

  for (const line of lines) {
    const match = line.match(/^(\d+)\s*[:：]\s*(.+)$/);
    if (!match) continue;

    const measureNumber = parseInt(match[1]);
    const chordsStr = match[2].trim();

    // First, try to parse all chords with beat positions
    const withBeats: { chord: string; beat: number }[] = [];
    let m: RegExpExecArray | null;
    // Reset lastIndex before each line
    chordWithBeatRegex.lastIndex = 0;
    while ((m = chordWithBeatRegex.exec(chordsStr)) !== null) {
      withBeats.push({ chord: m[1], beat: parseFloat(m[2]) });
    }

    // Also parse chords without beat positions (old format)
    const plainChords = chordsStr
      .split(/[\s→\->]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && /^[#b]?[IiVv]/.test(s));

    if (withBeats.length > 0 && withBeats.length === plainChords.length) {
      // ALL chords have beat positions → use beats
      results.push({
        measureNumber,
        chords: withBeats.map(wb => wb.chord),
        beats: withBeats.map(wb => wb.beat),
      });
    } else if (withBeats.length === 0 && plainChords.length > 0) {
      // NO chords have beat positions → backward compatible, beats undefined
      results.push({ measureNumber, chords: plainChords });
    } else if (withBeats.length > 0 && withBeats.length !== plainChords.length) {
      // SOME have beat positions, some don't → treat as no beat positions
      // Strip beat annotations from chords that have them for clean chord names
      const cleanChords = chordsStr
        .split(/[\s→\->]+/)
        .map(s => s.trim().replace(/\(\d+(?:\.\d+)?\)/, ''))
        .filter(s => s.length > 0 && /^[#b]?[IiVv]/.test(s));
      if (cleanChords.length > 0) {
        results.push({ measureNumber, chords: cleanChords });
      }
    }
  }

  return results;
}



// ============ 主类 ============

export class LLMHarmonizer {
  private client: OpenAI;
  private model: string;
  private difficulty: string;

  constructor(config: HarmonizerConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    this.model = config.model ?? 'qwen-plus';
    this.difficulty = config.difficulty ?? 'basic';
  }

  /**
   * 为一段旋律生成和弦
   */
  async harmonize(
    features: MelodyFeatures,
    measureStart: number,
    measureEnd: number,
    ragResults: RetrievalResult[] = [],
    previousChords?: string[]
  ): Promise<MeasureChords[]> {
    // 将 RetrievalResult[] 包装为 AnnotatedRAGResult[]（管线集成前的临时兼容）
    const annotatedResults: AnnotatedRAGResult[] = ragResults.map(r => ({
      result: r,
      measureRange: { start: measureStart + 1, end: measureEnd },
    }));

    const systemPrompt = buildSystemPrompt(this.difficulty);
    const userPrompt = buildUserPrompt(features, measureStart, measureEnd, annotatedResults, previousChords);

    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '';
    return parseLLMOutput(content);
  }

  /**
   * 将 RNA 和弦结果写入 Score
   */
  applyToScore(
      score: Score,
      measureChords: MeasureChords[]
    ): void {
      const tonicSemitone = this.getTonicSemitone(score);

      for (const mc of measureChords) {
        const measure = score.measures.find(m => m.number === mc.measureNumber);
        if (!measure) continue;

        const beatsPerMeasure = (measure.timeChange ?? score.time).beats;
        const beatsPerChord = mc.chords.length > 1
          ? beatsPerMeasure / mc.chords.length
          : beatsPerMeasure;

        measure.chords = [];
        for (let i = 0; i < mc.chords.length; i++) {
          // Prioritize LLM-specified beat positions (1-based → 0-based)
          let beat: number;
          if (mc.beats && mc.beats[i] !== undefined) {
            beat = mc.beats[i] - 1;
          } else {
            // Fallback: even distribution
            beat = i * beatsPerChord;
          }

          const chord = rnaToChordSymbol(
            mc.chords[i],
            tonicSemitone,
            score.key.mode,
            beat
          );
          if (chord) {
            measure.chords.push(chord);
          }
        }
      }
    }


  private getTonicSemitone(score: Score): number {
    const NOTE_TO_SEMI: Record<string, number> = {
      C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
    };
    const ACC_OFFSET: Record<string, number> = {
      'sharp': 1, 'flat': -1, 'none': 0, 'natural': 0,
      'double-sharp': 2, 'double-flat': -2,
    };
    return (
      (NOTE_TO_SEMI[score.key.tonic] ?? 0) +
      (ACC_OFFSET[score.key.tonicAccidental] ?? 0) + 12
    ) % 12;
  }
}

// 导出辅助函数供测试使用
export { rnaToChordSymbol, parseLLMOutput, buildUserPrompt };
