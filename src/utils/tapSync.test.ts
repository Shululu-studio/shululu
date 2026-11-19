import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTapAtIndex,
  createBlankTapCueLine,
  finalizeTapSyncLines,
  formatDraftLinesForBulkEdit,
  syncDraftLinesFromBulkText,
} from './tapSync';
import { parseLyricsText } from './lyricsParser';

test('syncDraftLinesFromBulkText preserves existing timestamps when editing text lines', () => {
  const { lines } = parseLyricsText('[00:02.00]First original line\n[00:06.00]Second original line', 20);
  const edited = syncDraftLinesFromBulkText(
    '[Verse]\nFirst corrected lyric\nSecond corrected lyric\nThird added lyric',
    lines,
    20
  );

  assert.equal(edited.length, 3);
  assert.equal(edited[0].text, 'First corrected lyric');
  assert.equal(edited[0].start, lines[0].start);
  assert.equal(edited[0].end, lines[0].end);
  assert.equal(edited[1].text, 'Second corrected lyric');
  assert.equal(edited[1].start, lines[1].start);
  assert.equal(edited[2].text, 'Third added lyric');
});

test('applyTapAtIndex stamps current cue and trims previous cue end cleanly', () => {
  const { lines } = parseLyricsText('Line one\nLine two', 20);
  const step1 = applyTapAtIndex(lines, 0, 1.5, 20);
  assert.equal(step1.nextIndex, 1);
  assert.equal(step1.lines[0].start, 1.5);

  const step2 = applyTapAtIndex(step1.lines, 1, 4.2, 20);
  assert.equal(step2.nextIndex, 2);
  assert.equal(step2.lines[1].start, 4.2);
  assert.equal(step2.lines[0].end, 4.12);
});

test('finalizeTapSyncLines trims text, removes blank lines, and rebuilds word timings', () => {
  const { lines } = parseLyricsText('  Hold onto hope  \n   \nSing forever', 15);
  const custom = [
    { ...lines[0], text: '  Updated chorus line  ', start: 2.5, end: 2.6 },
    { ...lines[1], text: '   ' },
  ];
  const finalized = finalizeTapSyncLines(custom);

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].text, 'Updated chorus line');
  assert.ok(finalized[0].end >= 2.9);
  assert.equal(finalized[0].words.map((w) => w.text).join(' '), 'Updated chorus line');
});

test('createBlankTapCueLine and formatDraftLinesForBulkEdit generate valid editable lines', () => {
  const first = createBlankTapCueLine([], 30);
  assert.equal(first.text, 'Lyric line 1');
  assert.ok(first.end > first.start);

  const formatted = formatDraftLinesForBulkEdit([first]);
  assert.ok(formatted.includes('[Verse]'));
  assert.ok(formatted.includes('Lyric line 1'));
});
