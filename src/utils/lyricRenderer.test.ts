import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getActiveLyricsAtTime,
  getInstrumentalSampleAtTime,
  getResolutionForAspect,
} from './lyricRenderer';
import { parseLyricsText } from './lyricsParser';

test('getResolutionForAspect computes accurate 720p and 1080p dimensions', () => {
  assert.deepEqual(getResolutionForAspect('16:9', 1080), { width: 1920, height: 1080 });
  assert.deepEqual(getResolutionForAspect('16:9', 720), { width: 1280, height: 720 });
  assert.deepEqual(getResolutionForAspect('9:16', 1080), { width: 1080, height: 1920 });
  assert.deepEqual(getResolutionForAspect('1:1', 720), { width: 720, height: 720 });
});

test('getActiveLyricsAtTime interpolates progress and fade envelopes accurately', () => {
  const { lines } = parseLyricsText('[00:02.00]Hold this steady flame', 10, 'slide-up');
  assert.equal(getActiveLyricsAtTime(lines, 1.0).length, 0);
  assert.equal(getActiveLyricsAtTime(lines, 1.5).length, 0);

  const atStart = getActiveLyricsAtTime(lines, 2.0);
  assert.equal(atStart.length, 1);
  assert.ok(atStart[0].alpha >= 0.7, `Expected crisp alpha at line.start, got ${atStart[0].alpha}`);

  const mid = getActiveLyricsAtTime(lines, 3.5);
  assert.equal(mid.length, 1);
  assert.ok(mid[0].alpha > 0.8);
  assert.equal(mid[0].offsetY, 0);
});

test('getActiveLyricsAtTime never stacks two touching or crossfade lines at once', () => {
  const { lines } = parseLyricsText('[00:02.00]First line\n[00:04.00]Second line', 8, 'line-crossfade');
  lines[0].end = 4.0;
  for (let t = 1.8; t <= 4.5; t += 0.02) {
    const active = getActiveLyricsAtTime(lines, t);
    assert.ok(active.length <= 1, `Expected <= 1 line at t=${t.toFixed(2)}, got ${active.length}`);
  }
});

test('getInstrumentalSampleAtTime returns null as [instrumental] tag has been removed', () => {
  const { lines } = parseLyricsText(
    '[00:04.00]First verse begins\n[00:06.20]Quick breath line\n[00:12.00]Final chorus line',
    18,
    'fade'
  );
  const peaks = Array.from({ length: 100 }, () => 0.35);

  assert.equal(
    getInstrumentalSampleAtTime(lines, 2.0, { duration: 18, hasAudio: true, waveformPeaks: peaks }),
    null
  );
  assert.equal(
    getInstrumentalSampleAtTime(lines, 10.0, { duration: 18, hasAudio: true, waveformPeaks: peaks }),
    null
  );
  assert.equal(
    getInstrumentalSampleAtTime([], 5.0, { duration: 18, hasAudio: true, waveformPeaks: peaks }),
    null
  );
});


