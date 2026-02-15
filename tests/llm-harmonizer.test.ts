import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { rnaToChordSymbol, parseLLMOutput, buildUserPrompt } from '../src/harmonizer/llm-harmonizer.js';
import { LLMHarmonizer } from '../src/harmonizer/llm-harmonizer.js';
import type { MeasureChords } from '../src/harmonizer/llm-harmonizer.js';
import type { MelodyFeatures } from '../src/harmonizer/melody-features.js';
import type { Score, Measure } from '../src/core/types.js';

describe('rnaToChordSymbol', () => {
  // C 大调 (tonic = 0)
  it('I → C major', () => {
    const chord = rnaToChordSymbol('I', 0, 'major', 0);
    expect(chord).not.toBeNull();
    expect(chord!.root).toBe('C');
    expect(chord!.quality).toBe('major');
  });

  it('V → G major', () => {
    const chord = rnaToChordSymbol('V', 0, 'major', 0);
    expect(chord!.root).toBe('G');
    expect(chord!.quality).toBe('major');
  });

  it('V7 → G dominant7', () => {
    const chord = rnaToChordSymbol('V7', 0, 'major', 0);
    expect(chord!.root).toBe('G');
    expect(chord!.quality).toBe('dominant7');
  });

  it('iv → F minor', () => {
    const chord = rnaToChordSymbol('iv', 0, 'major', 0);
    expect(chord!.root).toBe('F');
    expect(chord!.quality).toBe('minor');
  });

  it('vi → A minor', () => {
    const chord = rnaToChordSymbol('vi', 0, 'major', 0);
    expect(chord!.root).toBe('A');
    expect(chord!.quality).toBe('minor');
  });

  it('ii → D minor', () => {
    const chord = rnaToChordSymbol('ii', 0, 'major', 0);
    expect(chord!.root).toBe('D');
    expect(chord!.quality).toBe('minor');
  });

  it('vii° → B diminished', () => {
    const chord = rnaToChordSymbol('vii°', 0, 'major', 0);
    expect(chord!.root).toBe('B');
    expect(chord!.quality).toBe('diminished');
  });

  // G 大调 (tonic = 7)
  it('G大调 I → G major', () => {
    const chord = rnaToChordSymbol('I', 7, 'major', 0);
    expect(chord!.root).toBe('G');
    expect(chord!.quality).toBe('major');
  });

  it('G大调 IV → C major', () => {
    const chord = rnaToChordSymbol('IV', 7, 'major', 0);
    expect(chord!.root).toBe('C');
    expect(chord!.quality).toBe('major');
  });

  // A 小调 (tonic = 9)
  it('A小调 i → A minor', () => {
    const chord = rnaToChordSymbol('i', 9, 'minor', 0);
    expect(chord!.root).toBe('A');
    expect(chord!.quality).toBe('minor');
  });

  it('应正确设置 beat 位置', () => {
    const chord = rnaToChordSymbol('IV', 0, 'major', 2);
    expect(chord!.beat).toBe(2);
  });

  it('无效输入应返回 null', () => {
    expect(rnaToChordSymbol('xyz', 0, 'major', 0)).toBeNull();
  });
});

describe('parseLLMOutput', () => {
  it('应解析标准格式', () => {
    const output = `1: I
2: IV V
3: vi IV
4: V I`;
    const result = parseLLMOutput(output);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ measureNumber: 1, chords: ['I'] });
    expect(result[1]).toEqual({ measureNumber: 2, chords: ['IV', 'V'] });
    expect(result[2]).toEqual({ measureNumber: 3, chords: ['vi', 'IV'] });
    expect(result[3]).toEqual({ measureNumber: 4, chords: ['V', 'I'] });
  });

  it('应处理中文冒号', () => {
    const output = `1：I\n2：V7`;
    const result = parseLLMOutput(output);
    expect(result).toHaveLength(2);
  });

  it('应处理箭头分隔', () => {
    const output = `1: I → IV → V`;
    const result = parseLLMOutput(output);
    expect(result[0].chords).toEqual(['I', 'IV', 'V']);
  });

  it('应忽略无效行', () => {
    const output = `这是一段解释\n1: I\n无效内容\n2: V`;
    const result = parseLLMOutput(output);
    expect(result).toHaveLength(2);
  });

  // 拍位置解析测试
  it('应解析带拍位置的格式，提取 beats 数组', () => {
    const output = `1: I(1)
2: IV(1) V(3)
3: vi(1) IV(2.5)
4: V(1) I(3)`;
    const result = parseLLMOutput(output);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ measureNumber: 1, chords: ['I'], beats: [1] });
    expect(result[1]).toEqual({ measureNumber: 2, chords: ['IV', 'V'], beats: [1, 3] });
    expect(result[2]).toEqual({ measureNumber: 3, chords: ['vi', 'IV'], beats: [1, 2.5] });
    expect(result[3]).toEqual({ measureNumber: 4, chords: ['V', 'I'], beats: [1, 3] });
  });

  it('应解析带升降号和七和弦的拍位置格式', () => {
    const output = `1: #iv(1) V7(3.5)`;
    const result = parseLLMOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].chords).toEqual(['#iv', 'V7']);
    expect(result[0].beats).toEqual([1, 3.5]);
  });

  it('混合格式（部分有拍位置部分没有）时 beats 应为 undefined', () => {
    const output = `1: I(1) V`;
    const result = parseLLMOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].chords).toEqual(['I', 'V']);
    expect(result[0].beats).toBeUndefined();
  });

  it('无拍位置的旧格式 beats 应为 undefined', () => {
    const output = `1: I V\n2: IV`;
    const result = parseLLMOutput(output);
    expect(result[0].beats).toBeUndefined();
    expect(result[1].beats).toBeUndefined();
  });

  it('beats 数组长度应等于 chords 数组长度', () => {
    const output = `1: I(1) IV(2) V(3)`;
    const result = parseLLMOutput(output);
    expect(result[0].beats).toBeDefined();
    expect(result[0].beats!.length).toBe(result[0].chords.length);
  });
});


