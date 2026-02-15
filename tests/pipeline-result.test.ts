/**
 * 集成单元测试：验证 PipelineResult 包含 validation、difficultyFilter、modulations 字段
 *
 * 由于管线需要 LLM + RAG API 调用，这里通过构造符合 PipelineResult 接口的对象
 * 来验证类型定义的正确性和字段结构的完整性。
 *
 * Requirements: 4.4, 5.7
 */

import { describe, it, expect } from 'vitest';
import type { PipelineResult, ValidationAnomaly } from '../src/harmonizer/harmonize-pipeline.js';
import type { Score } from '../src/core/types.js';

// ============ Helpers ============

/** 构造一个最小的 Score 对象 */
function makeMinimalScore(): Score {
  return {
    title: 'Test',
    composer: 'Test',
    key: { tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0 },
    time: { beats: 4, beatType: 4 },
    tempo: 120,
    measures: [
      { number: 1, events: [], chords: [] },
    ],
  };
}

/** 构造一个包含所有新增字段的完整 PipelineResult */
function makeFullPipelineResult(): PipelineResult {
  return {
    score: makeMinimalScore(),
    keyAnalysis: {
      key: 'C major',
      confidence: 0.92,
      source: 'ks-segmented',
      modulations: [
        { measureNumber: 9, newKey: 'G major', confidence: 0.85 },
        { measureNumber: 17, newKey: 'A minor', confidence: 0.72 },
      ],
    },
    stats: {
      totalMeasures: 24,
      apiCalls: 12,
      durationMs: 3500,
    },
    validation: {
      coveragePassRate: 0.88,
      transitionPassRate: 0.95,
      anomalyCount: 3,
      anomalies: [
        {
          type: 'coverage',
          measureNumber: 5,
          beat: 0,
          detail: '强拍 0 上的旋律音不是和弦 Am 的和弦音',
        },
        {
          type: 'transition',
          measureNumber: 8,
          beat: 2,
          detail: '和弦转换 Bdim → F 概率过低 (0.0012)',
        },
        {
          type: 'coverage',
          measureNumber: 12,
          beat: 2,
          detail: '强拍 2 上的旋律音不是和弦 G7 的和弦音',
        },
      ],
    },
    difficultyFilter: {
      totalChords: 24,
      replacedCount: 3,
      replacements: [
        { measure: 3, original: 'ii', replacement: 'IV' },
        { measure: 7, original: 'vii°', replacement: 'V' },
        { measure: 15, original: 'iii', replacement: 'I' },
      ],
    },
  };
}

// ============ Tests ============

