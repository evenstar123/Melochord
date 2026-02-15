/**
 * 调性分析器
 *
 * 两条分析路径：
 * 1. 主路径：从 MusicXML 调号（Score.key）直接读取
 * 2. 验证路径：Krumhansl-Schmuckler 算法，通过统计音符频率推断调性
 *
 * 输出：确定的调性 + 置信度
 */

import type {
  Score, Measure, Note, KeySignature, NoteLetter, Accidental, Mode,
} from '../core/types.js';
import {
  NOTE_TO_SEMITONE, ACCIDENTAL_OFFSET, DURATION_TO_QUARTERS,
  FIFTHS_TO_MAJOR_KEY,
} from '../core/constants.js';

// ============ Krumhansl-Schmuckler 音高分布模板 ============

/**
 * Krumhansl-Kessler 大调音高分布模板
 * 12 个值对应 C, C#, D, Eb, E, F, F#, G, Ab, A, Bb, B
 * 相对于主音的各半音位置的"期望权重"
 */
const KK_MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

/**
 * Krumhansl-Kessler 小调音高分布模板
 */
const KK_MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// ============ 辅助函数 ============

/** 将音高转为半音编号 (0-11, C=0) */
function pitchToSemitone(step: NoteLetter, accidental: Accidental): number {
  return (NOTE_TO_SEMITONE[step] + ACCIDENTAL_OFFSET[accidental] + 12) % 12;
}

/** 从 Score 中提取所有音符的加权音高分布 */
function extractPitchDistribution(measures: Measure[]): number[] {
  const distribution = new Array(12).fill(0);

  for (const measure of measures) {
    for (const event of measure.events) {
      if (event.type !== 'note') continue;
      const note = event as Note;
      const pc = pitchToSemitone(note.pitch.step, note.pitch.accidental);
      // 用时值作为权重：长音符对调性判断更重要
      const weight = DURATION_TO_QUARTERS[note.duration] * (1 + note.dots * 0.5);
      distribution[pc] += weight;
    }
  }

  return distribution;
}

/**
 * 计算皮尔逊相关系数
 * 用于比较实际音高分布与模板的相似度
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * 将模板旋转 n 个半音（对应不同主音）
 */
function rotateProfile(profile: number[], semitones: number): number[] {
  const rotated = new Array(12);
  for (let i = 0; i < 12; i++) {
    rotated[i] = profile[(i - semitones + 12) % 12];
  }
  return rotated;
}

// ============ 半音 → 调性信息映射 ============

const SEMITONE_TO_NOTE: { step: NoteLetter; accidental: Accidental }[] = [
  { step: 'C', accidental: 'none' },    // 0
  { step: 'C', accidental: 'sharp' },   // 1 (也可能是 Db)
  { step: 'D', accidental: 'none' },    // 2
  { step: 'E', accidental: 'flat' },    // 3
  { step: 'E', accidental: 'none' },    // 4
  { step: 'F', accidental: 'none' },    // 5
  { step: 'F', accidental: 'sharp' },   // 6
  { step: 'G', accidental: 'none' },    // 7
  { step: 'A', accidental: 'flat' },    // 8
  { step: 'A', accidental: 'none' },    // 9
  { step: 'B', accidental: 'flat' },    // 10
  { step: 'B', accidental: 'none' },    // 11
];

/** 半音编号 + 调式 → fifths 值 */
const SEMITONE_MODE_TO_FIFTHS: Record<string, number> = {
  '0-major': 0,   '7-major': 1,   '2-major': 2,   '9-major': 3,
  '4-major': 4,   '11-major': 5,  '6-major': 6,   '1-major': 7,
  '5-major': -1,  '10-major': -2, '3-major': -3,  '8-major': -4,
  '9-minor': 0,   '4-minor': 1,   '11-minor': 2,  '6-minor': 3,
  '1-minor': 4,   '8-minor': -1,  '3-minor': -2,  '10-minor': -3,
  '5-minor': -4,  '0-minor': -3,  '7-minor': -2,  '2-minor': -1,
};

