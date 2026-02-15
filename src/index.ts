/**
 * Harmony Engine - 自动和声分析引擎
 * 公共 API 入口
 */

// 核心类型
export type {
  Score, Measure, MusicEvent, Note, Rest, Pitch,
  KeySignature, TimeSignature, ChordSymbol,
  NoteLetter, Accidental, DurationType, ChordQuality, Mode,
} from './core/types.js';

// 常量
export {
  NOTE_TO_SEMITONE, ACCIDENTAL_OFFSET, NOTE_LETTERS,
  FIFTHS_TO_MAJOR_KEY, MAJOR_SCALE_INTERVALS, MINOR_SCALE_INTERVALS,
  CHORD_TEMPLATES, DURATION_TO_QUARTERS,
} from './core/constants.js';

// 解析器
export { parseMusicXML } from './parser/musicxml-parser.js';
export { mergeMusicXMLPages } from './parser/musicxml-merge.js';

// 分析器
export { analyzeKey, formatKey } from './analyzer/key-analyzer.js';
export type { KeyAnalysisResult } from './analyzer/key-analyzer.js';

// 和声引擎
export { extractMelodyFeatures, featuresToSearchQueries } from './harmonizer/melody-features.js';
export type { MelodyFeatures } from './harmonizer/melody-features.js';
export { RAGRetriever } from './harmonizer/rag-retriever.js';
export { LLMHarmonizer } from './harmonizer/llm-harmonizer.js';
export { HarmonizePipeline } from './harmonizer/harmonize-pipeline.js';
export type { PipelineConfig, PipelineResult } from './harmonizer/harmonize-pipeline.js';

// IR → MusicXML 转换器
export { injectChordsToMusicXML, accidentalToAlter, QUALITY_TO_KIND } from './converter/ir-to-musicxml.js';

// IR → ABC Notation 转换器
export { scoreToABC, keyToABCField, noteToABC, chordToABC } from './converter/ir-to-abc.js';

// OMR（光学乐谱识别）— Audiveris 集成
export { recognizeScore, recognizeBuffer } from './omr/audiveris-omr.js';
export type { OMRResult, OMRConfig } from './omr/audiveris-omr.js';

// 渲染导出（SVG / PNG / PDF）
export { musicxmlToSVG, musicxmlToSVGPages, musicxmlToPNG, musicxmlToPDF } from './converter/score-to-render.js';
export type { RenderOptions } from './converter/score-to-render.js';
