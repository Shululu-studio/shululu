import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignLinesToWindow,
  alignLyricsToAudio,
  computeAudioAnalysis,
  distributeLyricsProportionally,
  fillRemainingSongCuesWithAnalysis,
  refineSegmentsWithAcousticAnalysis,
  refineWithAiTimestamps,
  resolveLineOverlaps,
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

test('refineSegmentsWithAcousticAnalysis independently calibrates non-uniform drift in 2-9 minute sections', () => {
  const totalDuration = 540; // 9 minutes
  const frameDurationSec = 0.05; // 50ms frames -> 10,800 frames (fast & crisp)
  const numFrames = Math.ceil(totalDuration / frameDurationSec);
  const envelope = new Array(numFrames).fill(0.03);
  const onsets: number[] = [];
  const phrases: Array<{ start: number; end: number; energy: number }> = [];

  // True singing bursts across 9 minutes:
  // Window 1 (~0-1m): on time
  // Window 2 (~3m): actual singing at 180s, 195s, 210s (input drifted +0.75s late)
  // Window 3 (~7.5-8.5m): actual singing at 450s, 470s, 495s (input drifted -0.80s early)
  const trueBursts = [
    { start: 15, end: 18 },
    { start: 32, end: 35 },
    { start: 180, end: 184 },
    { start: 195, end: 199 },
    { start: 210, end: 214 },
    { start: 450, end: 454 },
    { start: 470, end: 474 },
    { start: 495, end: 499 },
  ];

  for (const b of trueBursts) {
    phrases.push({ start: b.start, end: b.end, energy: 0.85 });
    onsets.push(b.start);
    const fStart = Math.floor(b.start / frameDurationSec);
    const fEnd = Math.min(numFrames - 1, Math.ceil(b.end / frameDurationSec));
    for (let f = fStart; f <= fEnd; f++) {
      envelope[f] = 0.88;
    }
  }

  const analysis = {
    envelope,
    onsets,
    waveformPeaks: [],
    frameDurationSec,
    totalDuration,
    phrases,
    dynamicRange: 0.8,
  };

  const drifts = [0, 0, 0.75, 0.75, 0.75, -0.8, -0.8, -0.8];
  const driftedLines = trueBursts.map((b, idx) => ({
    id: `long_${idx}`,
    text: `Worship lyric cue ${idx + 1}`,
    section: (idx >= 2 ? 'chorus' : 'verse') as 'verse' | 'chorus',
    start: Number((b.start + drifts[idx]).toFixed(2)),
    end: Number((b.end + drifts[idx]).toFixed(2)),
    effect: 'fade' as const,
    effectOverride: false,
    words: [],
  }));

  const refined = refineSegmentsWithAcousticAnalysis(driftedLines, analysis, totalDuration);
  assert.equal(refined.length, trueBursts.length);

  for (let i = 0; i < trueBursts.length; i++) {
    assert.ok(
      Math.abs(refined[i].start - trueBursts[i].start) <= 0.18,
      `Line ${i} (${trueBursts[i].start}s) drifted: got ${refined[i].start}s`
    );
  }
});

