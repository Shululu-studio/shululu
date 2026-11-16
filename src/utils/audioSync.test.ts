import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignLyricsToAudio,
  computeAudioAnalysis,
  distributeLyricsProportionally,
  refineSegmentsWithAcousticAnalysis,
  refineWithAiTimestamps,
  shiftLyricsTiming,
  snapWordTimingsToOnsets,
} from './audioSync';
import { parseLyricsText } from './lyricsParser';

test('computeAudioAnalysis detects synthetic vocal phrases and waveform peaks', () => {
  const sampleRate = 8000;
  const durationSec = 10;
  const samples = new Float32Array(sampleRate * durationSec);

  // Two clear vocal-range bursts: 1.0s-3.5s and 5.0s-8.0s
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    if ((t >= 1.0 && t <= 3.5) || (t >= 5.0 && t <= 8.0)) {
      samples[i] = 0.65 * Math.sin(2 * Math.PI * 520 * t);
    } else {
      samples[i] = 0.005 * Math.sin(2 * Math.PI * 80 * t);
    }
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  assert.equal(analysis.waveformPeaks.length, 200);
  assert.equal(analysis.phrases.length, 2);
  assert.ok(Math.abs(analysis.phrases[0].start - 1.0) < 0.2);
  assert.ok(Math.abs(analysis.phrases[0].end - 3.5) < 0.2);
  assert.ok(Math.abs(analysis.phrases[1].start - 5.0) < 0.2);
  assert.ok(Math.abs(analysis.phrases[1].end - 8.0) < 0.2);

  const parsed = parseLyricsText('First phrase here\nSecond phrase now', durationSec);
  const synced = alignLyricsToAudio(parsed.lines, analysis);
  assert.equal(synced.lines.length, 2);
  assert.equal(synced.report.matchedPhrases, 2);
  assert.ok(synced.report.confidence >= 0.7);
  assert.ok(Math.abs(synced.lines[0].start - 1.0) < 0.25);
  assert.ok(Math.abs(synced.lines[1].start - 5.0) < 0.25);
});

test('alignLyricsToAudio honestly reports low confidence on flat/silent audio', () => {
  const sampleRate = 8000;
  const samples = new Float32Array(sampleRate * 6); // completely silent
  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 100);
  const parsed = parseLyricsText('Line one\nLine two', 6);
  const synced = alignLyricsToAudio(parsed.lines, analysis);

  assert.ok(synced.report.confidence < 0.4);
  assert.ok(synced.report.warnings.length > 0);
});

test('alignLyricsToAudio smoothly falls back to proportional distribution on dense continuous tracks', () => {
  const sampleRate = 8000;
  const durationSec = 24;
  const samples = new Float32Array(sampleRate * durationSec);

  // Dense, constant-amplitude complex mix (no silent gaps)
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    samples[i] =
      0.4 * Math.sin(2 * Math.PI * 110 * t) +
      0.3 * Math.sin(2 * Math.PI * 440 * t) +
      0.2 * Math.sin(2 * Math.PI * 1200 * t);
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  const parsed = parseLyricsText(
    'Opening line in the morning\nWalking down the quiet street.\n[Chorus]\nSing out loud with clarity\nHold the melody tonight',
    durationSec
  );
  const synced = alignLyricsToAudio(parsed.lines, analysis);

  assert.equal(synced.lines.length, 4);
  assert.ok(synced.report.warnings.length > 0);
  assert.ok(synced.lines[0].start >= 0);
  assert.ok(synced.lines[3].end <= durationSec);
  assert.ok(synced.lines[3].end > durationSec * 0.7);

  for (let i = 0; i < synced.lines.length; i++) {
    const line = synced.lines[i];
    assert.ok(line.end > line.start);
    if (i > 0) {
      assert.ok(line.start >= synced.lines[i - 1].end);
    }
    for (let w = 0; w < line.words.length; w++) {
      const word = line.words[w];
      assert.ok(word.start >= line.start - 0.005);
      assert.ok(word.end <= line.end + 0.005);
      assert.ok(word.end > word.start);
      if (w > 0) {
        assert.ok(word.start >= line.words[w - 1].end - 0.002);
      }
    }
  }
});

