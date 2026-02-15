import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseMusicXML } from '../src/parser/musicxml-parser.js';
import { analyzeKey, analyzeKeySegmented, formatKey, getEffectiveKey } from '../src/analyzer/key-analyzer.js';
import type { Score, Note, Measure, KeySignature, NoteLetter, Accidental } from '../src/core/types.js';

// 加载小星星测试文件
const twinkleXml = readFileSync(
  resolve(__dirname, 'fixtures/twinkle.xml'),
  'utf-8'
);

/** 快速构建一个只含指定音符的 Score，用于测试 KS 算法 */
function makeScore(
  key: KeySignature,
  noteSteps: Array<{ step: string; octave?: number; duration?: string; accidental?: string }>
): Score {
  const events: Note[] = noteSteps.map((n, i) => ({
    type: 'note' as const,
    pitch: {
      step: (n.step as any),
      accidental: (n.accidental as any) || 'none',
      octave: n.octave ?? 4,
    },
    duration: (n.duration as any) || 'quarter',
    dots: 0,
    tieStart: false,
    tieStop: false,
    beat: i,
  }));

  const measure: Measure = {
    number: 1,
    events,
    chords: [],
  };

  return {
    title: 'Test',
    composer: '',
    key,
    time: { beats: 4, beatType: 4 },
    tempo: 120,
    measures: [measure],
  };
}

