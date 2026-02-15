/**
 * Test inject with the actual demo XML from index.html
 */
import { injectChordsToMusicXML } from '../src/converter/ir-to-musicxml.js';
import { parseMusicXML } from '../src/parser/musicxml-parser.js';
import type { Score } from '../src/core/types.js';

const DEMO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>小星星</work-title></work>
  <identification><creator type="composer">莫扎特</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction><sound tempo="120"/></direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
    </measure>
    <measure number="2">
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>A</step><octave>4</octave></pitch>
        <duration>1</duration>
        <type>quarter</type>
      </note>
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>2</duration>
        <type>half</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

// Parse to get a score, then manually add chords
const score = parseMusicXML(DEMO_XML);
score.measures[0].chords = [
  { root: 'C', rootAccidental: 'none', quality: 'major', beat: 0 },
];
score.measures[1].chords = [
  { root: 'A', rootAccidental: 'none', quality: 'minor', beat: 0 },
  { root: 'G', rootAccidental: 'none', quality: 'major', beat: 2 },
];

const result = injectChordsToMusicXML(DEMO_XML, score);

// Print the full result to inspect
console.log(result);