describe('PipelineResult 结构验证 (Requirements 4.4, 5.7)', () => {
  describe('validation 字段 (Requirement 4.4)', () => {
    it('should contain coveragePassRate, transitionPassRate, anomalyCount, anomalies', () => {
      const result = makeFullPipelineResult();

      expect(result.validation).toBeDefined();
      expect(result.validation!.coveragePassRate).toBeTypeOf('number');
      expect(result.validation!.transitionPassRate).toBeTypeOf('number');
      expect(result.validation!.anomalyCount).toBeTypeOf('number');
      expect(Array.isArray(result.validation!.anomalies)).toBe(true);
    });

    it('validation pass rates should be between 0 and 1', () => {
      const result = makeFullPipelineResult();

      expect(result.validation!.coveragePassRate).toBeGreaterThanOrEqual(0);
      expect(result.validation!.coveragePassRate).toBeLessThanOrEqual(1);
      expect(result.validation!.transitionPassRate).toBeGreaterThanOrEqual(0);
      expect(result.validation!.transitionPassRate).toBeLessThanOrEqual(1);
    });

    it('anomalyCount should match anomalies array length', () => {
      const result = makeFullPipelineResult();

      expect(result.validation!.anomalyCount).toBe(result.validation!.anomalies.length);
    });

    it('each anomaly should have type, measureNumber, beat, detail', () => {
      const result = makeFullPipelineResult();

      for (const anomaly of result.validation!.anomalies) {
        expect(['coverage', 'transition']).toContain(anomaly.type);
        expect(anomaly.measureNumber).toBeTypeOf('number');
        expect(anomaly.beat).toBeTypeOf('number');
        expect(anomaly.detail).toBeTypeOf('string');
        expect(anomaly.detail.length).toBeGreaterThan(0);
      }
    });

    it('validation field should be optional (undefined when not enabled)', () => {
      const result = makeFullPipelineResult();
      delete (result as Partial<PipelineResult>).validation;

      expect(result.validation).toBeUndefined();
    });
  });

  describe('difficultyFilter 字段 (Requirement 4.4)', () => {
    it('should contain totalChords, replacedCount, replacements', () => {
      const result = makeFullPipelineResult();

      expect(result.difficultyFilter).toBeDefined();
      expect(result.difficultyFilter!.totalChords).toBeTypeOf('number');
      expect(result.difficultyFilter!.replacedCount).toBeTypeOf('number');
      expect(Array.isArray(result.difficultyFilter!.replacements)).toBe(true);
    });

    it('replacedCount should match replacements array length', () => {
      const result = makeFullPipelineResult();

      expect(result.difficultyFilter!.replacedCount).toBe(
        result.difficultyFilter!.replacements.length,
      );
    });

    it('each replacement should have measure, original, replacement', () => {
      const result = makeFullPipelineResult();

      for (const rep of result.difficultyFilter!.replacements) {
        expect(rep.measure).toBeTypeOf('number');
        expect(rep.original).toBeTypeOf('string');
        expect(rep.replacement).toBeTypeOf('string');
      }
    });

    it('difficultyFilter field should be optional (undefined for advanced)', () => {
      const result = makeFullPipelineResult();
      delete (result as Partial<PipelineResult>).difficultyFilter;

      expect(result.difficultyFilter).toBeUndefined();
    });
  });

  describe('keyAnalysis.modulations 字段 (Requirement 5.7)', () => {
    it('should contain modulations array with measureNumber, newKey, confidence', () => {
      const result = makeFullPipelineResult();

      expect(result.keyAnalysis.modulations).toBeDefined();
      expect(Array.isArray(result.keyAnalysis.modulations)).toBe(true);
      expect(result.keyAnalysis.modulations!.length).toBeGreaterThan(0);
    });

    it('each modulation should have measureNumber, newKey, confidence', () => {
      const result = makeFullPipelineResult();

      for (const mod of result.keyAnalysis.modulations!) {
        expect(mod.measureNumber).toBeTypeOf('number');
        expect(mod.measureNumber).toBeGreaterThan(0);
        expect(mod.newKey).toBeTypeOf('string');
        expect(mod.newKey.length).toBeGreaterThan(0);
        expect(mod.confidence).toBeTypeOf('number');
        expect(mod.confidence).toBeGreaterThanOrEqual(0);
        expect(mod.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('modulations should be optional (undefined when no modulations detected)', () => {
      const result = makeFullPipelineResult();
      result.keyAnalysis.modulations = undefined;

      expect(result.keyAnalysis.modulations).toBeUndefined();
    });

    it('modulations can be an empty array (no key changes found)', () => {
      const result = makeFullPipelineResult();
      result.keyAnalysis.modulations = [];

      expect(result.keyAnalysis.modulations).toEqual([]);
    });
  });

  describe('完整 PipelineResult 结构', () => {
    it('should have all required top-level fields', () => {
      const result = makeFullPipelineResult();

      expect(result.score).toBeDefined();
      expect(result.keyAnalysis).toBeDefined();
      expect(result.stats).toBeDefined();
      // New optional fields
      expect(result.validation).toBeDefined();
      expect(result.difficultyFilter).toBeDefined();
    });

    it('keyAnalysis should retain original fields alongside modulations', () => {
      const result = makeFullPipelineResult();

      expect(result.keyAnalysis.key).toBeTypeOf('string');
      expect(result.keyAnalysis.confidence).toBeTypeOf('number');
      expect(result.keyAnalysis.source).toBeTypeOf('string');
      expect(result.keyAnalysis.modulations).toBeDefined();
    });

    it('stats should retain original fields', () => {
      const result = makeFullPipelineResult();

      expect(result.stats.totalMeasures).toBeTypeOf('number');
      expect(result.stats.apiCalls).toBeTypeOf('number');
      expect(result.stats.durationMs).toBeTypeOf('number');
    });
  });
});