test('alignLyricsToAudio detects sparse compressed phrases and distributes proportionally across full duration', () => {
  const durationSec = 60;
  const parsed = parseLyricsText(
    'Line one\nLine two\nLine three\nLine four\nLine five\nLine six',
    durationSec
  );

  // Simulate a complex track where only 1 brief 1.2s peak passed adaptive threshold
  const syntheticAnalysis = {
    envelope: [0.1, 0.9, 0.1],
    onsets: [0.8, 12.4, 24.1, 35.6, 46.2],
    waveformPeaks: [0.5, 0.8, 0.4],
    frameDurationSec: 0.01,
    totalDuration: durationSec,
    phrases: [{ start: 10.0, end: 11.2, energy: 0.8 }],
    dynamicRange: 0.45,
  };

  const synced = alignLyricsToAudio(parsed.lines, syntheticAnalysis);
  assert.equal(synced.lines.length, 6);
  // Should span the full ~60s track rather than squeezing 6 lines into 10.0-11.2s
  const totalSpan = synced.lines[5].end - synced.lines[0].start;
  assert.ok(totalSpan > 45, `Expected full track span > 45s, got ${totalSpan}`);
  assert.ok(synced.lines[5].end <= durationSec);
});

test('computeAudioAnalysis and distributeLyricsProportionally tolerate empty and NaN samples', () => {
  const emptyAnalysis = computeAudioAnalysis(new Float32Array(0), 0, 10, 64);
  assert.equal(emptyAnalysis.totalDuration, 0);
  assert.equal(emptyAnalysis.waveformPeaks.length, 64);

  const corrupted = new Float32Array(8000);
  corrupted[10] = Number.NaN;
  corrupted[50] = Number.POSITIVE_INFINITY;
  const safeAnalysis = computeAudioAnalysis(corrupted, 8000, 10, 64);
  assert.ok(Number.isFinite(safeAnalysis.dynamicRange));
  assert.ok(safeAnalysis.waveformPeaks.every((v) => Number.isFinite(v)));

  const parsed = parseLyricsText('First line\nSecond line\nThird line', 12);
  const fallback = distributeLyricsProportionally(parsed.lines, 12, [0.4]);
  assert.equal(fallback.lines.length, 3);
  assert.ok(fallback.lines[0].start >= 0);
  assert.ok(fallback.lines[2].end <= 12);
});

test('refineSegmentsWithAcousticAnalysis snaps drifted timestamps onto actual vocal bursts', () => {
  const sampleRate = 8000;
  const durationSec = 10;
  const samples = new Float32Array(sampleRate * durationSec);

  // Two clear vocal bursts at 2.0s-4.0s and 5.5s-7.8s
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    if ((t >= 2.0 && t <= 4.0) || (t >= 5.5 && t <= 7.8)) {
      samples[i] = 0.7 * Math.sin(2 * Math.PI * 520 * t);
    } else {
      samples[i] = 0.004 * Math.sin(2 * Math.PI * 90 * t);
    }
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  const parsed = parseLyricsText('First sung phrase\nSecond sung phrase', durationSec);
  // Simulate LLM returning timestamps shifted ~0.6s early
  const drifted = parsed.lines.map((l, idx) =>
    idx === 0 ? { ...l, start: 1.4, end: 3.4 } : { ...l, start: 4.9, end: 7.2 }
  );

  const refined = refineSegmentsWithAcousticAnalysis(drifted, analysis, durationSec);
  assert.equal(refined.length, 2);
  assert.ok(Math.abs(refined[0].start - 2.0) < 0.18, `Expected ~2.0s, got ${refined[0].start}`);
  assert.ok(Math.abs(refined[1].start - 5.5) < 0.18, `Expected ~5.5s, got ${refined[1].start}`);
  assert.ok(refined[1].start > refined[0].end);
});

