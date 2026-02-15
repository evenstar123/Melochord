import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseMusicXML } from '../src/parser/musicxml-parser.js';
import type { Note } from '../src/core/types.js';

const twinkleXml = readFileSync(
  resolve(__dirname, 'fixtures/twinkle.xml'),
  'utf-8'
);

describe('parseMusicXML', () => {
  const score = parseMusicXML(twinkleXml);

  it('应正确解析曲名和作曲者', () => {
    expect(score.title).toBe('小星星');
    expect(score.composer).toBe('莫扎特');
  });

  it('应正确解析调性（C大调）', () => {
    expect(score.key.tonic).toBe('C');
    expect(score.key.tonicAccidental).toBe('none');
    expect(score.key.mode).toBe('major');
    expect(score.key.fifths).toBe(0);
  });

  it('应正确解析拍号（4/4）', () => {
    expect(score.time.beats).toBe(4);
    expect(score.time.beatType).toBe(4);
  });

  it('应正确解析速度', () => {
    expect(score.tempo).toBe(120);
  });

  it('应解析出4个小节', () => {
    expect(score.measures).toHaveLength(4);
  });

  it('第1小节应有4个四分音符: C C G G', () => {
    const m1 = score.measures[0];
    expect(m1.events).toHaveLength(4);

    const notes = m1.events.filter((e): e is Note => e.type === 'note');
    expect(notes).toHaveLength(4);

    expect(notes[0].pitch.step).toBe('C');
    expect(notes[0].pitch.octave).toBe(4);
    expect(notes[0].duration).toBe('quarter');

    expect(notes[2].pitch.step).toBe('G');
    expect(notes[2].pitch.octave).toBe(4);
  });

  it('第2小节应有3个音符: A A G(半音符)', () => {
    const m2 = score.measures[1];
    expect(m2.events).toHaveLength(3);

    const notes = m2.events.filter((e): e is Note => e.type === 'note');
    expect(notes[2].pitch.step).toBe('G');
    expect(notes[2].duration).toBe('half');
  });

  it('拍位置应正确计算', () => {
    const m1 = score.measures[0];
    const notes = m1.events.filter((e): e is Note => e.type === 'note');

    expect(notes[0].beat).toBe(0);   // 第1拍
    expect(notes[1].beat).toBe(1);   // 第2拍
    expect(notes[2].beat).toBe(2);   // 第3拍
    expect(notes[3].beat).toBe(3);   // 第4拍
  });

  it('和弦数组初始为空（等待 Harmonizer 填充）', () => {
    for (const measure of score.measures) {
      expect(measure.chords).toEqual([]);
    }
  });
});

describe('parseMusicXML - 错误处理', () => {
  it('无效 XML 应抛出错误', () => {
    expect(() => parseMusicXML('<invalid>not musicxml</invalid>')).toThrow(
      'Invalid MusicXML'
    );
  });

  it('缺少 part 应抛出错误', () => {
    const xml = `<?xml version="1.0"?>
      <score-partwise version="4.0">
        <part-list></part-list>
      </score-partwise>`;
    expect(() => parseMusicXML(xml)).toThrow('Invalid MusicXML');
  });
});