test('refineWithAiTimestamps interpolates 2-9 minute missing gaps onto actual vocal phrases instead of silence', () => {
  const totalDuration = 540;
  const frameDurationSec = 0.05;
  const numFrames = Math.ceil(totalDuration / frameDurationSec);
  const envelope = new Array(numFrames).fill(0.02);
  const onsets = [15, 160, 260, 380, 490];
  const phrases = [
    { start: 15, end: 19, energy: 0.85 },
    { start: 160, end: 165, energy: 0.85 },
    { start: 260, end: 265, energy: 0.85 },
    { start: 380, end: 385, energy: 0.85 },
    { start: 490, end: 495, energy: 0.85 },
  ];
  for (const p of phrases) {
    for (let f = Math.floor(p.start / frameDurationSec); f <= Math.ceil(p.end / frameDurationSec); f++) {
      if (f >= 0 && f < numFrames) envelope[f] = 0.85;
    }
  }

  const analysis = {
    envelope,
    onsets,
    waveformPeaks: [],
    frameDurationSec,
    totalDuration,
    phrases,
    dynamicRange: 0.8,
  };

  const lines = parseLyricsText(
    'Opening line\nMiddle cue A\nMiddle cue B\nBridge cue C\nClosing anchor',
    totalDuration
  ).lines;

  const synced = refineWithAiTimestamps(
    lines,
    [
      { lineIndex: 0, start: 15, end: 19 },
      { lineIndex: 4, start: 490, end: 495 },
    ],
    onsets,
    totalDuration,
    [],
    analysis
  );

  assert.ok(Math.abs(synced.lines[1].start - 160) <= 0.5, `Expected ~160s, got ${synced.lines[1].start}`);
  assert.ok(Math.abs(synced.lines[2].start - 260) <= 0.5, `Expected ~260s, got ${synced.lines[2].start}`);
  assert.ok(Math.abs(synced.lines[3].start - 380) <= 0.5, `Expected ~380s, got ${synced.lines[3].start}`);
});

test('fillRemainingSongCuesWithAnalysis aligns 2-9 minute remaining cues to detected vocal phrases', () => {
  const totalDuration = 540;
  const frameDurationSec = 0.05;
  const numFrames = Math.ceil(totalDuration / frameDurationSec);
  const envelope = new Array(numFrames).fill(0.02);
  const onsets = [10, 60, 145, 220, 310, 420, 505];
  const phrases = [
    { start: 10, end: 14, energy: 0.8 },
    { start: 60, end: 64, energy: 0.8 },
    { start: 145, end: 150, energy: 0.85 },
    { start: 220, end: 225, energy: 0.85 },
    { start: 310, end: 315, energy: 0.85 },
    { start: 420, end: 425, energy: 0.85 },
    { start: 505, end: 510, energy: 0.85 },
  ];
  for (const p of phrases) {
    for (let f = Math.floor(p.start / frameDurationSec); f <= Math.ceil(p.end / frameDurationSec); f++) {
      if (f >= 0 && f < numFrames) envelope[f] = 0.85;
    }
  }
  const analysis = {
    envelope,
    onsets,
    waveformPeaks: [],
    frameDurationSec,
    totalDuration,
    phrases,
    dynamicRange: 0.8,
  };

  const earlyLines = parseLyricsText('[00:10.00]Verse one\n[Chorus]\n[01:00.00]Jireh You are enough', totalDuration).lines;
  earlyLines[0].end = 14;
  earlyLines[1].end = 64;

  const filled = fillRemainingSongCuesWithAnalysis(earlyLines, totalDuration, analysis);
  assert.equal(filled.length, 7);
  assert.ok(Math.abs(filled[2].start - 145) <= 0.3, `Expected cue 2 at ~145s, got ${filled[2].start}`);
  assert.ok(Math.abs(filled[6].start - 505) <= 0.3, `Expected cue 6 at ~505s, got ${filled[6].start}`);
  const windowLines = alignLinesToWindow([earlyLines[1]], 140, 155, analysis);
  assert.ok(Math.abs(windowLines[0].start - 145) <= 0.25);
});

test('computeAudioAnalysis detects soft verse word onsets alongside loud chorus peaks', () => {
  const sampleRate = 8000;
  const durationSec = 10;
  const samples = new Float32Array(sampleRate * durationSec);

  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    // Two soft verse word bursts at 1.20s and 1.85s (~12% amplitude)
    // followed by a loud chorus burst at 5.00s-8.50s (85% amplitude)
    if ((t >= 1.2 && t <= 1.55) || (t >= 1.85 && t <= 2.3)) {
      samples[i] = 0.12 * Math.sin(2 * Math.PI * 520 * t);
    } else if (t >= 5.0 && t <= 8.5) {
      samples[i] = 0.85 * Math.sin(2 * Math.PI * 640 * t);
    } else {
      samples[i] = 0.002 * Math.sin(2 * Math.PI * 80 * t);
    }
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  const nearSoftWord1 = analysis.onsets.some((o) => Math.abs(o - 1.2) <= 0.1);
  const nearSoftWord2 = analysis.onsets.some((o) => Math.abs(o - 1.85) <= 0.1);
  assert.ok(nearSoftWord1, `Expected soft verse onset near 1.20s, got ${analysis.onsets.join(', ')}`);
  assert.ok(nearSoftWord2, `Expected soft verse onset near 1.85s, got ${analysis.onsets.join(', ')}`);
});