test('refineWithAiTimestamps handles 1-based AI indices and interpolates missing anchor gaps', () => {
  const parsed = parseLyricsText('One\nTwo\nThree', 15);
  // 1-based indices matching line 1 and line 3, skipping line 2
  const synced = refineWithAiTimestamps(
    parsed.lines,
    [
      { lineIndex: 1, start: 1.0, end: 3.5 },
      { lineIndex: 3, start: 8.5, end: 11.0 },
    ],
    [],
    15,
    []
  );

  assert.equal(synced.report.matchedPhrases, 2);
  assert.ok(Math.abs(synced.lines[0].start - 1.0) < 0.1);
  assert.ok(synced.lines[1].start >= synced.lines[0].end);
  assert.ok(synced.lines[1].end <= synced.lines[2].start);
  assert.ok(Math.abs(synced.lines[2].start - 8.5) < 0.1);
});

test('snapWordTimingsToOnsets trims dead trailing silence so words do not lag past singing', () => {
  const frameDurationSec = 0.01;
  const totalFrames = 400; // 4.0s
  // Singing active strictly from 1.0s (frame 100) to 2.0s (frame 200), silent from 2.0s to 3.2s
  const envelope = new Array(totalFrames).fill(0.02);
  for (let f = 100; f <= 200; f++) {
    envelope[f] = 0.85;
  }

  const words = snapWordTimingsToOnsets(
    'Sing right on beat',
    1.0,
    3.2,
    [1.0, 1.28, 1.54, 1.78],
    'line_trim',
    envelope,
    frameDurationSec
  );

  assert.equal(words.length, 4);
  assert.ok(words[0].start >= 0.99 && words[0].start <= 1.02);
  assert.ok(
    words[3].end <= 2.12,
    `Expected final word to finish near 2.0s vocal decay, got ${words[3].end}`
  );
  for (let i = 1; i < words.length; i++) {
    assert.ok(words[i].start >= words[i - 1].end);
    assert.ok(words[i].end > words[i].start);
  }
});

test('refineSegmentsWithAcousticAnalysis preserves already-accurate timestamps without early bias', () => {
  const sampleRate = 8000;
  const durationSec = 10;
  const samples = new Float32Array(sampleRate * durationSec);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    if ((t >= 2.0 && t <= 4.0) || (t >= 5.5 && t <= 7.5)) {
      samples[i] = 0.7 * Math.sin(2 * Math.PI * 520 * t);
    } else {
      samples[i] = 0.004 * Math.sin(2 * Math.PI * 90 * t);
    }
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  const parsed = parseLyricsText('[00:02.00]Exact start one\n[00:05.50]Exact start two', durationSec);
  const refined = refineSegmentsWithAcousticAnalysis(parsed.lines, analysis, durationSec);

  assert.ok(Math.abs(refined[0].start - 2.0) <= 0.06, `Expected ~2.00s, got ${refined[0].start}`);
  assert.ok(Math.abs(refined[1].start - 5.5) <= 0.06, `Expected ~5.50s, got ${refined[1].start}`);
});

test('refineSegmentsWithAcousticAnalysis does not delay soft vocal pickup before a loud belt', () => {
  const sampleRate = 8000;
  const durationSec = 8;
  const samples = new Float32Array(sampleRate * durationSec);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    if (t >= 2.0 && t < 2.28) {
      // Soft sung consonant/pickup syllable (~14% amplitude of belt)
      samples[i] = 0.12 * Math.sin(2 * Math.PI * 420 * t);
    } else if (t >= 2.28 && t <= 4.5) {
      // Loud belt
      samples[i] = 0.85 * Math.sin(2 * Math.PI * 560 * t);
    } else {
      samples[i] = 0.002 * Math.sin(2 * Math.PI * 90 * t);
    }
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  const parsed = parseLyricsText('[00:02.00]I give You praise', durationSec);
  const refined = refineSegmentsWithAcousticAnalysis(parsed.lines, analysis, durationSec);

  assert.ok(
    refined[0].start <= 2.04,
    `Soft pickup syllable must not be delayed to belt at 2.28s, got ${refined[0].start}`
  );
  assert.ok(
    refined[0].words[0].start <= 2.04,
    `Word 0 must start on pickup without delay, got ${refined[0].words[0].start}`
  );
});

