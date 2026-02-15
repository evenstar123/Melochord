/**
 * IR → MusicXML 和弦注入转换器
 *
 * 将 Score 中的 ChordSymbol 数据转换为 MusicXML <harmony> 元素
 * 并注入到原始 MusicXML 文档中对应小节的 <note> 元素之前
 */

import type {
  Score, ChordSymbol, ChordQuality, Accidental,
} from '../core/types.js';
import { ACCIDENTAL_OFFSET } from '../core/constants.js';

/**
 * ChordQuality → MusicXML <kind> 字符串映射
 */
export const QUALITY_TO_KIND: Record<ChordQuality, string> = {
  major: 'major',
  minor: 'minor',
  diminished: 'diminished',
  augmented: 'augmented',
  dominant7: 'dominant',
  major7: 'major-seventh',
  minor7: 'minor-seventh',
  diminished7: 'diminished-seventh',
  'half-dim7': 'half-diminished',
  sus2: 'suspended-second',
  sus4: 'suspended-fourth',
};

/**
 * Accidental → MusicXML alter 数值
 */
export function accidentalToAlter(acc: Accidental): number {
  return ACCIDENTAL_OFFSET[acc];
}

/**
 * 将单个 ChordSymbol 转换为 MusicXML <harmony> 元素字符串
 */
function chordToHarmonyXML(chord: ChordSymbol, indent: string, eol: string): string {
  const alter = accidentalToAlter(chord.rootAccidental);
  const kind = QUALITY_TO_KIND[chord.quality];

  let xml = `${indent}<harmony print-frame="no">${eol}`;
  xml += `${indent}  <root>${eol}`;
  xml += `${indent}    <root-step>${chord.root}</root-step>${eol}`;
  if (alter !== 0) {
    xml += `${indent}    <root-alter>${alter}</root-alter>${eol}`;
  }
  xml += `${indent}  </root>${eol}`;
  xml += `${indent}  <kind>${kind}</kind>${eol}`;
  xml += `${indent}</harmony>${eol}`;

  return xml;
}

/**
 * 将 Score 中的和弦标注注入到原始 MusicXML 中
 *
 * 策略：使用正则匹配 XML 结构，支持单行和多行 <note> 格式。
 * 对于每个小节，在对应 beat 位置的 <note> 之前插入 <harmony> 元素。
 *
 * @param originalXml - 原始 MusicXML 文本（无和弦）
 * @param score - 带和弦标注的 Score 对象
 * @returns 带 <harmony> 元素的 MusicXML 文本
 */
export function injectChordsToMusicXML(originalXml: string, score: Score): string {
  // Build a map: measure number → sorted chords
  const chordsByMeasure = new Map<number, ChordSymbol[]>();
  for (const measure of score.measures) {
    if (measure.chords.length > 0) {
      const sorted = [...measure.chords].sort((a, b) => a.beat - b.beat);
      chordsByMeasure.set(measure.number, sorted);
    }
  }

  if (chordsByMeasure.size === 0) return originalXml;

  // Detect line ending style from the original XML
  const eol = originalXml.includes('\r\n') ? '\r\n' : '\n';

  // Duration type to quarter-note mapping
  const typeToQuarters: Record<string, number> = {
    whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125,
  };

  // Process each <measure> block using regex (handles both single-line and multi-line notes)
  const result = originalXml.replace(
    /<measure\s+([^>]*)>([\s\S]*?)<\/measure>/g,
    (fullMatch, attrs: string, measureContent: string) => {
      const numMatch = attrs.match(/number="(\d+)"/);
      if (!numMatch) return fullMatch;
      const numStr = numMatch[1];
      const measureNum = parseInt(numStr, 10);
      const chords = chordsByMeasure.get(measureNum);
      if (!chords || chords.length === 0) return fullMatch;

      // Find all <note>...</note> blocks and track beat positions
      const notePositions: { index: number; beat: number; isChord: boolean }[] = [];
      const noteRegex = /<note\b[^>]*>([\s\S]*?)<\/note>/g;
      let nm: RegExpExecArray | null;
      let currentBeat = 0;

      while ((nm = noteRegex.exec(measureContent)) !== null) {
        const noteBody = nm[1];
        const isChordNote = /<chord\s*\/?>/.test(noteBody);

        // Extract duration type
        const typeMatch = noteBody.match(/<type>(\w+)<\/type>/);
        const durType = typeMatch ? typeMatch[1] : 'quarter';
        const dotCount = (noteBody.match(/<dot\s*\/?>/g) || []).length;

        let quarterDuration = typeToQuarters[durType] ?? 1;
        let dotVal = quarterDuration;
        for (let d = 0; d < dotCount; d++) {
          dotVal /= 2;
          quarterDuration += dotVal;
        }

        if (!isChordNote) {
          notePositions.push({ index: nm.index, beat: currentBeat, isChord: false });
          currentBeat += quarterDuration;
        } else {
          notePositions.push({ index: nm.index, beat: currentBeat, isChord: true });
        }
      }

      // For each chord, determine insertion point (before the note at matching beat)
      const insertions = new Map<number, string[]>();

      for (const chord of chords) {
        let targetIdx: number | null = null;

        for (const np of notePositions) {
          if (np.isChord) continue;
          if (np.beat >= chord.beat - 0.001) {
            targetIdx = np.index;
            break;
          }
        }

        // Fallback: before first non-chord note
        if (targetIdx === null) {
          const first = notePositions.find(n => !n.isChord);
          if (first) targetIdx = first.index;
        }

        if (targetIdx !== null) {
          // Detect indentation from context: find the line boundary before <note>
          const before = measureContent.substring(0, targetIdx);
          const lastNL = before.lastIndexOf('\n');
          const lineStart = lastNL >= 0 ? before.substring(lastNL + 1) : '';
          const indentMatch = lineStart.match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1] : '      ';

          const harmonyXml = chordToHarmonyXML(chord, indent, eol);

          // Insert at the line boundary (after the newline, before the indent),
          // so <harmony> gets its own properly indented line.
          const insertAt = lastNL >= 0 ? lastNL + 1 : targetIdx;

          if (!insertions.has(insertAt)) {
            insertions.set(insertAt, []);
          }
          insertions.get(insertAt)!.push(harmonyXml);
        }
      }

      // Rebuild measure content (insert from end to preserve offsets)
      const sorted = [...insertions.entries()].sort((a, b) => b[0] - a[0]);
      let newContent = measureContent;
      for (const [idx, harmonies] of sorted) {
        const harmonyStr = harmonies.join('');
        newContent = newContent.substring(0, idx) + harmonyStr + newContent.substring(idx);
      }

      return `<measure ${attrs}>${newContent}</measure>`;
    }
  );

  return result;
}
