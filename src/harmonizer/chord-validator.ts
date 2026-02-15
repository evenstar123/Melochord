/**
 * 后处理验证层 - 和弦音覆盖检查 + 转换概率检查
 *
 * 验证 LLM 生成的和弦的音乐合理性，仅记录警告，不修改和弦。
 */

import { readFileSync } from 'node:fs';
import type { Score, Measure, ChordSymbol, NoteLetter, Accidental } from '../core/types.js';
import { NOTE_TO_SEMITONE, ACCIDENTAL_OFFSET, CHORD_TEMPLATES } from '../core/constants.js';

// ============ Types ============

/** 验证结果 */
export interface ValidationResult {
  /** 和弦音覆盖检查通过率 */
  coveragePassRate: number;
  /** 转换概率检查通过率 */
  transitionPassRate: number;
  /** 异常详情 */
  anomalies: ValidationAnomaly[];
}

/** 验证异常 */
export interface ValidationAnomaly {
  type: 'coverage' | 'transition';
  measureNumber: number;
  beat: number;
  detail: string;
}

// ============ Helpers ============

/**
 * 将根音音名 + 变音记号转为半音值 (C=0 .. B=11)
 */
export function rootToSemitone(root: NoteLetter, accidental: Accidental): number {
  return (NOTE_TO_SEMITONE[root] + ACCIDENTAL_OFFSET[accidental] + 12) % 12;
}

/**
 * 根据 ChordSymbol 计算和弦音的 pitch class 集合
 */
export function chordPitchClasses(chord: ChordSymbol): Set<number> {
  const rootSemi = rootToSemitone(chord.root, chord.rootAccidental);
  const template = CHORD_TEMPLATES[chord.quality];
  if (!template) return new Set<number>();
  return new Set(template.map((interval) => (rootSemi + interval) % 12));
}

// ============ Core Functions ============

/**
 * 加载转移概率矩阵
 * chord_transitions.json 格式: { "transition_probs": { "IV": { "I": 0.22, ... }, ... } }
 */
export function loadTransitionMatrix(
  path: string,
): Record<string, Record<string, number>> {
  const raw = readFileSync(path, 'utf-8');
  const json = JSON.parse(raw) as { transition_probs: Record<string, Record<string, number>> };
  return json.transition_probs;
}

/**
 * 检查和弦音是否覆盖强拍旋律音
 *
 * 在给定 beat 位置找到旋律音，判断其 pitch class 是否属于和弦音集合。
 * 如果该 beat 上没有音符（只有休止符或无事件），视为通过。
 */
export function checkChordCoverage(
  measure: Measure,
  chord: ChordSymbol,
  beat: number,
): boolean {
  const pcs = chordPitchClasses(chord);

  // 找到该 beat 上正在发声的音符
  // 音符覆盖范围: [note.beat, note.beat + duration)
  // 简化处理：找 beat 位置恰好等于该 beat 的音符，或覆盖该 beat 的音符
  for (const event of measure.events) {
    if (event.type !== 'note') continue;
    // 检查该音符是否在此 beat 上发声（beat 位置匹配）
    if (Math.abs(event.beat - beat) < 0.001) {
      const notePc = rootToSemitone(event.pitch.step, event.pitch.accidental);
      return pcs.has(notePc);
    }
  }

  // 没有找到该 beat 上的音符 → 视为通过
  return true;
}

/**
 * 检查相邻和弦转换概率
 *
 * 在转移矩阵中查找 fromChord → toChord 的概率。
 * 如果矩阵中不存在该条目，概率为 0。
 * pass = probability >= threshold
 */
export function checkTransitionProbability(
  fromChord: string,
  toChord: string,
  transitionMatrix: Record<string, Record<string, number>>,
  threshold: number,
): { pass: boolean; probability: number } {
  const row = transitionMatrix[fromChord];
  const probability = row?.[toChord] ?? 0;
  return { pass: probability >= threshold, probability };
}

/**
 * 将 ChordSymbol 转为简化的 RNA 风格字符串用于矩阵查找
 * 例如: C major → "I" (在 C 大调中), A minor → "vi" (在 C 大调中)
 *
 * 这里简化为直接用根音+质量的字符串表示，与矩阵 key 格式对齐。
 * 矩阵中的 key 是 RNA 格式（I, IV, V7 等），所以我们需要一个简单的
 * chord symbol → 显示名的转换。
 */
