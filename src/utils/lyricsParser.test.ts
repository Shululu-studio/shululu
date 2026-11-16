import test from 'node:test';
import assert from 'node:assert/strict';
import { countSyllables, parseLyricsText } from './lyricsParser';

test('countSyllables estimates English words accurately', () => {
  assert.equal(countSyllables('grace'), 1);
  assert.equal(countSyllables('morning'), 2);
  assert.equal(countSyllables('melody'), 3);
  assert.equal(countSyllables('hallelujah'), 4);
});

test('parseLyricsText detects section headers and splits words cleanly', () => {
  const raw = `[Verse 1]
Morning light breaks across the sky
[Chorus]
Sing the melody tonight
[Bridge]
Hold steady in the storm`;

  const result = parseLyricsText(raw, 24, 'fade');
  assert.equal(result.hasLrcTimestamps, false);
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0].section, 'verse');
  assert.equal(result.lines[1].section, 'chorus');
  assert.equal(result.lines[2].section, 'bridge');
  assert.ok(result.lines[0].words.length === 6);
  assert.ok(result.lines[0].start < result.lines[0].end);
  assert.ok(result.lines[1].start >= result.lines[0].end);
});

test('parseLyricsText parses LRC timestamps when present', () => {
  const lrc = `[ti:Sample Song]
[00:02.50]First line begins here
[00:06.00]Second line follows`;

  const result = parseLyricsText(lrc, 20, 'karaoke');
  assert.equal(result.hasLrcTimestamps, true);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].start, 2.5);
  assert.equal(result.lines[1].start, 6.0);
  assert.ok(result.lines[0].end <= 6.0);
});

test('parseLyricsText strips Suno prompt tags and preserves prose words and sung ad-libs', () => {
  const sunoRaw = `[Intro: Acoustic Guitar]
[Style: Afrobeats, 104 BPM]
[Verse 1: Soft Vocals]
Cross the bridge before midnight (yeah)
(Guitar Solo)
[Chorus] Lift your voice up high`;

  const result = parseLyricsText(sunoRaw, 30, 'fade');
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].section, 'verse');
  assert.equal(result.lines[0].text, 'Cross the bridge before midnight (yeah)');
  assert.equal(result.lines[1].section, 'chorus');
  assert.equal(result.lines[1].text, 'Lift your voice up high');
});

