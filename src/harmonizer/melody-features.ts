/**
 * 旋律特征提取
 *
 * 将 IR 中的旋律转为可用于 RAG 检索的文本描述
 * 核心思路：将旋律抽象为"音程走向 + 节奏密度"，消除调性差异
 */

import type { Score, Measure, Note, MusicEvent, KeySignature } from '../core/types.js';
import { NOTE_TO_SEMITONE, ACCIDENTAL_OFFSET, DURATION_TO_QUARTERS } from '../core/constants.js';

/** 旋律特征 */
export interface MelodyFeatures {
  /** 调性 */
  key: string;
  /** 调式 */
  mode: string;
  /** 拍号 */
  meter: string;
  /** 每小节的音程序列（半音数，正=上行，负=下行） */
  intervalsPerMeasure: number[][];
  /** 每小节的节奏模式（时值序列） */
  rhythmPerMeasure: string[][];
  /** 每小节的音级序列（相对于主音的半音数 0-11） */
  scaleDegreesPerMeasure: number[][];
  /** 整体节奏密度（每拍平均音符数） */
  rhythmDensity: number;
  /** 总小节数 */
  numMeasures: number;
  /** 对应的小节号 */
  measureNumbers: number[];
}

/** 将音高转为半音编号 */
function pitchToMidi(step: string, accidental: string, octave: number): number {
  const base = NOTE_TO_SEMITONE[step as keyof typeof NOTE_TO_SEMITONE] ?? 0;
  const offset = ACCIDENTAL_OFFSET[accidental as keyof typeof ACCIDENTAL_OFFSET] ?? 0;
  return octave * 12 + base + offset;
}

/** 将音高转为相对于主音的音级 (0-11) */
function pitchToScaleDegree(step: string, accidental: string, key: KeySignature): number {
  const noteSemitone = (NOTE_TO_SEMITONE[step as keyof typeof NOTE_TO_SEMITONE] ?? 0)
    + (ACCIDENTAL_OFFSET[accidental as keyof typeof ACCIDENTAL_OFFSET] ?? 0);
  const tonicSemitone = NOTE_TO_SEMITONE[key.tonic]
    + ACCIDENTAL_OFFSET[key.tonicAccidental];
  return ((noteSemitone - tonicSemitone) % 12 + 12) % 12;
}

/** 从小节中提取音符 */
function getNotesFromMeasure(measure: Measure): Note[] {
  return measure.events.filter((e): e is Note => e.type === 'note');
}

/**
 * 从 Score 提取旋律特征
 */
export function extractMelodyFeatures(score: Score): MelodyFeatures {
  const key = score.key;
  const accStr = key.tonicAccidental === 'sharp' ? '#'
    : key.tonicAccidental === 'flat' ? 'b' : '';

  const intervalsPerMeasure: number[][] = [];
  const rhythmPerMeasure: string[][] = [];
  const scaleDegreesPerMeasure: number[][] = [];
  const measureNumbers: number[] = [];
  let totalNotes = 0;
  let totalBeats = 0;

  for (const measure of score.measures) {
    measureNumbers.push(measure.number);
    const notes = getNotesFromMeasure(measure);
    totalNotes += notes.length;

    const currentTime = measure.timeChange ?? score.time;
    totalBeats += currentTime.beats * (4 / currentTime.beatType);

    // 音程序列
    const intervals: number[] = [];
    for (let i = 1; i < notes.length; i++) {
      const prevMidi = pitchToMidi(
        notes[i - 1].pitch.step, notes[i - 1].pitch.accidental, notes[i - 1].pitch.octave
      );
      const currMidi = pitchToMidi(
        notes[i].pitch.step, notes[i].pitch.accidental, notes[i].pitch.octave
      );
      intervals.push(currMidi - prevMidi);
    }
    intervalsPerMeasure.push(intervals);

    // 节奏模式
    const rhythm = notes.map(n => {
      let dur = n.duration;
      if (n.dots > 0) dur += '.'.repeat(n.dots);
      return dur;
    });
    rhythmPerMeasure.push(rhythm);

    // 音级序列
    const degrees = notes.map(n =>
      pitchToScaleDegree(n.pitch.step, n.pitch.accidental, key)
    );
    scaleDegreesPerMeasure.push(degrees);
  }

  return {
    key: `${key.tonic}${accStr}`,
    mode: key.mode,
    meter: `${score.time.beats}/${score.time.beatType}`,
    intervalsPerMeasure,
    rhythmPerMeasure,
    scaleDegreesPerMeasure,
    rhythmDensity: totalBeats > 0 ? Math.round((totalNotes / totalBeats) * 100) / 100 : 0,
    numMeasures: score.measures.length,
    measureNumbers,
  };
}

/**
 * 将旋律特征转为用于 RAG 检索的文本查询
 * 每 2 小节生成一个查询
 */
export function featuresToSearchQueries(features: MelodyFeatures): string[] {
  const queries: string[] = [];
  const chunkSize = 2; // 每 2 小节一个查询，与 Hooktheory 切片对齐

  for (let i = 0; i < features.numMeasures; i += chunkSize) {
    const end = Math.min(i + chunkSize, features.numMeasures);
    const intervals: number[] = [];
    const degrees: number[] = [];

    for (let j = i; j < end; j++) {
      intervals.push(...features.intervalsPerMeasure[j]);
      degrees.push(...features.scaleDegreesPerMeasure[j]);
    }

    // 构建文本描述
    const parts: string[] = [];
    parts.push(`mode:${features.mode}`);
    parts.push(`meter:${features.meter}`);

    if (intervals.length > 0) {
      // 音程走向描述
      const contour = intervals.map(i =>
        i > 0 ? `+${i}` : i < 0 ? `${i}` : '0'
      ).join(',');
      parts.push(`intervals:[${contour}]`);
    }

    if (degrees.length > 0) {
      parts.push(`degrees:[${degrees.join(',')}]`);
    }

    queries.push(parts.join(' '));
  }

  return queries;
}

/**
 * 将旋律特征转为 LLM prompt 中的描述文本
 */
export function featuresToPromptDescription(
  features: MelodyFeatures,
  measureStart: number,
  measureEnd: number
): string {
  const lines: string[] = [];
  lines.push(`调性: ${features.key} ${features.mode}`);
  lines.push(`拍号: ${features.meter}`);
  lines.push(`小节范围: ${measureStart + 1}-${measureEnd}`);

  for (let i = measureStart; i < measureEnd && i < features.numMeasures; i++) {
    const degrees = features.scaleDegreesPerMeasure[i];
    const rhythm = features.rhythmPerMeasure[i];
    if (degrees.length > 0) {
      const degreeNames = degrees.map(d => {
        const names = ['1', '#1', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
        return names[d] || String(d);
      });
      const measureNum = features.measureNumbers[i];
      lines.push(`第${measureNum}小节: 音级[${degreeNames.join(' ')}] 节奏[${rhythm.join(' ')}]`);
    }
  }

  return lines.join('\n');
}