// ============ 公共 API ============

/** 调性分析结果 */
export interface KeyAnalysisResult {
  /** 最终确定的调性 */
  key: KeySignature;
  /** 置信度 (0-1) */
  confidence: number;
  /** 分析来源 */
  source: 'musicxml' | 'ks-algorithm' | 'musicxml-verified';
  /** KS 算法的 top-3 候选（用于调试） */
  candidates?: { key: string; mode: Mode; correlation: number }[];
}

/**
 * 分析乐谱的调性
 *
 * 策略：
 * 1. 如果 MusicXML 提供了调号，先信任它
 * 2. 用 KS 算法验证，如果一致则置信度高
 * 3. 如果不一致，根据相关系数决定采用哪个
 */
export function analyzeKey(score: Score): KeyAnalysisResult {
  const xmlKey = score.key;

  // 如果 MusicXML 显式声明了调号，直接信任，不跑 KS 算法
  if (score.keyExplicit) {
    return {
      key: xmlKey,
      confidence: 0.95,
      source: 'musicxml',
    };
  }

  // 没有显式调号，用 KS 算法推断
  const distribution = extractPitchDistribution(score.measures);

  // 检查是否有足够的音符进行统计分析
  const totalWeight = distribution.reduce((a, b) => a + b, 0);
  if (totalWeight < 4) {
    // 音符太少，直接信任 MusicXML
    return {
      key: xmlKey,
      confidence: 0.5,
      source: 'musicxml',
    };
  }

  // KS 算法：对所有 24 个调（12 大调 + 12 小调）计算相关系数
  const candidates: { semitone: number; mode: Mode; correlation: number }[] = [];

  for (let s = 0; s < 12; s++) {
    const majorCorr = pearsonCorrelation(distribution, rotateProfile(KK_MAJOR_PROFILE, s));
    const minorCorr = pearsonCorrelation(distribution, rotateProfile(KK_MINOR_PROFILE, s));

    candidates.push({ semitone: s, mode: 'major', correlation: majorCorr });
    candidates.push({ semitone: s, mode: 'minor', correlation: minorCorr });
  }

  // 按相关系数降序排列
  candidates.sort((a, b) => b.correlation - a.correlation);

  const best = candidates[0];
  const second = candidates[1];

  // 将 KS 结果转为 KeySignature
  const bestNote = SEMITONE_TO_NOTE[best.semitone];
  const fifthsKey = `${best.semitone}-${best.mode}`;
  const bestFifths = SEMITONE_MODE_TO_FIFTHS[fifthsKey] ?? 0;

  const ksKey: KeySignature = {
    tonic: bestNote.step,
    tonicAccidental: bestNote.accidental,
    mode: best.mode,
    fifths: bestFifths,
  };

  // 格式化候选列表
  const topCandidates = candidates.slice(0, 5).map(c => ({
    key: `${SEMITONE_TO_NOTE[c.semitone].step}${
      SEMITONE_TO_NOTE[c.semitone].accidental === 'sharp' ? '#' :
      SEMITONE_TO_NOTE[c.semitone].accidental === 'flat' ? 'b' : ''
    }`,
    mode: c.mode,
    correlation: Math.round(c.correlation * 1000) / 1000,
  }));

  // 比较 MusicXML 调号与 KS 结果
  const xmlSemitone = pitchToSemitone(xmlKey.tonic, xmlKey.tonicAccidental);
  const xmlMatches = xmlSemitone === best.semitone && xmlKey.mode === best.mode;

  // 也检查关系大小调（C大调和A小调共享调号）
  const relativeMatch = xmlKey.mode !== best.mode && (
    (xmlKey.mode === 'major' && (xmlSemitone + 9) % 12 === best.semitone) ||
    (xmlKey.mode === 'minor' && (xmlSemitone + 3) % 12 === best.semitone)
  );

  if (xmlMatches) {
    // MusicXML 和 KS 完全一致
    return {
      key: xmlKey,
      confidence: Math.min(0.95, 0.7 + best.correlation * 0.3),
      source: 'musicxml-verified',
      candidates: topCandidates,
    };
  }

  if (relativeMatch) {
    // 关系大小调，MusicXML 的调号是对的，只是大小调判断不同
    // KS 算法在区分关系大小调时更可靠
    const confidenceGap = best.correlation - second.correlation;
    if (confidenceGap > 0.05) {
      // KS 有明显偏好，采用 KS 的大小调判断
      return {
        key: ksKey,
        confidence: Math.min(0.9, 0.6 + confidenceGap),
        source: 'ks-algorithm',
        candidates: topCandidates,
      };
    }
    // 差距不大，信任 MusicXML
    return {
      key: xmlKey,
      confidence: 0.7,
      source: 'musicxml-verified',
      candidates: topCandidates,
    };
  }

  // MusicXML 和 KS 不一致
  if (best.correlation > 0.8) {
    // KS 非常确信，采用 KS
    return {
      key: ksKey,
      confidence: Math.min(0.85, best.correlation),
      source: 'ks-algorithm',
      candidates: topCandidates,
    };
  }

  // 都不太确定，信任 MusicXML
  return {
    key: xmlKey,
    confidence: 0.6,
    source: 'musicxml',
    candidates: topCandidates,
  };
}

