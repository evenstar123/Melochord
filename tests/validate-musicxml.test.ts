import { describe, it, expect } from 'vitest';

/**
 * Tests for the validateMusicXML function.
 * The function is defined inline in web/index.html, so we replicate it here
 * to test the core validation logic independently.
 */
function validateMusicXML(text: unknown): boolean {
  if (!text || typeof text !== 'string') return false;
  return text.includes('<score-partwise') || text.includes('<score-timewise');
}

describe('validateMusicXML', () => {
  it('should accept valid score-partwise MusicXML', () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list></part-list></score-partwise>`;
    expect(validateMusicXML(xml)).toBe(true);
  });

  it('should accept valid score-timewise MusicXML', () => {
    const xml = `<?xml version="1.0"?><score-timewise version="4.0"></score-timewise>`;
    expect(validateMusicXML(xml)).toBe(true);
  });

  it('should accept the twinkle.xml fixture content', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"></measure></part>
</score-partwise>`;
    expect(validateMusicXML(xml)).toBe(true);
  });

  it('should reject plain text', () => {
    expect(validateMusicXML('hello world')).toBe(false);
  });

  it('should reject HTML content', () => {
    expect(validateMusicXML('<html><body>Not music</body></html>')).toBe(false);
  });

  it('should reject JSON content', () => {
    expect(validateMusicXML('{"key": "value"}')).toBe(false);
  });

  it('should reject empty string', () => {
    expect(validateMusicXML('')).toBe(false);
  });

  it('should reject null', () => {
    expect(validateMusicXML(null)).toBe(false);
  });

  it('should reject undefined', () => {
    expect(validateMusicXML(undefined)).toBe(false);
  });

  it('should reject a number', () => {
    expect(validateMusicXML(42 as any)).toBe(false);
  });

  it('should reject XML without score root element', () => {
    const xml = `<?xml version="1.0"?><music><note>C</note></music>`;
    expect(validateMusicXML(xml)).toBe(false);
  });
});
