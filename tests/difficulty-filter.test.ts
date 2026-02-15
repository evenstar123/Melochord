import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  filterChord,
  DIFFICULTY_WHITELISTS,
  FUNCTIONAL_SUBSTITUTIONS,
} from '../src/harmonizer/difficulty-filter.js';

// ============ Generators ============

/** RNA chord base degrees (upper = major, lower = minor) */
const baseDegreeArb: fc.Arbitrary<string> = fc.constantFrom(
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII',
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii',
);

/** Optional accidental prefix */
const accidentalPrefixArb: fc.Arbitrary<string> = fc.constantFrom('', '#', 'b');

/** Optional quality suffix */
const qualitySuffixArb: fc.Arbitrary<string> = fc.constantFrom(
  '', '7', 'maj7', '°', 'dim', 'aug', 'sus2', 'sus4',
);

/** Optional inversion marker (e.g. "/5", "/G") */
const inversionArb: fc.Arbitrary<string> = fc.constantFrom(
  '', '/3', '/5', '/G', '/bass',
);

/** Generate a broad set of RNA chord strings including valid and edge cases */
const rnaChordArb: fc.Arbitrary<string> = fc
  .tuple(accidentalPrefixArb, baseDegreeArb, qualitySuffixArb, inversionArb)
  .map(([acc, deg, qual, inv]) => `${acc}${deg}${qual}${inv}`);

/** Difficulty levels */
const difficultyArb: fc.Arbitrary<string> = fc.constantFrom(
  'basic', 'intermediate', 'advanced',
);

// ============ Helpers ============

/**
 * Strip inversion markers (slash and everything after) to get the base chord,
 * mirroring the normalizeChord logic in difficulty-filter.ts.
 */
function stripInversion(chord: string): string {
  const slashIdx = chord.indexOf('/');
  return slashIdx >= 0 ? chord.slice(0, slashIdx) : chord;
}

// ============ Property Tests ============

// Feature: harmonize-pipeline-improvements, Property 10: 难度过滤输出始终合规
describe('Property 10: 难度过滤输出始终合规', () => {
  /**
   * **Validates: Requirements 6.2, 6.3, 6.5**
   *
   * For any RNA chord string and difficulty level, filterChord's output should satisfy:
   * (a) When difficulty is 'advanced', output equals input (no replacement)
   * (b) When difficulty is 'basic' or 'intermediate', the output chord
   *     (after stripping modifiers to get the base degree) must be in the
   *     corresponding difficulty's whitelist
   */
  it('advanced difficulty always returns input unchanged', () => {
    fc.assert(
      fc.property(
        rnaChordArb,
        (chord) => {
          const result = filterChord(chord, 'advanced');
          expect(result.filtered).toBe(chord);
          expect(result.wasReplaced).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('basic difficulty output is always in the basic whitelist', () => {
    fc.assert(
      fc.property(
        rnaChordArb,
        (chord) => {
          const result = filterChord(chord, 'basic');
          const normalized = stripInversion(result.filtered);
          const whitelist = DIFFICULTY_WHITELISTS['basic'];
          expect(whitelist).toContain(normalized);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('intermediate difficulty output is always in the intermediate whitelist', () => {
    fc.assert(
      fc.property(
        rnaChordArb,
        (chord) => {
          const result = filterChord(chord, 'intermediate');
          const normalized = stripInversion(result.filtered);
          const whitelist = DIFFICULTY_WHITELISTS['intermediate'];
          expect(whitelist).toContain(normalized);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('whitelisted chords pass through without replacement for basic', () => {
    const basicWhitelist = DIFFICULTY_WHITELISTS['basic'];
    fc.assert(
      fc.property(
        fc.constantFrom(...basicWhitelist),
        inversionArb,
        (chord, inv) => {
          const input = `${chord}${inv}`;
          const result = filterChord(input, 'basic');
          // Whitelisted chord should not be replaced
          expect(result.filtered).toBe(input);
          expect(result.wasReplaced).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('whitelisted chords pass through without replacement for intermediate', () => {
    const intermediateWhitelist = DIFFICULTY_WHITELISTS['intermediate'];
    fc.assert(
      fc.property(
        fc.constantFrom(...intermediateWhitelist),
        inversionArb,
        (chord, inv) => {
          const input = `${chord}${inv}`;
          const result = filterChord(input, 'intermediate');
          expect(result.filtered).toBe(input);
          expect(result.wasReplaced).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
