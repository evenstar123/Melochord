/**
 * IR → ABC Notation 转换器
 *
 * 将 Score 对象转换为 ABC Notation 格式文本，
 * 包含旋律音符、节奏信息和和弦标注。
 */

import type {
  Score, Note, Rest, ChordSymbol,
  KeySignature, Accidental, DurationType, ChordQuality,
} from '../core/types.js';

// ============ 映射表 ============

/**
 * Accidental → ABC 变音记号前缀
 */
const ACCIDENTAL_TO_ABC: Record<Accidental, string> = {
  'double-flat': '__',
  'flat': '_',
  'none': '',
  'natural': '=',
  'sharp': '^',
  'double-sharp': '^^',
};

/**
 * DurationType → ABC 时值后缀
 * 以四分音符为基准（无后缀）
 */
const DURATION_TO_ABC_SUFFIX: Record<DurationType, string> = {
  whole: '4',
  half: '2',
  quarter: '',
  eighth: '/2',
  '16th': '/4',
  '32nd': '/8',
};

/**
 * ChordQuality → ABC 和弦质量后缀
 */
const QUALITY_TO_ABC_SUFFIX: Record<ChordQuality, string> = {
  major: '',
  minor: 'm',
  diminished: 'dim',
  augmented: 'aug',
  dominant7: '7',
  major7: 'maj7',
  minor7: 'm7',
  diminished7: 'dim7',
  'half-dim7': 'm7b5',
  sus2: 'sus2',
  sus4: 'sus4',
};

// ============ 公共函数 ============

/**
 * 将 KeySignature 转为 ABC 调号字段值
 *
 * 例：KeySignature{C, none, major} → "C"
 *     KeySignature{A, none, minor} → "Am"
 *     KeySignature{F, sharp, major} → "F#"
 *     KeySignature{E, flat, minor} → "Ebm"
 */
export function keyToABCField(key: KeySignature): string {
  const acc = key.tonicAccidental;
  let accStr = '';
  if (acc === 'sharp') accStr = '#';
  else if (acc === 'flat') accStr = 'b';
  else if (acc === 'double-sharp') accStr = '##';
  else if (acc === 'double-flat') accStr = 'bb';

  const modeStr = key.mode === 'minor' ? 'm' : '';
  return `${key.tonic}${accStr}${modeStr}`;
}

/**
 * 将单个音符转为 ABC 音符字符串
 *
 * 八度映射：
 *   octave 5  → 小写字母 (c)
 *   octave 6  → 小写字母 + ' (c')
 *   octave 7  → 小写字母 + '' (c'')
 *   octave 4  → 大写字母 (C)
 *   octave 3  → 大写字母 + , (C,)
 *   octave 2  → 大写字母 + ,, (C,,)
 *
 * 变音记号前缀：^ (sharp), _ (flat), = (natural), ^^ (double-sharp), __ (double-flat)
 *
 * 时值后缀：whole→"4", half→"2", quarter→"", eighth→"/2", 16th→"/4", 32nd→"/8"
 *
 * 附点：每个附点在时值后缀后追加一个 ">" (ABC 2.1 broken rhythm 不适用，
 *       但标准 ABC 中附点用数值表示，这里用分数近似)
 *
 * 例：Note{C, none, 4, quarter}  → "C"
 *     Note{C, sharp, 5, eighth}  → "^c/2"
 *     Note{D, none, 3, half}     → "D,2"
 */
export function noteToABC(note: Note): string {
  const { pitch, duration, dots } = note;

  // Accidental prefix
  const accPrefix = ACCIDENTAL_TO_ABC[pitch.accidental];

  // Note letter + octave
  let letter: string;
  let octaveMarks = '';

  if (pitch.octave >= 5) {
    // Lowercase for octave 5+, apostrophes for each octave above 5
    letter = pitch.step.toLowerCase();
    const extra = pitch.octave - 5;
    octaveMarks = "'".repeat(extra);
  } else {
    // Uppercase for octave 4 and below, commas for each octave below 4
    letter = pitch.step;
    const extra = 4 - pitch.octave;
    octaveMarks = ','.repeat(extra);
  }

  // Duration suffix
  let durSuffix = DURATION_TO_ABC_SUFFIX[duration];

  // Handle dotted notes: multiply duration by 1.5 per dot
  // In ABC, dotted notes are typically written with fractional durations
  // A dotted quarter = 3/2 quarter. We append the dot count as repeated '>' isn't standard.
  // Standard ABC uses numeric multipliers, so dotted quarter → "3/2", dotted half → "3"
  // But simpler approach: just use the base duration suffix for now
  // Actually, the simplest correct approach for dots in ABC:
  // dotted whole (6 beats) → "6", dotted half (3 beats) → "3", dotted quarter (1.5) → "3/2"
  // dotted eighth (0.75) → "3/4"
  if (dots > 0) {
    durSuffix = computeDottedSuffix(duration, dots);
  }

  return `${accPrefix}${letter}${octaveMarks}${durSuffix}`;
}

