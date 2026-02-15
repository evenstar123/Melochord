/**
 * 难度级别和弦白名单过滤
 *
 * 根据难度级别对 LLM 生成的 RNA 和弦进行白名单过滤，
 * 将不在白名单中的和弦替换为功能最接近的允许和弦。
 */

import type { MeasureChords } from './llm-harmonizer.js';

// ============ 常量 ============

/** 各难度级别的 RNA 白名单 */
export const DIFFICULTY_WHITELISTS: Record<string, string[]> = {
  basic: ['I', 'IV', 'V', 'vi'],
  intermediate: [
    'I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°',
    'I7', 'ii7', 'IV7', 'V7', 'vi7', 'IVmaj7', 'Imaj7',
  ],
  advanced: [], // 空数组表示不限制
};

/** 功能替换映射（不在白名单中的和弦 → 最接近的允许和弦） */
export const FUNCTIONAL_SUBSTITUTIONS: Record<string, Record<string, string>> = {
  basic: {
    'ii': 'IV',     // 下属功能
    'iii': 'I',     // 主功能
    'vii°': 'V',    // 属功能
    'II': 'V',      // 属功能
    'III': 'I',     // 主功能
    'VII': 'V',     // 属功能
    // 七和弦降级
    'V7': 'V',
    'ii7': 'IV',
    'vi7': 'vi',
    'IVmaj7': 'IV',
    'Imaj7': 'I',
  },
  intermediate: {
    // intermediate 允许大部分顺阶和弦，只需处理离调和弦
    'bVII': 'V',
    'bIII': 'iii',
    'bVI': 'vi',
    '#IV': 'IV',
  },
};

// ============ 类型 ============

export interface FilterResult {
  /** 过滤后的和弦（RNA 格式） */
  filtered: string;
  /** 是否被替换 */
  wasReplaced: boolean;
  /** 原始和弦（如果被替换） */
  original?: string;
}

// ============ 内部辅助 ============

/**
 * 去掉转位标记（如 "/bass"）和其他修饰，返回基础 RNA 级数。
 * 例如 "V7/5" → "V7", "IV/G" → "IV"
 */
function normalizeChord(chord: string): string {
  // 去掉斜杠后面的转位/低音标记
  const slashIdx = chord.indexOf('/');
  return slashIdx >= 0 ? chord.slice(0, slashIdx) : chord;
}

/**
 * 根据 RNA 级数判断和弦的功能组，返回该功能组的默认和弦。
 * - 主功能 (tonic): I, iii, vi → 默认 I
 * - 下属功能 (subdominant): ii, IV → 默认 IV
 * - 属功能 (dominant): V, vii° → 默认 V
 */
function getFunctionalDefault(normalizedChord: string): string {
  // 去掉升降号前缀和七和弦/质量后缀，提取核心级数
  const core = normalizedChord
    .replace(/^[#b]+/, '')       // 去掉升降号
    .replace(/(maj7|7|°|dim|aug|sus[24]?|add\d+).*$/i, ''); // 去掉质量后缀

  const upper = core.toUpperCase();

  // 属功能组
  if (upper === 'V' || upper === 'VII') return 'V';
  // 下属功能组
  if (upper === 'II' || upper === 'IV') return 'IV';
  // 主功能组（I, III, VI 以及其他未识别的）
  return 'I';
}

// ============ 公开函数 ============

/**
 * 对单个和弦执行白名单过滤。
 *
 * 逻辑：
 * 1. advanced 级别直接返回原样
 * 2. 标准化输入（去掉转位标记）
 * 3. 检查白名单
 * 4. 查找替换映射
 * 5. 回退到功能组默认和弦
 */
export function filterChord(chord: string, difficulty: string): FilterResult {
  // 1. advanced 不做任何过滤
  if (difficulty === 'advanced') {
    return { filtered: chord, wasReplaced: false };
  }

  const whitelist = DIFFICULTY_WHITELISTS[difficulty];
  const substitutions = FUNCTIONAL_SUBSTITUTIONS[difficulty];

  // 未知难度级别，保留原样
  if (!whitelist) {
    return { filtered: chord, wasReplaced: false };
  }

  // 2. 标准化：去掉转位标记
  const normalized = normalizeChord(chord);

  // 3. 在白名单中 → 通过
  if (whitelist.includes(normalized)) {
    return { filtered: chord, wasReplaced: false };
  }

  // 4. 查找替换映射
  if (substitutions && substitutions[normalized]) {
    const replacement = substitutions[normalized];
    return { filtered: replacement, wasReplaced: true, original: chord };
  }

  // 5. 回退到功能组默认和弦
  const fallback = getFunctionalDefault(normalized);
  return { filtered: fallback, wasReplaced: true, original: chord };
}

/**
 * 对一组 MeasureChords 执行批量白名单过滤。
 * 返回过滤后的 MeasureChords 数组和所有替换记录。
 */
export function filterMeasureChords(
  measureChords: MeasureChords[],
  difficulty: string,
): { filtered: MeasureChords[]; replacements: FilterResult[] } {
  const replacements: FilterResult[] = [];

  const filtered = measureChords.map((mc) => {
    const filteredChords = mc.chords.map((chord) => {
      const result = filterChord(chord, difficulty);
      if (result.wasReplaced) {
        replacements.push(result);
      }
      return result.filtered;
    });

    return {
      ...mc,
      chords: filteredChords,
    };
  });

  return { filtered, replacements };
}