/**
 * 便捷函数：将 KeySignature 格式化为可读字符串
 * 例如: "C major", "F# minor"
 */
export function formatKey(key: KeySignature): string {
  const accStr =
    key.tonicAccidental === 'sharp' ? '#' :
    key.tonicAccidental === 'flat' ? 'b' :
    key.tonicAccidental === 'double-sharp' ? '##' :
    key.tonicAccidental === 'double-flat' ? 'bb' : '';
  return `${key.tonic}${accStr} ${key.mode}`;
}

// ============ 分段调性分析（转调检测） ============

/** 转调信息 */
export interface ModulationPoint {
  /** 转调发生的小节号 */
  measureNumber: number;
  /** 新调性 */
  newKey: KeySignature;
  /** 置信度 */
  confidence: number;
}

/** 分段调性分析结果 */
export interface SegmentedKeyResult {
  /** 初始调性 */
  initialKey: KeyAnalysisResult;
  /** 转调点列表 */
  modulations: ModulationPoint[];
}

/** 对一组小节运行 KS 算法，返回最佳调性和相关系数 */
function runKSOnMeasures(measures: Measure[]): {
  semitone: number;
  mode: Mode;
  correlation: number;
  key: KeySignature;
} | null {
  const distribution = extractPitchDistribution(measures);
  const totalWeight = distribution.reduce((a, b) => a + b, 0);
  if (totalWeight < 2) return null;

  let bestSemitone = 0;
  let bestMode: Mode = 'major';
  let bestCorr = -Infinity;

  for (let s = 0; s < 12; s++) {
    const majorCorr = pearsonCorrelation(distribution, rotateProfile(KK_MAJOR_PROFILE, s));
    const minorCorr = pearsonCorrelation(distribution, rotateProfile(KK_MINOR_PROFILE, s));

    if (majorCorr > bestCorr) {
      bestCorr = majorCorr;
      bestSemitone = s;
      bestMode = 'major';
    }
    if (minorCorr > bestCorr) {
      bestCorr = minorCorr;
      bestSemitone = s;
      bestMode = 'minor';
    }
  }

  const note = SEMITONE_TO_NOTE[bestSemitone];
  const fifthsKey = `${bestSemitone}-${bestMode}`;
  const fifths = SEMITONE_MODE_TO_FIFTHS[fifthsKey] ?? 0;

  return {
    semitone: bestSemitone,
    mode: bestMode,
    correlation: bestCorr,
    key: {
      tonic: note.step,
      tonicAccidental: note.accidental,
      mode: bestMode,
      fifths,
    },
  };
}

/** 检查两个 KS 结果是否代表相同调性 */
function isSameKey(
  a: { semitone: number; mode: Mode },
  b: { semitone: number; mode: Mode },
): boolean {
  return a.semitone === b.semitone && a.mode === b.mode;
}

