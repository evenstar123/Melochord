/**
 * MusicXML 解析器
 * 将 MusicXML 文档解析为内部 Score 表示
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  Score, Measure, MusicEvent, Note, Rest, Pitch,
  KeySignature, TimeSignature,
  NoteLetter, Accidental, DurationType, Mode,
} from '../core/types.js';
import {
  FIFTHS_TO_MAJOR_KEY, XML_DURATION_MAP, DURATION_TO_QUARTERS,
  NOTE_TO_SEMITONE, ACCIDENTAL_OFFSET,
} from '../core/constants.js';

// ============ XML 节点辅助类型 ============

/** 确保值为数组 */
function asArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

/** 安全读取数值 */
function num(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}

// ============ 解析函数 ============

/** 解析变音记号 */
function parseAccidental(alter: unknown): Accidental {
  const v = num(alter, 0);
  if (v === 0) return 'none';
  if (v === 1) return 'sharp';
  if (v === -1) return 'flat';
  if (v === 2) return 'double-sharp';
  if (v === -2) return 'double-flat';
  return 'none';
}

/** 解析调性 */
function parseKey(keyNode: Record<string, unknown>): KeySignature {
  const fifths = num(keyNode?.fifths, 0);
  const modeStr = String(keyNode?.mode ?? 'major');
  const mode: Mode = modeStr === 'minor' ? 'minor' : 'major';

  const lookup = FIFTHS_TO_MAJOR_KEY[fifths];
  if (mode === 'major' && lookup) {
    return {
      tonic: lookup.tonic,
      tonicAccidental: lookup.accidental,
      mode,
      fifths,
    };
  }

  // 小调：相对大调下行小三度
  // 简化处理：通过 fifths 值 +3 找到关系大调，再取其六级音
  const relativeMajorFifths = fifths + 3;
  const relativeLookup = FIFTHS_TO_MAJOR_KEY[relativeMajorFifths];
  if (relativeLookup) {
    // 关系大调的六级音就是小调主音
    // 这里用简化映射
    const minorKeyMap: Record<number, { tonic: NoteLetter; accidental: Accidental }> = {
      '-7': { tonic: 'A', accidental: 'flat' },
      '-6': { tonic: 'E', accidental: 'flat' },
      '-5': { tonic: 'B', accidental: 'flat' },
      '-4': { tonic: 'F', accidental: 'none' },
      '-3': { tonic: 'C', accidental: 'none' },
      '-2': { tonic: 'G', accidental: 'none' },
      '-1': { tonic: 'D', accidental: 'none' },
      0: { tonic: 'A', accidental: 'none' },
      1: { tonic: 'E', accidental: 'none' },
      2: { tonic: 'B', accidental: 'none' },
      3: { tonic: 'F', accidental: 'sharp' },
      4: { tonic: 'C', accidental: 'sharp' },
      5: { tonic: 'G', accidental: 'sharp' },
      6: { tonic: 'D', accidental: 'sharp' },
      7: { tonic: 'A', accidental: 'sharp' },
    };
    const minor = minorKeyMap[fifths];
    if (minor) {
      return { tonic: minor.tonic, tonicAccidental: minor.accidental, mode, fifths };
    }
  }

  // 兜底：C大调
  return { tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0 };
}

/** 解析拍号 */
function parseTime(timeNode: Record<string, unknown>): TimeSignature {
  return {
    beats: num(timeNode?.beats, 4),
    beatType: num(timeNode?.['beat-type'], 4),
  };
}

/** 解析音高 */
function parsePitch(pitchNode: Record<string, unknown>): Pitch {
  const step = String(pitchNode?.step ?? 'C') as NoteLetter;
  const octave = num(pitchNode?.octave, 4);
  const accidental = parseAccidental(pitchNode?.alter);
  return { step, accidental, octave };
}

/** 解析时值类型 */
function parseDuration(typeStr: unknown): DurationType {
  const s = String(typeStr ?? 'quarter');
  return XML_DURATION_MAP[s] ?? 'quarter';
}

/** 计算含附点的实际四分音符数 */
function durationInQuarters(durationType: DurationType, dots: number): number {
  let base = DURATION_TO_QUARTERS[durationType];
  let total = base;
  for (let i = 0; i < dots; i++) {
    base /= 2;
    total += base;
  }
  return total;
}

/** 检查连音线 */
function parseTies(notations: unknown): { tieStart: boolean; tieStop: boolean } {
  let tieStart = false;
  let tieStop = false;

  if (notations && typeof notations === 'object') {
    const tied = asArray((notations as Record<string, unknown>).tied);
    for (const t of tied) {
      if (t && typeof t === 'object') {
        const attrs = t as Record<string, unknown>;
        if (attrs['@_type'] === 'start') tieStart = true;
        if (attrs['@_type'] === 'stop') tieStop = true;
      }
    }
  }

  return { tieStart, tieStop };
}

// ============ 主解析器 ============

/**
 * 将 MusicXML 字符串解析为 Score
 */