function chordToLabel(chord: ChordSymbol): string {
  const rootStr =
    chord.root +
    (chord.rootAccidental === 'sharp'
      ? '#'
      : chord.rootAccidental === 'flat'
        ? 'b'
        : chord.rootAccidental === 'double-sharp'
          ? '##'
          : chord.rootAccidental === 'double-flat'
            ? 'bb'
            : '');

  const qualitySuffix: Record<string, string> = {
    major: '',
    minor: 'm',
    diminished: 'dim',
    augmented: 'aug',
    dominant7: '7',
    major7: 'maj7',
    minor7: 'm7',
    diminished7: 'dim7',
    'half-dim7': 'ø7',
    sus2: 'sus2',
    sus4: 'sus4',
  };

  return rootStr + (qualitySuffix[chord.quality] ?? '');
}

/**
 * 对整个 Score 执行后处理验证
 *
 * - 在强拍（4/4 拍中 beat 0 和 beat 2）检查和弦音覆盖
 * - 检查相邻和弦之间的转换概率
 * - 不修改任何和弦数据
 */
export function validateHarmonization(
  score: Score,
  transitionMatrix: Record<string, Record<string, number>>,
  transitionThreshold: number = 0.005,
): ValidationResult {
  const anomalies: ValidationAnomaly[] = [];
  let coverageChecks = 0;
  let coveragePasses = 0;
  let transitionChecks = 0;
  let transitionPasses = 0;

  // 收集所有和弦（按顺序），用于转换概率检查
  const allChords: { chord: ChordSymbol; measureNumber: number }[] = [];

  for (const measure of score.measures) {
    // 确定强拍位置
    const time = measure.timeChange ?? score.time;
    const strongBeats: number[] = [];
    if (time.beats === 4 && time.beatType === 4) {
      strongBeats.push(0, 2);
    } else if (time.beats === 3 && time.beatType === 4) {
      strongBeats.push(0);
    } else {
      // 默认：只检查 beat 0
      strongBeats.push(0);
    }

    // 和弦音覆盖检查
    for (const beat of strongBeats) {
      // 找到该 beat 上生效的和弦（beat 位置 <= 当前 beat 的最后一个和弦）
      const activeChord = findActiveChord(measure.chords, beat);
      if (!activeChord) continue;

      coverageChecks++;
      const covered = checkChordCoverage(measure, activeChord, beat);
      if (covered) {
        coveragePasses++;
      } else {
        anomalies.push({
          type: 'coverage',
          measureNumber: measure.number,
          beat,
          detail: `强拍 ${beat} 上的旋律音不是和弦 ${chordToLabel(activeChord)} 的和弦音`,
        });
      }
    }

    // 收集和弦用于转换检查
    for (const chord of measure.chords) {
      allChords.push({ chord, measureNumber: measure.number });
    }
  }

  // 转换概率检查：相邻和弦对
  for (let i = 0; i < allChords.length - 1; i++) {
    const from = allChords[i];
    const to = allChords[i + 1];
    const fromLabel = chordToLabel(from.chord);
    const toLabel = chordToLabel(to.chord);

    transitionChecks++;
    const result = checkTransitionProbability(
      fromLabel,
      toLabel,
      transitionMatrix,
      transitionThreshold,
    );

    if (result.pass) {
      transitionPasses++;
    } else {
      anomalies.push({
        type: 'transition',
        measureNumber: to.measureNumber,
        beat: to.chord.beat,
        detail: `和弦转换 ${fromLabel} → ${toLabel} 概率过低 (${result.probability.toFixed(4)})`,
      });
    }
  }

  return {
    coveragePassRate: coverageChecks > 0 ? coveragePasses / coverageChecks : 1,
    transitionPassRate: transitionChecks > 0 ? transitionPasses / transitionChecks : 1,
    anomalies,
  };
}

/**
 * 找到在给定 beat 位置生效的和弦
 * 即 chord.beat <= beat 的最后一个和弦
 */
function findActiveChord(
  chords: ChordSymbol[],
  beat: number,
): ChordSymbol | undefined {
  let active: ChordSymbol | undefined;
  for (const chord of chords) {
    if (chord.beat <= beat + 0.001) {
      active = chord;
    }
  }
  return active;
}