test('snapWordTimingsToOnsets detects sub-line envelope attacks when global onsets are empty', () => {
  const frameDurationSec = 0.01;
  const envelope = new Array(300).fill(0.08);
  // Word attacks at 0.50s, 1.00s, and 1.55s
  for (let f = 50; f <= 85; f++) envelope[f] = 0.72;
  for (let f = 100; f <= 135; f++) envelope[f] = 0.78;
  for (let f = 155; f <= 210; f++) envelope[f] = 0.84;

  const words = snapWordTimingsToOnsets(
    'Hold me close',
    0.5,
    2.2,
    [], // intentionally empty global onsets
    'line_sub',
    envelope,
    frameDurationSec
  );

  assert.equal(words.length, 3);
  assert.ok(Math.abs(words[1].start - 1.0) <= 0.12, `Expected word 1 near 1.00s, got ${words[1].start}`);
  assert.ok(Math.abs(words[2].start - 1.55) <= 0.12, `Expected word 2 near 1.55s, got ${words[2].start}`);
});

test('snapWordTimingsToOnsets retains sustained decaying vowel tail through gentle vocal release', () => {
  const frameDurationSec = 0.01;
  const totalFrames = 400; // 4.0s
  const envelope = new Array(totalFrames).fill(0.02);
  // Attack at 0.5s-1.2s (0.90), sustained decaying vowel tail from 1.2s to 3.0s (~0.10-0.18)
  for (let f = 50; f <= 120; f++) envelope[f] = 0.9;
  for (let f = 121; f <= 300; f++) {
    const progress = (f - 121) / 179;
    envelope[f] = 0.18 - progress * 0.08; // still ~0.10 above 0.02 floor
  }

  const words = snapWordTimingsToOnsets(
    'Ooooooh Hallelujah',
    0.5,
    3.1,
    [0.5, 1.3],
    'line_sustain',
    envelope,
    frameDurationSec
  );

  assert.equal(words.length, 2);
  assert.ok(
    words[1].end >= 2.95,
    `Expected sustained decaying vocal note to stay visible until ~3.0s, got ${words[1].end}`
  );
});

test('resolveLineOverlaps and refineSegmentsWithAcousticAnalysis preserve simultaneous lead and backing vocal cues', () => {
  const frameDurationSec = 0.02;
  const totalDuration = 8;
  const envelope = new Array(Math.ceil(totalDuration / frameDurationSec)).fill(0.02);
  for (let f = Math.floor(1.0 / frameDurationSec); f <= Math.ceil(4.2 / frameDurationSec); f++) {
    envelope[f] = 0.82;
  }

  const analysis = {
    envelope,
    onsets: [1.0, 1.5],
    waveformPeaks: [],
    frameDurationSec,
    totalDuration,
    phrases: [{ start: 1.0, end: 4.2, energy: 0.82 }],
    dynamicRange: 0.78,
  };

  const lines = [
    {
      id: 'lead_1',
      text: 'You are enough',
      section: 'chorus' as const,
      vocalRole: 'lead' as const,
      start: 1.0,
      end: 3.8,
      effect: 'fade' as const,
      effectOverride: false,
      words: [],
    },
    {
      id: 'bg_1',
      text: '(You are enough)',
      section: 'chorus' as const,
      vocalRole: 'backing' as const,
      start: 1.5,
      end: 4.1,
      effect: 'fade' as const,
      effectOverride: false,
      words: [],
    },
  ];

  const resolved = resolveLineOverlaps(lines, totalDuration);
  assert.ok(resolved[1].start < resolved[0].end, 'resolveLineOverlaps must keep distinct-role overlap intact');

  const refined = refineSegmentsWithAcousticAnalysis(lines, analysis, totalDuration);
  assert.equal(refined.length, 2);
  assert.ok(
    refined[1].start < refined[0].end,
    `Expected overlapping backing cue start (${refined[1].start}) < lead cue end (${refined[0].end})`
  );
});