// ============ 属性测试 ============

/** 生成有效的 MelodyFeatures 对象用于测试 */
function makeDummyFeatures(numMeasures = 4): MelodyFeatures {
  return {
    key: 'C',
    mode: 'major',
    meter: '4/4',
    intervalsPerMeasure: Array.from({ length: numMeasures }, () => [2, -1]),
    rhythmPerMeasure: Array.from({ length: numMeasures }, () => ['quarter', 'quarter']),
    scaleDegreesPerMeasure: Array.from({ length: numMeasures }, () => [0, 2, 4]),
    rhythmDensity: 1.5,
    numMeasures,
    measureNumbers: Array.from({ length: numMeasures }, (_, i) => i + 1),
  };
}

/** 生成有效的 RNA 和弦符号 */
const rnaChordArb = fc.constantFrom(
  'I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°',
  'V7', 'I7', 'IV7', 'ii7', 'vi7',
  'IVmaj7', 'Imaj7',
);

// Feature: harmonize-pipeline-improvements, Property 1: 前置和弦上下文包含在 prompt 中
describe('Property 1: 前置和弦上下文包含在 prompt 中', () => {
  /**
   * **Validates: Requirements 1.1, 1.3**
   */
  it('非空 previousChords 中的每个和弦符号都应出现在 prompt 中', () => {
    fc.assert(
      fc.property(
        fc.array(rnaChordArb, { minLength: 1, maxLength: 4 }),
        (previousChords) => {
          const features = makeDummyFeatures();
          const prompt = buildUserPrompt(features, 0, 4, [], previousChords);

          // 每个和弦符号都应出现在 prompt 中
          for (const chord of previousChords) {
            expect(prompt).toContain(chord);
          }

          // prompt 应包含"前一段结尾和弦"标记
          expect(prompt).toContain('前一段结尾和弦');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.3**
   */
  it('previousChords 为空数组时，prompt 不应包含"前一段结尾和弦"', () => {
    fc.assert(
      fc.property(
        fc.constant([] as string[]),
        (previousChords: string[]) => {
          const features = makeDummyFeatures();
          const prompt = buildUserPrompt(features, 0, 4, [], previousChords);

          expect(prompt).not.toContain('前一段结尾和弦');
        },
      ),
      { numRuns: 10 },
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.3**
   */
  it('previousChords 为 undefined 时，prompt 不应包含"前一段结尾和弦"', () => {
    const features = makeDummyFeatures();
    const prompt = buildUserPrompt(features, 0, 4, [], undefined);

    expect(prompt).not.toContain('前一段结尾和弦');
  });
});

// Feature: harmonize-pipeline-improvements, Property 2: RAG 结果按小节范围分组标注
describe('Property 2: RAG 结果按小节范围分组标注', () => {
  /** 生成有效的 PhraseEntry 用于 RetrievalResult */
  const phraseEntryArb = fc.record({
    song_id: fc.string({ minLength: 1, maxLength: 5 }),
    artist: fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('/') && !s.includes('\n')),
    song: fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('/') && !s.includes('\n')),
    mode: fc.constantFrom('major', 'minor'),
    chord_sequence: fc.array(fc.constantFrom('I', 'IV', 'V', 'vi', 'ii', 'V7'), { minLength: 1, maxLength: 6 }),
    melody_intervals: fc.array(fc.integer({ min: -12, max: 12 }), { minLength: 1, maxLength: 8 }),
  });

  const retrievalResultArb = fc.record({
    phrase: phraseEntryArb,
    similarity: fc.double({ min: 0.01, max: 1.0, noNaN: true }),
  });

  const measureRangeArb = fc.record({
    start: fc.integer({ min: 1, max: 20 }),
    end: fc.integer({ min: 1, max: 20 }),
  }).filter(r => r.start <= r.end);

  const annotatedRAGResultArb = fc.record({
    result: retrievalResultArb,
    measureRange: measureRangeArb,
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  it('每条 RAG 结果的 measureRange 起止小节号应出现在 prompt 中', () => {
    fc.assert(
      fc.property(
        fc.array(annotatedRAGResultArb, { minLength: 1, maxLength: 6 }),
        (ragResults) => {
          const features = makeDummyFeatures();
          const prompt = buildUserPrompt(features, 0, 4, ragResults);

          // 每条结果的 measureRange 应以 "小节 X-Y" 格式出现在 prompt 中
          for (const ar of ragResults) {
            const rangeStr = `${ar.measureRange.start}-${ar.measureRange.end}`;
            expect(prompt).toContain(rangeStr);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  it('相同 measureRange 的结果应被分组在一起展示', () => {
    fc.assert(
      fc.property(
        fc.array(annotatedRAGResultArb, { minLength: 2, maxLength: 8 }),
        (ragResults) => {
          const features = makeDummyFeatures();
          const prompt = buildUserPrompt(features, 0, 4, ragResults);

          // 按 measureRange 分组，每个组的 header "小节 X-Y 的参考:" 应只出现一次
          const groups = new Map<string, number>();
          for (const ar of ragResults) {
            const key = `${ar.measureRange.start}-${ar.measureRange.end}`;
            groups.set(key, (groups.get(key) ?? 0) + 1);
          }

          for (const [rangeKey] of groups) {
            const header = `小节 ${rangeKey} 的参考:`;
            const firstIdx = prompt.indexOf(header);
            // The header should exist
            expect(firstIdx).toBeGreaterThanOrEqual(0);
            // The header should appear exactly once (grouped, not repeated)
            const secondIdx = prompt.indexOf(header, firstIdx + 1);
            expect(secondIdx).toBe(-1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   */
  it('RAG 结果为空时，prompt 不应包含参考和弦进行段落', () => {
    const features = makeDummyFeatures();
    const prompt = buildUserPrompt(features, 0, 4, []);

    expect(prompt).not.toContain('参考和弦进行');
    expect(prompt).not.toContain('的参考:');
  });
});


// Feature: harmonize-pipeline-improvements, Property 3: 拍位置解析正确性
describe('Property 3: 拍位置解析正确性', () => {
  /** 有效的 RNA 和弦符号集合（用于生成器） */
  const validChordSymbols = [
    'I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii',
    'V7', 'I7', 'IV7', 'ii7', 'vi7',
    'IVmaj7', 'Imaj7',
    '#iv', '#IV', 'bVII', 'bIII',
  ];

  /** 生成有效的 RNA 和弦符号 */
  const chordSymbolArb = fc.constantFrom(...validChordSymbols);

  /** 生成有效的拍位置（1.0 到 4.0，步长 0.5） */
  const beatPositionArb = fc.constantFrom(1, 1.5, 2, 2.5, 3, 3.5, 4);

  /** 生成单个小节的和弦+拍位置对列表（1-3 个和弦） */
  const measureChordsArb = fc.array(
    fc.tuple(chordSymbolArb, beatPositionArb),
    { minLength: 1, maxLength: 3 },
  );

  /** 生成小节号（1-20） */
  const measureNumberArb = fc.integer({ min: 1, max: 20 });

  /** 生成一行 LLM 输出："measureNum: chord1(beat1) chord2(beat2)" */
  const measureLineArb = fc.tuple(measureNumberArb, measureChordsArb).map(
    ([num, chordBeats]) => ({
      line: `${num}: ${chordBeats.map(([c, b]) => `${c}(${b})`).join(' ')}`,
      measureNumber: num,
      chords: chordBeats.map(([c]) => c),
      beats: chordBeats.map(([, b]) => b),
    }),
  );

  /**
   * **Validates: Requirements 3.1**
   *
   * For any LLM output string matching the format "measureNumber: chord(beat) [chord(beat)]",
   * parseLLMOutput should correctly extract each chord's RNA symbol and corresponding beat position.
   * The beats array length should equal the chords array length.
   */
  it('应正确解析每个小节的和弦符号和拍位置', () => {
    fc.assert(
      fc.property(
        fc.array(measureLineArb, { minLength: 1, maxLength: 10 })
          .filter(lines => {
            // Ensure unique measure numbers so parsing is unambiguous
            const nums = lines.map(l => l.measureNumber);
            return new Set(nums).size === nums.length;
          }),
        (measures) => {
          const llmOutput = measures.map(m => m.line).join('\n');
          const parsed = parseLLMOutput(llmOutput);

          // Correct number of measures parsed
          expect(parsed.length).toBe(measures.length);

          for (let i = 0; i < measures.length; i++) {
            const expected = measures[i];
            const actual = parsed.find(p => p.measureNumber === expected.measureNumber);
            expect(actual).toBeDefined();

            // Each measure's chords match the generated chords
            expect(actual!.chords).toEqual(expected.chords);

            // Each measure's beats match the generated beats
            expect(actual!.beats).toBeDefined();
            expect(actual!.beats).toEqual(expected.beats);

            // beats.length === chords.length
            expect(actual!.beats!.length).toBe(actual!.chords.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: harmonize-pipeline-improvements, Property 4: 拍位置应用优先级
describe('Property 4: 拍位置应用优先级', () => {
  /** 创建一个用于测试 applyToScore 的 LLMHarmonizer 实例（不会调用 API） */
  const harmonizer = new LLMHarmonizer({ apiKey: 'dummy-key-for-testing' });

  /** RNA 和弦符号（保证 rnaToChordSymbol 返回非 null） */
  const validRnaArb = fc.constantFrom(
    'I', 'ii', 'iii', 'IV', 'V', 'vi',
    'V7', 'IV7', 'ii7',
  );

  /** 拍位置（1-based，合理范围 1.0 ~ 4.0） */
  const beatPositionArb = fc.constantFrom(1, 1.5, 2, 2.5, 3, 3.5, 4);

  /** 每小节拍数 */
  const beatsPerMeasureArb = fc.constantFrom(2, 3, 4, 6);

  /** 创建最小化的 Score 对象 */
  function makeScore(measureNumbers: number[], beatsPerMeasure: number): Score {
    const measures: Measure[] = measureNumbers.map(n => ({
      number: n,
      events: [],
      chords: [],
    }));
    return {
      title: 'Test',
      composer: 'Test',
      key: { tonic: 'C', tonicAccidental: 'none', mode: 'major', fifths: 0 },
      time: { beats: beatsPerMeasure, beatType: 4 },
      tempo: 120,
      measures,
    };
  }

  /**
   * **Validates: Requirements 3.2, 3.3**
   *
   * When beats field exists, applyToScore should set chord.beat = beats[i] - 1 (1-based to 0-based).
   */
  it('当 beats 存在时，和弦 beat 应为 beats[i] - 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(
          fc.tuple(validRnaArb, beatPositionArb),
          { minLength: 1, maxLength: 3 },
        ),
        beatsPerMeasureArb,
        (measureNum, chordBeatPairs, beatsPerMeasure) => {
          const chords = chordBeatPairs.map(([c]) => c);
          const beats = chordBeatPairs.map(([, b]) => b);

          const mc: MeasureChords = { measureNumber: measureNum, chords, beats };
          const score = makeScore([measureNum], beatsPerMeasure);

          harmonizer.applyToScore(score, [mc]);

          const measure = score.measures.find(m => m.number === measureNum)!;
          expect(measure.chords.length).toBe(chords.length);

          for (let i = 0; i < measure.chords.length; i++) {
            expect(measure.chords[i].beat).toBeCloseTo(beats[i] - 1, 10);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2, 3.3**
   *
   * When beats field doesn't exist, applyToScore should fall back to even distribution:
   * beat = i * (beatsPerMeasure / numChords)
   */
  it('当 beats 不存在时，应回退到均匀分配', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(validRnaArb, { minLength: 1, maxLength: 4 }),
        beatsPerMeasureArb,
        (measureNum, chords, beatsPerMeasure) => {
          const mc: MeasureChords = { measureNumber: measureNum, chords };
          // beats is undefined → even distribution
          const score = makeScore([measureNum], beatsPerMeasure);

          harmonizer.applyToScore(score, [mc]);

          const measure = score.measures.find(m => m.number === measureNum)!;
          expect(measure.chords.length).toBe(chords.length);

          const beatsPerChord = chords.length > 1
            ? beatsPerMeasure / chords.length
            : beatsPerMeasure;

          for (let i = 0; i < measure.chords.length; i++) {
            const expectedBeat = i * beatsPerChord;
            expect(measure.chords[i].beat).toBeCloseTo(expectedBeat, 10);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
