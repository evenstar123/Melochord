import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  checkChordCoverage,
  checkTransitionProbability,
  validateHarmonization,
  chordPitchClasses,
  rootToSemitone,
} from '../src/harmonizer/chord-validator.js';
import type {
  Measure,
  ChordSymbol,
  NoteLetter,
  Accidental,
  ChordQuality,
  Score,
  TimeSignature,
  KeySignature,
} from '../src/core/types.js';
import { NOTE_TO_SEMITONE, CHORD_TEMPLATES } from '../src/core/constants.js';

// ============ Generators ============

const noteLetterArb: fc.Arbitrary<NoteLetter> = fc.constantFrom(
  'C', 'D', 'E', 'F', 'G', 'A', 'B',
);

const accidentalArb: fc.Arbitrary<Accidental> = fc.constantFrom(
  'none', 'sharp', 'flat',
);

const chordQualityArb: fc.Arbitrary<ChordQuality> = fc.constantFrom(
  ...Object.keys(CHORD_TEMPLATES) as ChordQuality[],
);

/** Generate a random ChordSymbol at beat 0 */
const chordSymbolArb: fc.Arbitrary<ChordSymbol> = fc.record({
  root: noteLetterArb,
  rootAccidental: accidentalArb,
  quality: chordQualityArb,
  beat: fc.constant(0),
});

/** Pitch class 0-11 */
const pitchClassArb = fc.integer({ min: 0, max: 11 });

// ============ Helpers ============

/** Map a pitch class (0-11) back to a NoteLetter + Accidental */
function pitchClassToNoteInfo(pc: number): { step: NoteLetter; accidental: Accidental } {
  const map: Array<{ step: NoteLetter; accidental: Accidental }> = [
    { step: 'C', accidental: 'none' },    // 0
    { step: 'C', accidental: 'sharp' },    // 1
    { step: 'D', accidental: 'none' },    // 2
    { step: 'D', accidental: 'sharp' },    // 3
    { step: 'E', accidental: 'none' },    // 4
    { step: 'F', accidental: 'none' },    // 5
    { step: 'F', accidental: 'sharp' },    // 6
    { step: 'G', accidental: 'none' },    // 7
    { step: 'G', accidental: 'sharp' },    // 8
    { step: 'A', accidental: 'none' },    // 9
    { step: 'A', accidental: 'sharp' },    // 10
    { step: 'B', accidental: 'none' },    // 11
  ];
  return map[pc];
}

/** Build a Measure with a single note at beat 0 */
function makeMeasureWithNote(pc: number): Measure {
  const { step, accidental } = pitchClassToNoteInfo(pc);
  return {
    number: 1,
    events: [
      {
        type: 'note' as const,
        pitch: { step, accidental, octave: 4 },
        duration: 'quarter' as const,
        dots: 0,
        tieStart: false,
        tieStop: false,
        beat: 0,
      },
    ],
    chords: [],
  };
}


// ============ Property Tests ============