/**
 * 分段调性分析
 *
 * 算法：
 * 1. 滑动窗口（8 小节窗口，2 小节步长）计算每个窗口的 KS 最佳调性
 * 2. 检测相邻窗口调性变化的区域
 * 3. 在变化区域内逐小节计算累积 KS 相关系数，定位跳变点
 * 4. 验证转调前后各 4 小节的置信度 > 阈值
 */
export function analyzeKeySegmented(
  score: Score,
  options?: {
    windowSize?: number;
    stepSize?: number;
    confidenceThreshold?: number;
  },
): SegmentedKeyResult {
  const windowSize = options?.windowSize ?? 8;
  const stepSize = options?.stepSize ?? 2;
  const confidenceThreshold = options?.confidenceThreshold ?? 0.65;

  // 先做全局分析作为 initialKey
  const initialKey = analyzeKey(score);

  const totalMeasures = score.measures.length;

  // 如果调号来自 MusicXML 显式声明，跳过 KS 分段转调检测
  // MusicXML 中的 keyChange 已经在解析阶段被正确记录到各小节
  if (score.keyExplicit) {
    return { initialKey, modulations: [] };
  }

  // 短曲（< 12 小节）跳过分段分析
  if (totalMeasures < 12) {
    return { initialKey, modulations: [] };
  }

  // 如果整体 KS 置信度很低（< 0.5），跳过分段分析，信任 MusicXML
  if (initialKey.confidence < 0.5) {
    return { initialKey, modulations: [] };
  }

  // 按小节号排序（确保顺序正确）
  const sortedMeasures = [...score.measures].sort((a, b) => a.number - b.number);

  // Step 1: 滑动窗口 KS 分析
  interface WindowResult {
    startIdx: number; // 在 sortedMeasures 中的起始索引
    endIdx: number;   // 在 sortedMeasures 中的结束索引（不含）
    ks: { semitone: number; mode: Mode; correlation: number; key: KeySignature };
  }

  const windows: WindowResult[] = [];
  for (let i = 0; i <= totalMeasures - windowSize; i += stepSize) {
    const windowMeasures = sortedMeasures.slice(i, i + windowSize);
    const ks = runKSOnMeasures(windowMeasures);
    if (ks) {
      windows.push({ startIdx: i, endIdx: i + windowSize, ks });
    }
  }

  if (windows.length < 2) {
    return { initialKey, modulations: [] };
  }

  // Step 2: 检测相邻窗口调性变化
  interface ChangeRegion {
    prevWindow: WindowResult;
    nextWindow: WindowResult;
  }

  const changeRegions: ChangeRegion[] = [];
  for (let i = 0; i < windows.length - 1; i++) {
    if (!isSameKey(windows[i].ks, windows[i + 1].ks)) {
      changeRegions.push({
        prevWindow: windows[i],
        nextWindow: windows[i + 1],
      });
    }
  }

  if (changeRegions.length === 0) {
    return { initialKey, modulations: [] };
  }

  // Step 3: 在变化区域内逐小节定位转调点
  const modulations: ModulationPoint[] = [];
  const confirmedMeasureNumbers = new Set<number>();

  for (const region of changeRegions) {
    // 变化区域：从 prevWindow 的起始到 nextWindow 的结束
    // 但我们只在重叠/相邻区域内搜索
    const searchStart = region.prevWindow.startIdx;
    const searchEnd = Math.min(region.nextWindow.endIdx, totalMeasures);

    // 首尾各 4 小节不作为转调点候选
    const minCandidateIdx = 4;
    const maxCandidateIdx = totalMeasures - 4;

    // 逐小节从左向右累积音高分布，计算 KS 相关系数
    // 找到相关系数发生最大跳变的小节
    let bestJumpIdx = -1;
    let bestJumpValue = -Infinity;

    // 在搜索区域内，对每个候选分割点计算前后的 KS 相关系数差异
    const candidateStart = Math.max(searchStart + 1, minCandidateIdx);
    const candidateEnd = Math.min(searchEnd, maxCandidateIdx);

    for (let splitIdx = candidateStart; splitIdx < candidateEnd; splitIdx++) {
      // 分割点前的小节用 prevWindow 的调性计算相关系数
      // 分割点后的小节用 nextWindow 的调性计算相关系数
      const beforeMeasures = sortedMeasures.slice(
        Math.max(0, splitIdx - 4), splitIdx,
      );
      const afterMeasures = sortedMeasures.slice(
        splitIdx, Math.min(totalMeasures, splitIdx + 4),
      );

      const beforeDist = extractPitchDistribution(beforeMeasures);
      const afterDist = extractPitchDistribution(afterMeasures);

      const beforeTotalWeight = beforeDist.reduce((a, b) => a + b, 0);
      const afterTotalWeight = afterDist.reduce((a, b) => a + b, 0);

      if (beforeTotalWeight < 2 || afterTotalWeight < 2) continue;

      // 前段与 prevWindow 调性的相关系数
      const beforeCorr = pearsonCorrelation(
        beforeDist,
        rotateProfile(
          region.prevWindow.ks.mode === 'major' ? KK_MAJOR_PROFILE : KK_MINOR_PROFILE,
          region.prevWindow.ks.semitone,
        ),
      );

      // 后段与 nextWindow 调性的相关系数
      const afterCorr = pearsonCorrelation(
        afterDist,
        rotateProfile(
          region.nextWindow.ks.mode === 'major' ? KK_MAJOR_PROFILE : KK_MINOR_PROFILE,
          region.nextWindow.ks.semitone,
        ),
      );

      // 跳变值：两侧各自与对应调性的匹配度之和
      const jumpValue = beforeCorr + afterCorr;

      if (jumpValue > bestJumpValue) {
        bestJumpValue = jumpValue;
        bestJumpIdx = splitIdx;
      }
    }

    if (bestJumpIdx < 0) continue;

    // Step 4: 验证转调前后各 4 小节的置信度
    const beforeValidation = sortedMeasures.slice(
      Math.max(0, bestJumpIdx - 4), bestJumpIdx,
    );
    const afterValidation = sortedMeasures.slice(
      bestJumpIdx, Math.min(totalMeasures, bestJumpIdx + 4),
    );

    const beforeKS = runKSOnMeasures(beforeValidation);
    const afterKS = runKSOnMeasures(afterValidation);

    if (!beforeKS || !afterKS) continue;
    if (beforeKS.correlation < confidenceThreshold) continue;
    if (afterKS.correlation < confidenceThreshold) continue;

    // 确认转调：前后调性确实不同
    if (isSameKey(beforeKS, afterKS)) continue;

    const modulationMeasureNumber = sortedMeasures[bestJumpIdx].number;

    // 避免重复添加同一小节的转调点
    if (confirmedMeasureNumbers.has(modulationMeasureNumber)) continue;
    confirmedMeasureNumbers.add(modulationMeasureNumber);

    modulations.push({
      measureNumber: modulationMeasureNumber,
      newKey: afterKS.key,
      confidence: afterKS.correlation,
    });
  }

  // 按小节号排序
  modulations.sort((a, b) => a.measureNumber - b.measureNumber);

  return { initialKey, modulations };
}


/**
 * 获取指定小节的有效调性
 *
 * 从 Score 的初始调性开始，查找最近的 keyChange。
 * 遍历小节号 <= measureNumber 的所有小节，如果某小节设置了 keyChange，
 * 则以该 keyChange 作为有效调性。如果没有任何 keyChange，返回 score.key。
 */
export function getEffectiveKey(
  score: Score,
  measureNumber: number,
): KeySignature {
  let effectiveKey = score.key;

  const sorted = [...score.measures].sort((a, b) => a.number - b.number);

  for (const measure of sorted) {
    if (measure.number > measureNumber) break;
    if (measure.keyChange) {
      effectiveKey = measure.keyChange;
    }
  }

  return effectiveKey;
}
