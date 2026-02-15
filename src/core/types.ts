/**
 * 核心数据类型 - 内部音乐表示 (IR)
 *
 * 设计原则：
 * 1. 保留音名语义（区分 C# 和 Db）
 * 2. 能从 MusicXML 无损转入
 * 3. 能轻松转为 ABC Notation
 * 4. 包含和声分析所需的全部信息
 */

// ============ 基础音高类型 ============

/** 音名（不含升降号） */
export type NoteLetter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** 变音记号 */
export type Accidental = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat' | 'none';

/**
 * 音高 - 完整描述一个音的高度
 * 使用音名+变音记号+八度，而非 MIDI 编号
 * 这样 C# 和 Db 是不同的对象
 */
export interface Pitch {
  /** 音名 */
  step: NoteLetter;
  /** 变音记号 */
  accidental: Accidental;
  /** 八度（国际标准，中央C = C4） */
  octave: number;
}

// ============ 节奏类型 ============

/** 音符时值类型 */
export type DurationType =
  | 'whole'     // 全音符
  | 'half'      // 二分音符
  | 'quarter'   // 四分音符
  | 'eighth'    // 八分音符
  | '16th'      // 十六分音符
  | '32nd';     // 三十二分音符

// ============ 音符与休止符 ============

/** 音符 */
export interface Note {
  type: 'note';
  /** 音高 */
  pitch: Pitch;
  /** 时值类型 */
  duration: DurationType;
  /** 附点数量（0=无附点，1=单附点，2=双附点） */
  dots: number;
  /** 是否为连音线的起始 */
  tieStart: boolean;
  /** 是否为连音线的结束 */
  tieStop: boolean;
  /** 在小节内的起始拍位置（从0开始，以四分音符为单位） */
  beat: number;
}

/** 休止符 */
export interface Rest {
  type: 'rest';
  duration: DurationType;
  dots: number;
  beat: number;
}

/** 音乐事件（音符或休止符） */
export type MusicEvent = Note | Rest;

// ============ 和弦标记 ============

/** 和弦质量 */
export type ChordQuality =
  | 'major'       // 大三和弦
  | 'minor'       // 小三和弦
  | 'diminished'  // 减三和弦
  | 'augmented'   // 增三和弦
  | 'dominant7'   // 属七和弦
  | 'major7'      // 大七和弦
  | 'minor7'      // 小七和弦
  | 'diminished7' // 减七和弦
  | 'half-dim7'   // 半减七和弦
  | 'sus2'        // 挂二和弦
  | 'sus4';       // 挂四和弦

/**
 * 和弦符号 - 标注在乐谱上方的和弦
 * 例如：C, Am, G7, Bdim
 */
export interface ChordSymbol {
  /** 根音音名 */
  root: NoteLetter;
  /** 根音变音记号 */
  rootAccidental: Accidental;
  /** 和弦质量 */
  quality: ChordQuality;
  /** 在小节内的拍位置 */
  beat: number;
}

// ============ 调性 ============

/** 调式 */
export type Mode = 'major' | 'minor';

/** 调性信息 */
export interface KeySignature {
  /** 主音 */
  tonic: NoteLetter;
  /** 主音变音记号 */
  tonicAccidental: Accidental;
  /** 调式 */
  mode: Mode;
  /** MusicXML 中的 fifths 值（-7到7，负数为降号调，正数为升号调） */
  fifths: number;
}

// ============ 拍号 ============

/** 拍号 */
export interface TimeSignature {
  /** 每小节拍数 */
  beats: number;
  /** 以什么音符为一拍 */
  beatType: number;
}

// ============ 小节与乐谱 ============

/** 小节 */
export interface Measure {
  /** 小节编号（从1开始） */
  number: number;
  /** 该小节的音乐事件 */
  events: MusicEvent[];
  /** 该小节的和弦标注（由 Harmonizer 填充） */
  chords: ChordSymbol[];
  /** 如果该小节有调性变化，记录新调性 */
  keyChange?: KeySignature;
  /** 如果该小节有拍号变化，记录新拍号 */
  timeChange?: TimeSignature;
}

/**
 * Score - 完整乐谱的内部表示
 * 这是整个系统的核心数据结构
 */
export interface Score {
  /** 曲名 */
  title: string;
  /** 作曲者 */
  composer: string;
  /** 初始调性 */
  key: KeySignature;
  /** 调号是否来自 MusicXML 的显式声明（而非默认值） */
  keyExplicit?: boolean;
  /** 初始拍号 */
  time: TimeSignature;
  /** 速度（BPM，四分音符/分钟） */
  tempo: number;
  /** 所有小节 */
  measures: Measure[];
}