// Feature: harmonize-pipeline-improvements, Property 5: 和弦音覆盖检查正确性
describe('Property 5: 和弦音覆盖检查正确性', () => {
  /**
   * **Validates: Requirements 4.1**
   *
   * For any ChordSymbol and a melody Note on a strong beat,
   * checkChordCoverage returns true if and only if the note's pitch (mod 12)
   * belongs to the chord's pitch class set computed from CHORD_TEMPLATES.
   */
  it('checkChordCoverage returns true iff note pitch class is in chord pitch class set', () => {
    fc.assert(
      fc.property(
        chordSymbolArb,
        pitchClassArb,
        (chord, notePc) => {
          const measure = makeMeasureWithNote(notePc);
          const result = checkChordCoverage(measure, chord, 0);

          // Compute expected pitch class set independently
          const rootSemi = rootToSemitone(chord.root, chord.rootAccidental);
          const template = CHORD_TEMPLATES[chord.quality];
          const expectedPcs = new Set(template.map((interval) => (rootSemi + interval) % 12));
          const expected = expectedPcs.has(notePc);

          expect(result).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('checkChordCoverage returns true when no note is present at the beat', () => {
    fc.assert(
      fc.property(
        chordSymbolArb,
        (chord) => {
          const emptyMeasure: Measure = {
            number: 1,
            events: [],
            chords: [],
          };
          expect(checkChordCoverage(emptyMeasure, chord, 0)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('chordPitchClasses produces correct set from CHORD_TEMPLATES', () => {
    fc.assert(
      fc.property(
        chordSymbolArb,
        (chord) => {
          const pcs = chordPitchClasses(chord);
          const rootSemi = rootToSemitone(chord.root, chord.rootAccidental);
          const template = CHORD_TEMPLATES[chord.quality];

          // Every pitch class in the set should match template offsets
          const expectedOffsets = template.map((interval) => (rootSemi + interval) % 12);
          for (const pc of pcs) {
            expect(expectedOffsets).toContain(pc);
          }
          // And every template offset should be in the set
          for (const offset of expectedOffsets) {
            expect(pcs.has(offset)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============ Generators for Property 6 ============

/** Small set of RNA chord labels for generating transition matrices */
const rnaChordArb: fc.Arbitrary<string> = fc.constantFrom(
  'I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°', 'V7', 'I7', 'IV7',
);

/** Generate a small random transition matrix with a few RNA chord keys */
const transitionMatrixArb: fc.Arbitrary<Record<string, Record<string, number>>> = fc
  .uniqueArray(rnaChordArb, { minLength: 1, maxLength: 6 })
  .chain((fromKeys) =>
    fc.tuple(
      fc.constant(fromKeys),
      fc.array(
        fc.tuple(
          fc.constantFrom(...fromKeys),
          fc.uniqueArray(rnaChordArb, { minLength: 0, maxLength: 4 }),
          fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 4, maxLength: 4 }),
        ),
        { minLength: fromKeys.length, maxLength: fromKeys.length },
      ),
    ),
  )
  .map(([fromKeys, rows]) => {
    const matrix: Record<string, Record<string, number>> = {};
    for (let i = 0; i < fromKeys.length; i++) {
      const [, toKeys, probs] = rows[i];
      const row: Record<string, number> = {};
      for (let j = 0; j < toKeys.length; j++) {
        row[toKeys[j]] = probs[j % probs.length];
      }
      matrix[fromKeys[i]] = row;
    }
    return matrix;
  });

// Feature: harmonize-pipeline-improvements, Property 6: 转换概率查询正确性
describe('Property 6: 转换概率查询正确性', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any two RNA chord strings `from` and `to`,
   * checkTransitionProbability returns a probability equal to
   * transitionMatrix[from][to] (if it exists), otherwise 0.
   * The `pass` field should equal `probability >= threshold`.
   */
  it('probability equals matrix[from][to] if exists, else 0; pass equals probability >= threshold', () => {
    fc.assert(
      fc.property(
        transitionMatrixArb,
        rnaChordArb,
        rnaChordArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (matrix, from, to, threshold) => {
          const result = checkTransitionProbability(from, to, matrix, threshold);

          // Expected probability: matrix[from][to] if it exists, else 0
          const expectedProbability = matrix[from]?.[to] ?? 0;
          expect(result.probability).toBe(expectedProbability);

          // Expected pass: probability >= threshold
          const expectedPass = expectedProbability >= threshold;
          expect(result.pass).toBe(expectedPass);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns probability 0 and pass false when from chord is not in matrix', () => {
    fc.assert(
      fc.property(
        rnaChordArb,
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (to, threshold) => {
          // Empty matrix — no from chord exists
          const emptyMatrix: Record<string, Record<string, number>> = {};
          const result = checkTransitionProbability('MISSING', to, emptyMatrix, threshold);

          expect(result.probability).toBe(0);
          expect(result.pass).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns probability 0 when to chord is not in the from row', () => {
    fc.assert(
      fc.property(
        rnaChordArb,
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (from, threshold) => {
          // Matrix has the from key but the to key is missing
          const matrix: Record<string, Record<string, number>> = {
            [from]: { 'EXISTING': 0.5 },
          };
          const result = checkTransitionProbability(from, 'NONEXISTENT', matrix, threshold);

          expect(result.probability).toBe(0);
          expect(result.pass).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============ Generators for Property 7 ============

/** Generate a ChordSymbol with a random beat position */
const chordSymbolWithBeatArb: fc.Arbitrary<ChordSymbol> = fc.record({
  root: noteLetterArb,
  rootAccidental: accidentalArb,
  quality: chordQualityArb,
  beat: fc.integer({ min: 0, max: 3 }),
});

/** Generate a Measure with random chords (no events needed for this property) */
const measureArb: fc.Arbitrary<Measure> = fc.record({
  number: fc.integer({ min: 1, max: 100 }),
  events: fc.constant([]),
  chords: fc.array(chordSymbolWithBeatArb, { minLength: 0, maxLength: 4 }),
});

const keySignatureArb: fc.Arbitrary<KeySignature> = fc.record({
  tonic: noteLetterArb,
  tonicAccidental: accidentalArb,
  mode: fc.constantFrom('major' as const, 'minor' as const),
  fifths: fc.integer({ min: -7, max: 7 }),
});

const timeSignatureArb: fc.Arbitrary<TimeSignature> = fc.record({
  beats: fc.constantFrom(2, 3, 4, 6),
  beatType: fc.constantFrom(4, 8),
});

/** Generate a minimal random Score */
const scoreArb: fc.Arbitrary<Score> = fc.record({
  title: fc.constant('Test'),
  composer: fc.constant('Test'),
  key: keySignatureArb,
  time: timeSignatureArb,
  tempo: fc.constant(120),
  measures: fc.array(measureArb, { minLength: 1, maxLength: 8 }),
});

// Feature: harmonize-pipeline-improvements, Property 7: 验证不修改和弦数据
describe('Property 7: 验证不修改和弦数据', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any Score object, after executing validateHarmonization,
   * every Measure's chords array should be deeply equal to what it was
   * before validation.
   */
  it('validateHarmonization does not modify any chord data in the Score', () => {
    fc.assert(
      fc.property(
        scoreArb,
        transitionMatrixArb,
        (score, matrix) => {
          // Deep clone chord data before validation
          const chordsBefore = score.measures.map((m) =>
            m.chords.map((c) => ({ ...c })),
          );

          // Run validation
          validateHarmonization(score, matrix);

          // Verify every measure's chords are unchanged
          for (let i = 0; i < score.measures.length; i++) {
            const measure = score.measures[i];
            expect(measure.chords).toHaveLength(chordsBefore[i].length);
            for (let j = 0; j < measure.chords.length; j++) {
              expect(measure.chords[j]).toEqual(chordsBefore[i][j]);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