test('refineSegmentsWithAcousticAnalysis pulls back small systematic delays over backing music', () => {
  const sampleRate = 8000;
  const durationSec = 10;
  const samples = new Float32Array(sampleRate * durationSec);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    // Soft continuous organ/pad floor + clear vocal onset at 2.00s and 5.50s
    const backing = 0.08 * Math.sin(2 * Math.PI * 330 * t);
    const singing =
      (t >= 2.0 && t <= 3.8) || (t >= 5.5 && t <= 7.4)
        ? 0.55 * Math.sin(2 * Math.PI * 660 * t)
        : 0;
    samples[i] = backing + singing;
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  // Simulate AI returning timestamps 0.24s late (2.24s and 5.74s)
  const lateLines = parseLyricsText('[00:02.24]Ooooh holy light\n[00:05.74]Woooh rise above', durationSec).lines;
  const refined = refineSegmentsWithAcousticAnalysis(lateLines, analysis, durationSec);

  assert.ok(refined[0].start <= 2.08, `Expected line 0 pulled near 2.00s onset, got ${refined[0].start}`);
  assert.ok(refined[1].start <= 5.58, `Expected line 1 pulled near 5.50s onset, got ${refined[1].start}`);
  assert.ok(
    Math.abs(refined[0].words[0].start - refined[0].start) <= 0.04,
    `Word 0 must start immediately with line start, got word0=${refined[0].words[0].start} vs line=${refined[0].start}`
  );
});

test('refineSegmentsWithAcousticAnalysis pulls back larger non-uniform +0.65s delays without prev-tail cascade', () => {
  const sampleRate = 8000;
  const durationSec = 10;
  const samples = new Float32Array(sampleRate * durationSec);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const backing = 0.14 * Math.sin(2 * Math.PI * 310 * t);
    // Line 1 sung 1.50s-3.30s; Line 2 sung 3.60s-5.80s
    const singing =
      (t >= 1.5 && t <= 3.3) || (t >= 3.6 && t <= 5.8)
        ? 0.65 * Math.sin(2 * Math.PI * 640 * t)
        : 0;
    samples[i] = backing + singing;
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  // Line 1 is slightly off with lingering end (3.80s), while Line 2 is +0.65s late (4.25s instead of 3.60s)
  const skewedLines = parseLyricsText('[00:01.55]First phrase\n[00:04.25]Second phrase', durationSec).lines;
  skewedLines[0].end = 3.8;
  skewedLines[1].end = 6.2;

  const refined = refineSegmentsWithAcousticAnalysis(skewedLines, analysis, durationSec);
  assert.ok(refined[0].start <= 1.58, `Expected line 0 near 1.50s, got ${refined[0].start}`);
  assert.ok(
    refined[1].start <= 3.72,
    `Line 2 must pull back to ~3.60s without being blocked by Line 1 lingering end, got ${refined[1].start}`
  );
  assert.ok(refined[0].end <= refined[1].start - 0.01, 'Resolved cues must never overlap');
});

test('shiftLyricsTiming nudges all lines and word timings uniformly without overlap', () => {
  const lines = parseLyricsText('[00:02.00]Holy spirit come\n[00:04.20]Fill this sanctuary', 12).lines;
  const earlier = shiftLyricsTiming(lines, -0.25, 12);
  assert.ok(Math.abs(earlier[0].start - 1.75) < 0.02);
  assert.ok(Math.abs(earlier[1].start - 3.95) < 0.02);
  assert.equal(earlier[0].words[0].start, earlier[0].start);

  const clampedStart = shiftLyricsTiming(lines, -3.0, 12);
  assert.equal(clampedStart[0].start, 0);
  assert.ok(clampedStart[1].start >= clampedStart[0].end);
});