test('refineSegmentsWithAcousticAnalysis with preserveAiAnchors prevents backing-beat drift across sentence boundaries', () => {
  const sampleRate = 8000;
  const durationSec = 10;
  const samples = new Float32Array(sampleRate * durationSec);
  // Loud beat transients 0.6s BEFORE actual singing cues at 2.0s and 5.5s
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const drumTransient = (t >= 1.3 && t <= 1.95) || (t >= 4.8 && t <= 5.45) ? 0.65 * Math.sin(2 * Math.PI * 480 * t) : 0;
    const singing = (t >= 2.0 && t <= 4.0) || (t >= 5.5 && t <= 7.8) ? 0.55 * Math.sin(2 * Math.PI * 520 * t) : 0;
    samples[i] = drumTransient + singing;
  }

  const analysis = computeAudioAnalysis(samples, sampleRate, 10, 200);
  const parsed = parseLyricsText('[00:02.00]First sentence here\n[00:05.50]Second sentence begins', durationSec);
  parsed.lines[0].end = 4.0;
  parsed.lines[1].end = 7.8;

  const refined = refineSegmentsWithAcousticAnalysis(parsed.lines, analysis, durationSec, {
    preserveAiAnchors: true,
  });

  assert.ok(Math.abs(refined[0].start - 2.0) <= 0.16, `Line 0 drifted too far: ${refined[0].start}`);
  assert.ok(Math.abs(refined[1].start - 5.5) <= 0.16, `Line 1 drifted too far: ${refined[1].start}`);
});

test('refineSegmentsWithAcousticAnalysis preserves full line.end through soft consonant ending without early cutoff', () => {
  const frameDurationSec = 0.02;
  const totalDuration = 8;
  const numFrames = Math.ceil(totalDuration / frameDurationSec);
  const envelope = new Array(numFrames).fill(0.02);

  // Loud sung opening ("Ametenda") from 1.0s to 2.2s, soft ending ("amani") decaying 2.2s to 3.7s
  for (let f = 50; f <= 110; f++) envelope[f] = 0.92;
  for (let f = 111; f <= 185; f++) {
    // Amplitude fades softly down to ~0.07 (less than 6% contrast over peak 0.92!)
    envelope[f] = Math.max(0.055, 0.25 - ((f - 111) / 74) * 0.19);
  }

  const analysis = {
    envelope,
    onsets: [1.0, 2.2],
    waveformPeaks: [],
    frameDurationSec,
    totalDuration,
    phrases: [{ start: 1.0, end: 3.7, energy: 0.92 }],
    dynamicRange: 0.88,
  };

  const lines = [
    {
      id: 'sw_1',
      text: 'Ametenda amani',
      section: 'chorus' as const,
      vocalRole: 'lead' as const,
      start: 1.0,
      end: 3.65,
      effect: 'fade' as const,
      effectOverride: false,
      words: [
        { id: 'sw_w0', text: 'Ametenda', start: 1.0, end: 2.2 },
        { id: 'sw_w1', text: 'amani', start: 2.2, end: 3.65 },
      ],
    },
  ];

  const refined = refineSegmentsWithAcousticAnalysis(lines, analysis, totalDuration, {
    preserveAiAnchors: true,
  });

  assert.equal(refined.length, 1);
  assert.ok(
    refined[0].end >= 3.65,
    `Expected line end to stay >= 3.65s until pronunciation ends, got ${refined[0].end}`
  );
  assert.ok(
    refined[0].words[1].end >= refined[0].end - 0.01,
    `Expected final word end (${refined[0].words[1].end}) to stay visible until line end (${refined[0].end})`
  );
});