describe('analyzeKey', () => {
  it('小星星应识别为 C 大调', () => {
    const score = parseMusicXML(twinkleXml);
    const result = analyzeKey(score);

    expect(result.key.tonic).toBe('C');
    expect(result.key.mode).toBe('major');
    expect(result.confidence).toBeGreaterThan(0.7);
    // MusicXML 有显式调号，直接信任
    expect(result.source).toBe('musicxml');
  });

  it('C 大调音阶音符应验证为 C 大调', () => {
    const cMajorKey: KeySignature = {
      tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0,
    };
    // C 大调音阶重复多次，确保统计显著
    const notes = [
      { step: 'C' }, { step: 'D' }, { step: 'E' }, { step: 'F' },
      { step: 'G' }, { step: 'A' }, { step: 'B' },
      { step: 'C' }, { step: 'E' }, { step: 'G' }, // 强调 C-E-G
      { step: 'C', duration: 'half' }, { step: 'G', duration: 'half' },
    ];
    const score = makeScore(cMajorKey, notes);
    const result = analyzeKey(score);

    expect(result.key.tonic).toBe('C');
    expect(result.key.mode).toBe('major');
    expect(result.source).toBe('musicxml-verified');
  });

  it('A 小调音符应能被 KS 算法识别', () => {
    const aMinorKey: KeySignature = {
      tonic: 'A', tonicAccidental: 'none', mode: 'minor', fifths: 0,
    };
    // A 小调特征音符：A-B-C-D-E-F-G，强调 A-C-E
    const notes = [
      { step: 'A' }, { step: 'B' }, { step: 'C' }, { step: 'D' },
      { step: 'E' }, { step: 'F' }, { step: 'G' },
      { step: 'A' }, { step: 'C' }, { step: 'E' },
      { step: 'A', duration: 'whole' },
    ];
    const score = makeScore(aMinorKey, notes);
    const result = analyzeKey(score);

    expect(result.key.tonic).toBe('A');
    expect(result.key.mode).toBe('minor');
  });

  it('G 大调音符应验证为 G 大调', () => {
    const gMajorKey: KeySignature = {
      tonic: 'G', tonicAccidental: 'none', mode: 'major', fifths: 1,
    };
    // G 大调：G-A-B-C-D-E-F#
    const notes = [
      { step: 'G' }, { step: 'A' }, { step: 'B' }, { step: 'C' },
      { step: 'D' }, { step: 'E' }, { step: 'F', accidental: 'sharp' },
      { step: 'G', duration: 'half' }, { step: 'B' }, { step: 'D' },
      { step: 'G', duration: 'whole' },
    ];
    const score = makeScore(gMajorKey, notes);
    const result = analyzeKey(score);

    expect(result.key.tonic).toBe('G');
    expect(result.key.mode).toBe('major');
    expect(result.source).toBe('musicxml-verified');
  });

  it('音符太少时应信任 MusicXML 调号', () => {
    const key: KeySignature = {
      tonic: 'E', tonicAccidental: 'flat', mode: 'major', fifths: -3,
    };
    const score = makeScore(key, [{ step: 'E', accidental: 'flat' }]);
    const result = analyzeKey(score);

    expect(result.key.tonic).toBe('E');
    expect(result.key.tonicAccidental).toBe('flat');
    expect(result.source).toBe('musicxml');
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('无显式调号时应返回 top 候选列表', () => {
    // 手动构造无 keyExplicit 的 Score，让 KS 算法运行
    const cMajorKey: KeySignature = {
      tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0,
    };
    const notes = [
      { step: 'C' }, { step: 'D' }, { step: 'E' }, { step: 'F' },
      { step: 'G' }, { step: 'A' }, { step: 'B' },
      { step: 'C' }, { step: 'E' }, { step: 'G' },
      { step: 'C', duration: 'half' }, { step: 'G', duration: 'half' },
    ];
    const score = makeScore(cMajorKey, notes);
    const result = analyzeKey(score);

    expect(result.candidates).toBeDefined();
    expect(result.candidates!.length).toBeGreaterThanOrEqual(3);
    // 第一个候选应该是 C major
    expect(result.candidates![0].key).toBe('C');
    expect(result.candidates![0].mode).toBe('major');
  });
});

describe('formatKey', () => {
  it('应正确格式化 C 大调', () => {
    expect(formatKey({
      tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0,
    })).toBe('C major');
  });

  it('应正确格式化 F# 小调', () => {
    expect(formatKey({
      tonic: 'F', tonicAccidental: 'sharp', mode: 'minor', fifths: 3,
    })).toBe('F# minor');
  });

  it('应正确格式化 Bb 大调', () => {
    expect(formatKey({
      tonic: 'B', tonicAccidental: 'flat', mode: 'major', fifths: -2,
    })).toBe('Bb major');
  });
});


// ============ Generators for Property 8 ============

const noteLetterArb: fc.Arbitrary<NoteLetter> = fc.constantFrom(
  'C', 'D', 'E', 'F', 'G', 'A', 'B',
);

const accidentalArb: fc.Arbitrary<Accidental> = fc.constantFrom(
  'none', 'sharp', 'flat',
);

const keySignatureArb: fc.Arbitrary<KeySignature> = fc.record({
  tonic: noteLetterArb,
  tonicAccidental: accidentalArb,
  mode: fc.constantFrom('major' as const, 'minor' as const),
  fifths: fc.integer({ min: -7, max: 7 }),
});

/**
 * Generate a Score with N measures where some measures have keyChange set.
 * Returns the score and a valid measure number to query.
 */
const scoreWithKeyChangesArb: fc.Arbitrary<{ score: Score; queryMeasureNumber: number }> = fc
  .integer({ min: 1, max: 20 })
  .chain((numMeasures) =>
    fc.tuple(
      keySignatureArb,
      fc.array(
        fc.tuple(
          fc.boolean(),
          keySignatureArb,
        ),
        { minLength: numMeasures, maxLength: numMeasures },
      ),
      fc.integer({ min: 1, max: numMeasures }),
    ).map(([scoreKey, measureData, queryNum]) => {
      const measures: Measure[] = measureData.map(([ hasKeyChange, kc], i) => ({
        number: i + 1,
        events: [],
        chords: [],
        ...(hasKeyChange ? { keyChange: kc } : {}),
      }));
      const score: Score = {
        title: 'Test',
        composer: '',
        key: scoreKey,
        time: { beats: 4, beatType: 4 },
        tempo: 120,
        measures,
      };
      return { score, queryMeasureNumber: queryNum };
    }),
  );

// Feature: harmonize-pipeline-improvements, Property 8: getEffectiveKey 返回正确调性
describe('Property 8: getEffectiveKey 返回正确调性', () => {
  /**
   * **Validates: Requirements 5.5, 5.6**
   *
   * For any Score object (where some Measures have keyChange set),
   * for any measure number n, getEffectiveKey(score, n) should return
   * the keyChange of the most recent measure at or before n that has
   * keyChange set; if no such measure exists, return score.key.
   */
  it('returns the most recent keyChange at or before the queried measure, or score.key if none', () => {
    fc.assert(
      fc.property(
        scoreWithKeyChangesArb,
        ({ score, queryMeasureNumber }) => {
          const result = getEffectiveKey(score, queryMeasureNumber);

          // Manually compute expected effective key
          let expected = score.key;
          const sorted = [...score.measures].sort((a, b) => a.number - b.number);
          for (const m of sorted) {
            if (m.number > queryMeasureNumber) break;
            if (m.keyChange) {
              expected = m.keyChange;
            }
          }

          expect(result).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns score.key when no measure has keyChange', () => {
    fc.assert(
      fc.property(
        keySignatureArb,
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (scoreKey, numMeasures, queryOffset) => {
          const queryNum = Math.min(queryOffset, numMeasures);
          const measures: Measure[] = Array.from({ length: numMeasures }, (_, i) => ({
            number: i + 1,
            events: [],
            chords: [],
          }));
          const score: Score = {
            title: 'Test',
            composer: '',
            key: scoreKey,
            time: { beats: 4, beatType: 4 },
            tempo: 120,
            measures,
          };

          expect(getEffectiveKey(score, queryNum)).toEqual(scoreKey);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns the keyChange of the queried measure itself when it has one', () => {
    fc.assert(
      fc.property(
        keySignatureArb,
        keySignatureArb,
        fc.integer({ min: 1, max: 10 }),
        (scoreKey, measureKey, measureNum) => {
          const measures: Measure[] = [
            { number: measureNum, events: [], chords: [], keyChange: measureKey },
          ];
          const score: Score = {
            title: 'Test',
            composer: '',
            key: scoreKey,
            time: { beats: 4, beatType: 4 },
            tempo: 120,
            measures,
          };

          expect(getEffectiveKey(score, measureNum)).toEqual(measureKey);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============ Property 9: 短曲跳过分段分析 ============

/**
 * Generator: a Score with 1–11 measures, each containing some notes so KS has data.
 * We pick random notes per measure to give the algorithm real pitch data.
 */
const shortScoreArb: fc.Arbitrary<Score> = fc
  .integer({ min: 1, max: 11 })
  .chain((numMeasures) =>
    fc.tuple(
      keySignatureArb,
      fc.array(
        fc.array(
          fc.tuple(
            noteLetterArb,
            accidentalArb,
            fc.integer({ min: 3, max: 6 }),
            fc.constantFrom('quarter' as const, 'half' as const, 'eighth' as const),
          ),
          { minLength: 2, maxLength: 8 },
        ),
        { minLength: numMeasures, maxLength: numMeasures },
      ),
    ).map(([scoreKey, measuresData]) => {
      const measures: Measure[] = measuresData.map((notes, i) => ({
        number: i + 1,
        events: notes.map(([step, accidental, octave, duration], beat) => ({
          type: 'note' as const,
          pitch: { step, accidental, octave },
          duration,
          dots: 0,
          tieStart: false,
          tieStop: false,
          beat,
        })),
        chords: [],
      }));
      return {
        title: 'Short',
        composer: '',
        key: scoreKey,
        time: { beats: 4, beatType: 4 },
        tempo: 120,
        measures,
      } satisfies Score;
    }),
  );

// Feature: harmonize-pipeline-improvements, Property 9: 短曲跳过分段分析
describe('Property 9: 短曲跳过分段分析', () => {
  /**
   * **Validates: Requirements 5.8**
   *
   * For any Score with fewer than 12 measures, analyzeKeySegmented
   * returns an empty modulations array.
   */
  it('analyzeKeySegmented returns empty modulations for scores with < 12 measures', () => {
    fc.assert(
      fc.property(shortScoreArb, (score) => {
        expect(score.measures.length).toBeLessThan(12);

        const result = analyzeKeySegmented(score);

        expect(result.modulations).toEqual([]);
        // initialKey should still be present
        expect(result.initialKey).toBeDefined();
        expect(result.initialKey.key).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });
});

// ============ 单元测试：转调检测正确性 & 色彩音误报过滤 ============
// Requirements: 5.2, 5.3

/**
 * Helper: build a multi-measure Score with per-measure note data.
 * Each entry in `measuresNotes` produces one Measure with the given notes.
 */
function buildMultiMeasureScore(
  key: KeySignature,
  measuresNotes: Array<Array<{ step: NoteLetter; accidental?: Accidental; duration?: 'quarter' | 'half' | 'whole' | 'eighth' }>>,
): Score {
  const measures: Measure[] = measuresNotes.map((notes, idx) => ({
    number: idx + 1,
    events: notes.map((n, beat) => ({
      type: 'note' as const,
      pitch: {
        step: n.step,
        accidental: n.accidental ?? ('none' as Accidental),
        octave: 4,
      },
      duration: n.duration ?? ('quarter' as const),
      dots: 0,
      tieStart: false,
      tieStop: false,
      beat,
    })),
    chords: [],
  }));

  return {
    title: 'Test',
    composer: '',
    key,
    time: { beats: 4, beatType: 4 },
    tempo: 120,
    measures,
  };
}

describe('analyzeKeySegmented – 转调检测单元测试', () => {
  // ---- Test 1: 明确转调 C major → G major ----
  it('应检测到从 C 大调到 G 大调的转调 (Requirements 5.2)', () => {
    // C major characteristic notes: C, D, E, F, G, A, B with emphasis on C, E, G
    const cMajorMeasure = (): Array<{ step: NoteLetter; accidental?: Accidental; duration?: 'quarter' | 'half' | 'whole' | 'eighth' }> => [
      { step: 'C', duration: 'half' },
      { step: 'E' },
      { step: 'G' },
      { step: 'C' },
      { step: 'E' },
      { step: 'G', duration: 'half' },
      { step: 'D' },
      { step: 'A' },
    ];

    // G major characteristic notes: G, A, B, C, D, E, F# with emphasis on G, B, D
    const gMajorMeasure = (): Array<{ step: NoteLetter; accidental?: Accidental; duration?: 'quarter' | 'half' | 'whole' | 'eighth' }> => [
      { step: 'G', duration: 'half' },
      { step: 'B' },
      { step: 'D' },
      { step: 'G' },
      { step: 'B' },
      { step: 'D', duration: 'half' },
      { step: 'F', accidental: 'sharp' },
      { step: 'A' },
    ];

    // 8 measures C major + 8 measures G major = 16 measures total
    const measuresNotes = [
      ...Array.from({ length: 8 }, () => cMajorMeasure()),
      ...Array.from({ length: 8 }, () => gMajorMeasure()),
    ];

    const cMajorKey: KeySignature = {
      tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0,
    };

    const score = buildMultiMeasureScore(cMajorKey, measuresNotes);
    const result = analyzeKeySegmented(score);

    // Should detect at least one modulation
    expect(result.modulations.length).toBeGreaterThanOrEqual(1);

    // The new key should be G major
    const mod = result.modulations[0];
    expect(mod.newKey.tonic).toBe('G');
    expect(mod.newKey.mode).toBe('major');
    expect(mod.confidence).toBeGreaterThanOrEqual(0.65);

    // Modulation point should be somewhere around measure 9 (±2)
    expect(mod.measureNumber).toBeGreaterThanOrEqual(7);
    expect(mod.measureNumber).toBeLessThanOrEqual(11);
  });

  // ---- Test 2: 色彩音不应误报为转调 ----
  it('含色彩音的 C 大调乐曲不应报告转调 (Requirements 5.3)', () => {
    // Pure C major measure
    const pureCMeasure = (): Array<{ step: NoteLetter; accidental?: Accidental; duration?: 'quarter' | 'half' | 'whole' | 'eighth' }> => [
      { step: 'C', duration: 'half' },
      { step: 'E' },
      { step: 'G' },
      { step: 'C' },
      { step: 'D' },
      { step: 'A' },
      { step: 'G', duration: 'half' },
    ];

    // C major measure with occasional chromatic tones (F#, Bb)
    const chromaticCMeasure = (): Array<{ step: NoteLetter; accidental?: Accidental; duration?: 'quarter' | 'half' | 'whole' | 'eighth' }> => [
      { step: 'C', duration: 'half' },
      { step: 'E' },
      { step: 'F', accidental: 'sharp' },  // chromatic passing tone
      { step: 'G' },
      { step: 'B', accidental: 'flat' },    // chromatic color tone
      { step: 'C' },
      { step: 'G', duration: 'half' },
    ];

    // 16 measures: mostly pure C major, with chromatic tones scattered in a few measures
    const measuresNotes = [
      pureCMeasure(),       // 1
      pureCMeasure(),       // 2
      pureCMeasure(),       // 3
      chromaticCMeasure(),  // 4 - has F#, Bb
      pureCMeasure(),       // 5
      pureCMeasure(),       // 6
      pureCMeasure(),       // 7
      chromaticCMeasure(),  // 8 - has F#, Bb
      pureCMeasure(),       // 9
      pureCMeasure(),       // 10
      chromaticCMeasure(),  // 11 - has F#, Bb
      pureCMeasure(),       // 12
      pureCMeasure(),       // 13
      pureCMeasure(),       // 14
      pureCMeasure(),       // 15
      pureCMeasure(),       // 16
    ];

    const cMajorKey: KeySignature = {
      tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0,
    };

    const score = buildMultiMeasureScore(cMajorKey, measuresNotes);
    const result = analyzeKeySegmented(score);

    // Should NOT detect any modulations – the chromatic tones are just color
    expect(result.modulations).toEqual([]);

    // Initial key should still be C major
    expect(result.initialKey.key.tonic).toBe('C');
    expect(result.initialKey.key.mode).toBe('major');
  });
});