/**
 * 将休止符转为 ABC 休止符字符串
 */
function restToABC(rest: Rest): string {
  let durSuffix = DURATION_TO_ABC_SUFFIX[rest.duration];
  if (rest.dots > 0) {
    durSuffix = computeDottedSuffix(rest.duration, rest.dots);
  }
  return `z${durSuffix}`;
}

/**
 * 计算附点音符的 ABC 时值后缀
 *
 * 以四分音符为单位1，计算实际时值，然后转为 ABC 分数表示。
 */
function computeDottedSuffix(duration: DurationType, dots: number): string {
  // Base duration in quarter-note units
  const baseQuarters: Record<DurationType, number> = {
    whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125,
  };

  let total = baseQuarters[duration];
  let dotVal = total;
  for (let i = 0; i < dots; i++) {
    dotVal /= 2;
    total += dotVal;
  }

  // Convert to ABC: value is relative to quarter note (which is "1" = no suffix)
  // We need to express `total` as a fraction
  // Multiply by 8 to avoid floating point: total * 8 gives us integer numerator over 8
  const num = Math.round(total * 8);
  const den = 8;

  // Simplify fraction
  const g = gcd(num, den);
  const sNum = num / g;
  const sDen = den / g;

  if (sDen === 1) {
    // Integer duration
    return sNum === 1 ? '' : String(sNum);
  }
  if (sNum === 1) {
    return `/${sDen}`;
  }
  return `${sNum}/${sDen}`;
}

/**
 * Greatest common divisor
 */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * 将 ChordSymbol 转为 ABC 和弦标注字符串
 *
 * ABC 和弦标注使用双引号括起，如 "Am", "G7", "F#dim"
 *
 * 例：ChordSymbol{A, none, minor}     → '"Am"'
 *     ChordSymbol{G, none, dominant7}  → '"G7"'
 *     ChordSymbol{F, sharp, diminished} → '"F#dim"'
 */
export function chordToABC(chord: ChordSymbol): string {
  const acc = chord.rootAccidental;
  let accStr = '';
  if (acc === 'sharp') accStr = '#';
  else if (acc === 'flat') accStr = 'b';
  else if (acc === 'double-sharp') accStr = '##';
  else if (acc === 'double-flat') accStr = 'bb';

  const qualitySuffix = QUALITY_TO_ABC_SUFFIX[chord.quality];
  return `"${chord.root}${accStr}${qualitySuffix}"`;
}

/**
 * 将 Score 转换为 ABC Notation 文本
 *
 * 生成包含 T:（标题）、M:（拍号）、K:（调号）头部字段
 * 以及旋律音符和和弦标注的完整 ABC 文本。
 *
 * @param score - 带和弦标注的 Score 对象
 * @returns ABC Notation 格式文本
 */
export function scoreToABC(score: Score): string {
  const lines: string[] = [];

  // ABC header fields
  lines.push(`X:1`);
  lines.push(`T:${score.title || 'Untitled'}`);
  lines.push(`M:${score.time.beats}/${score.time.beatType}`);
  lines.push(`L:1/4`);  // Default note length = quarter note
  lines.push(`K:${keyToABCField(score.key)}`);

  // Body: measures separated by bar lines
  const measureStrings: string[] = [];

  for (const measure of score.measures) {
    const parts: string[] = [];

    // Build a map of beat → chord for this measure
    const chordAtBeat = new Map<number, ChordSymbol>();
    for (const chord of measure.chords) {
      chordAtBeat.set(chord.beat, chord);
    }

    for (const event of measure.events) {
      // Check if there's a chord at this event's beat
      const chord = chordAtBeat.get(event.beat);
      if (chord) {
        parts.push(chordToABC(chord));
        chordAtBeat.delete(event.beat);
      }

      // Convert the event
      if (event.type === 'note') {
        parts.push(noteToABC(event));
      } else {
        parts.push(restToABC(event));
      }
    }

    // Any remaining chords not matched to events (append at end)
    for (const chord of chordAtBeat.values()) {
      parts.push(chordToABC(chord));
    }

    measureStrings.push(parts.join(''));
  }

  // Join measures with bar lines, add final bar
  lines.push(measureStrings.join(' | ') + ' |]');

  return lines.join('\n');
}