export function parseMusicXML(xml: string): Score {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'measure' || name === 'note' || name === 'tied',
  });

  const doc = parser.parse(xml);
  const scorePartwise = doc['score-partwise'];
  if (!scorePartwise) {
    throw new Error('Invalid MusicXML: missing <score-partwise> root element');
  }

  // 提取元信息
  const work = scorePartwise.work;
  const identification = scorePartwise.identification;
  const title = String(
    work?.['work-title'] ?? scorePartwise['movement-title'] ?? 'Untitled'
  );
  const composer = String(
    identification?.creator?.['#text'] ?? identification?.creator ?? ''
  );

  // 解析声部（目前只处理第一个声部）
  const parts = asArray(scorePartwise.part);
  if (parts.length === 0) {
    throw new Error('Invalid MusicXML: no <part> found');
  }
  const part = parts[0] as Record<string, unknown>;
  const xmlMeasures = asArray(part.measure) as Record<string, unknown>[];

  // 初始调性和拍号
  let currentKey: KeySignature = { tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0 };
  let currentTime: TimeSignature = { beats: 4, beatType: 4 };
  let tempo = 120;
  let keyInitialized = false;
  let timeInitialized = false;

  const measures: Measure[] = [];

  for (const xmlMeasure of xmlMeasures) {
    const measureNumber = num(xmlMeasure['@_number'], measures.length + 1);
    const events: MusicEvent[] = [];
    let keyChange: KeySignature | undefined;
    let timeChange: TimeSignature | undefined;
    let beatPosition = 0;

    // 检查 attributes（调性、拍号变化）
    const attributes = xmlMeasure.attributes as Record<string, unknown> | undefined;
    if (attributes) {
      if (attributes.key) {
        const newKey = parseKey(attributes.key as Record<string, unknown>);
        if (!keyInitialized) {
          currentKey = newKey;
          keyInitialized = true;
        } else {
          keyChange = newKey;
          currentKey = newKey;
        }
      }
      if (attributes.time) {
        const newTime = parseTime(attributes.time as Record<string, unknown>);
        if (!timeInitialized) {
          currentTime = newTime;
          timeInitialized = true;
        } else {
          timeChange = newTime;
          currentTime = newTime;
        }
      }
    }

    // 检查 direction 中的速度标记
    const directions = asArray(xmlMeasure.direction);
    for (const dir of directions) {
      if (dir && typeof dir === 'object') {
        const sound = (dir as Record<string, unknown>).sound as Record<string, unknown> | undefined;
        if (sound?.['@_tempo']) {
          tempo = num(sound['@_tempo'], tempo);
        }
      }
    }

    // 解析音符
    const notes = asArray(xmlMeasure.note) as Record<string, unknown>[];
    for (const xmlNote of notes) {
      const isRest = xmlNote.rest !== undefined;
      const isChordNote = xmlNote.chord !== undefined; // 和弦音（同时发声）
      const durationType = parseDuration(xmlNote.type);
      const dots = asArray(xmlNote.dot).length;

      if (isChordNote) {
        // 和弦音：同一拍上的多个音（如右手弹和弦），保留最高音作为旋律
        if (!isRest) {
          const pitchNode = xmlNote.pitch as Record<string, unknown>;
          if (pitchNode) {
            const chordPitch = parsePitch(pitchNode);
            const chordMidi = chordPitch.octave * 12
              + NOTE_TO_SEMITONE[chordPitch.step]
              + ACCIDENTAL_OFFSET[chordPitch.accidental];
            // 替换上一个同拍音符（如果当前音更高）
            const lastEvent = events[events.length - 1];
            if (lastEvent && lastEvent.type === 'note') {
              const lastMidi = lastEvent.pitch.octave * 12
                + NOTE_TO_SEMITONE[lastEvent.pitch.step]
                + ACCIDENTAL_OFFSET[lastEvent.pitch.accidental];
              if (chordMidi > lastMidi) {
                lastEvent.pitch = chordPitch;
              }
            }
          }
        }
        continue;
      }

      const quarterDuration = durationInQuarters(durationType, dots);

      if (isRest) {
        const rest: Rest = {
          type: 'rest',
          duration: durationType,
          dots,
          beat: beatPosition,
        };
        events.push(rest);
      } else {
        const pitchNode = xmlNote.pitch as Record<string, unknown>;
        if (!pitchNode) {
          // 无音高信息，跳过
          beatPosition += quarterDuration;
          continue;
        }

        const notations = xmlNote.notations;
        const { tieStart, tieStop } = parseTies(notations);

        const note: Note = {
          type: 'note',
          pitch: parsePitch(pitchNode),
          duration: durationType,
          dots,
          tieStart,
          tieStop,
          beat: beatPosition,
        };
        events.push(note);
      }

      beatPosition += quarterDuration;
    }

    measures.push({
      number: measureNumber,
      events,
      chords: [],
      ...(keyChange && { keyChange }),
      ...(timeChange && { timeChange }),
    });
  }

  return {
    title,
    composer,
    key: currentKey,
    keyExplicit: keyInitialized,
    time: currentTime,
    tempo,
    measures,
  };
}
