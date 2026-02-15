/**
 * 乐理常量 - 音阶、音程、和弦模板
 */

import type { NoteLetter, Accidental, DurationType } from './types.js';

/** 音名到半音偏移量的映射（C=0） */
export const NOTE_TO_SEMITONE: Record<NoteLetter, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** 变音记号对半音的偏移 */
export const ACCIDENTAL_OFFSET: Record<Accidental, number> = {
  'double-flat': -2,
  'flat': -1,
  'none': 0,
  'natural': 0,
  'sharp': 1,
  'double-sharp': 2,
};

/** 所有音名按五度圈顺序 */
export const NOTE_LETTERS: NoteLetter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * 五度圈 fifths 值到调性的映射
 * fifths: -7(Cb) ... 0(C) ... 7(C#)
 */
export const FIFTHS_TO_MAJOR_KEY: Record<number, { tonic: NoteLetter; accidental: Accidental }> = {
  '-7': { tonic: 'C', accidental: 'flat' },
  '-6': { tonic: 'G', accidental: 'flat' },
  '-5': { tonic: 'D', accidental: 'flat' },
  '-4': { tonic: 'A', accidental: 'flat' },
  '-3': { tonic: 'E', accidental: 'flat' },
  '-2': { tonic: 'B', accidental: 'flat' },
  '-1': { tonic: 'F', accidental: 'none' },
  '0': { tonic: 'C', accidental: 'none' },
  '1': { tonic: 'G', accidental: 'none' },
  '2': { tonic: 'D', accidental: 'none' },
  '3': { tonic: 'A', accidental: 'none' },
  '4': { tonic: 'E', accidental: 'none' },
  '5': { tonic: 'B', accidental: 'none' },
  '6': { tonic: 'F', accidental: 'sharp' },
  '7': { tonic: 'C', accidental: 'sharp' },
};

/** 大调音阶各级音的半音间隔（相对于主音） */
export const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

/** 自然小调音阶各级音的半音间隔 */
export const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

/**
 * 和弦模板 - 定义各种和弦质量的音程结构（半音数）
 * 以根音为0
 */
export const CHORD_TEMPLATES = {
  major:       [0, 4, 7],
  minor:       [0, 3, 7],
  diminished:  [0, 3, 6],
  augmented:   [0, 4, 8],
  dominant7:   [0, 4, 7, 10],
  major7:      [0, 4, 7, 11],
  minor7:      [0, 3, 7, 10],
  diminished7: [0, 3, 6, 9],
  'half-dim7': [0, 3, 6, 10],
  sus2:        [0, 2, 7],
  sus4:        [0, 5, 7],
} as const;

/**
 * MusicXML duration type 字符串到内部类型的映射
 */
export const XML_DURATION_MAP: Record<string, DurationType> = {
  'whole': 'whole',
  'half': 'half',
  'quarter': 'quarter',
  'eighth': 'eighth',
  '16th': '16th',
  '32nd': '32nd',
};

/**
 * 时值到四分音符数量的映射（用于计算拍位置）
 */
export const DURATION_TO_QUARTERS: Record<DurationType, number> = {
  'whole': 4,
  'half': 2,
  'quarter': 1,
  'eighth': 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};
