import { LyricLine, SyncReport, WordTiming } from '../types/editor';
import { countSyllables } from './lyricsParser';

export interface VocalPhrase {
  start: number;
  end: number;
  energy: number;
}

export interface AudioAnalysisResult {
  envelope: number[];
  onsets: number[]; // timestamps in seconds
  waveformPeaks: number[]; // ~1000 normalized bars 0..1
  frameDurationSec: number;
  totalDuration: number;
  phrases: VocalPhrase[];
  dynamicRange: number;
}

/**
 * Simple 1st-order vocal bandpass emphasis (~300Hz - 3400Hz proxy) + RMS envelope
 * running cleanly in pure JS (safe inside Web Worker & Node unit tests).
 */
export function computeAudioAnalysis(
  samples: Float32Array,
  sampleRate: number,
  hopMs = 10,
  targetWaveformBars = 900
): AudioAnalysisResult {
  const safeSampleRate =
    Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 16000;
  const safeBars = Math.max(1, Math.floor(targetWaveformBars));

  if (!samples || samples.length === 0) {
    return {
      envelope: [],
      onsets: [],
      waveformPeaks: new Array(safeBars).fill(0),
      frameDurationSec: hopMs / 1000,
      totalDuration: 0,
      phrases: [],
      dynamicRange: 0,
    };
  }

  const totalDuration = samples.length / safeSampleRate;
  const hopSamples = Math.max(64, Math.floor((safeSampleRate * hopMs) / 1000));
  const frameDurationSec = hopSamples / safeSampleRate;
  const numFrames = Math.max(1, Math.floor(samples.length / hopSamples));

  const envelope: number[] = new Array(numFrames).fill(0);
  const fluxRaw: number[] = new Array(numFrames).fill(0);

  // High-pass (~260Hz) and low-pass (~3400Hz) to isolate vocal presence,
  // plus high-frequency consonant transient tracking (>2200Hz) for crisp attacks.
  const dt = 1 / safeSampleRate;
  const rcHp = 1 / (2 * Math.PI * 260);
  const alphaHp = rcHp / (rcHp + dt);
  const rcLp = 1 / (2 * Math.PI * 3400);
  const alphaLp = dt / (rcLp + dt);
  const rcCons = 1 / (2 * Math.PI * 2200);
  const alphaCons = rcCons / (rcCons + dt);

  let prevX = 0;
  let hpY = 0;
  let lpY = 0;
  let consY = 0;
  let prevEnergy = 0;
  let prevConsEnergy = 0;
  let maxEnv = 1e-6;

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSamples;
    const end = Math.min(samples.length, start + hopSamples);
    let sumSq = 0;
    let consSq = 0;
    let count = 0;

    for (let i = start; i < end; i++) {
      const raw = samples[i];
      const x = Number.isFinite(raw) ? raw : 0;
      const dx = x - prevX;
      hpY = alphaHp * (hpY + dx);
      consY = alphaCons * (consY + dx);
      prevX = x;
      lpY = lpY + alphaLp * (hpY - lpY);
      sumSq += lpY * lpY;
      consSq += consY * consY;
      count++;
    }

    const rms = count > 0 && Number.isFinite(sumSq) ? Math.sqrt(sumSq / count) : 0;
    const consRms = count > 0 && Number.isFinite(consSq) ? Math.sqrt(consSq / count) : 0;
    envelope[f] = rms;
    if (rms > maxEnv) maxEnv = rms;

    const deltaVocal = rms - prevEnergy;
    const deltaCons = consRms - prevConsEnergy;
    // Combine positive vocal energy rise with initial consonant transient rise
    fluxRaw[f] = (deltaVocal > 0 ? deltaVocal : 0) + (deltaCons > 0 ? deltaCons * 0.45 : 0);
    prevEnergy = rms;
    prevConsEnergy = consRms;
  }

  // Gentle 3-frame smoothing & perceptual gamma compression (0.75) so soft verses/pickups
  // and "ooooh/woooh" swells remain clearly resolvable beside loud chorus belts.
  const smoothed: number[] = new Array(numFrames).fill(0);
  let normMax = 1e-6;
  for (let f = 0; f < numFrames; f++) {
    const a = envelope[Math.max(0, f - 1)];
    const b = envelope[f];
    const c = envelope[Math.min(numFrames - 1, f + 1)];
    const val = (a + 2 * b + c) / 4;
    smoothed[f] = val;
    if (val > normMax) normMax = val;
  }

  const normalizedEnv =
    normMax <= 1e-5
      ? smoothed.map(() => 0)
      : smoothed.map((v) => Math.pow(Math.max(0, v / normMax), 0.75));

  // Compute dynamic range (90th percentile vs 20th percentile)
  const sorted = [...normalizedEnv].sort((a, b) => a - b);
  const p20 = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const dynamicRange = Math.max(0, p90 - p20);

  // Onset peak picking
  const meanFlux =
    fluxRaw.reduce((acc, v) => acc + v, 0) / Math.max(1, fluxRaw.length);
  const onsetThreshold = meanFlux * 1.32 + normMax * 0.01;
  const minOnsetGapFrames = Math.max(2, Math.round(0.09 / frameDurationSec));
  const onsets: number[] = [];
  let lastOnsetFrame = -minOnsetGapFrames;

  for (let f = 1; f < numFrames - 1; f++) {
    if (
      fluxRaw[f] > onsetThreshold &&
      fluxRaw[f] >= fluxRaw[f - 1] &&
      fluxRaw[f] > fluxRaw[f + 1] &&
      f - lastOnsetFrame >= minOnsetGapFrames
    ) {
      onsets.push(Number((f * frameDurationSec).toFixed(3)));
      lastOnsetFrame = f;
    }
  }

  // Segment active vocal phrases
  const phrases = detectVocalPhrases(normalizedEnv, frameDurationSec, totalDuration);

  // Compute waveform peaks from raw samples for crisp timeline display
  const waveformPeaks: number[] = new Array(safeBars).fill(0);
  const samplesPerBar = Math.max(1, Math.floor(samples.length / safeBars));
  let maxPeak = 1e-6;
  for (let b = 0; b < safeBars; b++) {
    const sStart = b * samplesPerBar;
    const sEnd = Math.min(samples.length, sStart + samplesPerBar);
    let peak = 0;
    const step = Math.max(1, Math.floor((sEnd - sStart) / 64));
    for (let i = sStart; i < sEnd; i += step) {
      const raw = samples[i];
      const abs = Number.isFinite(raw) ? Math.abs(raw) : 0;
      if (abs > peak) peak = abs;
    }
    waveformPeaks[b] = peak;
    if (peak > maxPeak) maxPeak = peak;
  }
  for (let b = 0; b < safeBars; b++) {
    waveformPeaks[b] = Number((waveformPeaks[b] / maxPeak).toFixed(3));
  }

  return {
    envelope: normalizedEnv,
    onsets,
    waveformPeaks,
    frameDurationSec,
    totalDuration,
    phrases,
    dynamicRange,
  };
}

export function detectVocalPhrases(
  normalizedEnv: number[],
  frameDurationSec: number,
  totalDuration: number
): VocalPhrase[] {
  if (normalizedEnv.length === 0 || totalDuration <= 0) return [];

  const sorted = [...normalizedEnv].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0.5;
  const threshold = Math.max(0.12, p25 + (p75 - p25) * 0.28);

  const minSilenceGap = 0.28; // merge gaps shorter than 280ms
  const minPhraseLen = 0.45;

  const rawRegions: VocalPhrase[] = [];
  let inPhrase = false;
  let startFrame = 0;
  let energySum = 0;

  for (let i = 0; i < normalizedEnv.length; i++) {
    const active = normalizedEnv[i] >= threshold;
    if (active && !inPhrase) {
      inPhrase = true;
      startFrame = i;
      energySum = normalizedEnv[i];
    } else if (active && inPhrase) {
      energySum += normalizedEnv[i];
    } else if (!active && inPhrase) {
      inPhrase = false;
      const start = startFrame * frameDurationSec;
      const end = Math.min(totalDuration, i * frameDurationSec);
      const frames = Math.max(1, i - startFrame);
      rawRegions.push({ start, end, energy: energySum / frames });
    }
  }

  if (inPhrase) {
    const start = startFrame * frameDurationSec;
    const frames = Math.max(1, normalizedEnv.length - startFrame);
    rawRegions.push({
      start,
      end: totalDuration,
      energy: energySum / frames,
    });
  }

  // Merge micro-gaps
  const merged: VocalPhrase[] = [];
  for (const reg of rawRegions) {
    const prev = merged[merged.length - 1];
    if (prev && reg.start - prev.end < minSilenceGap) {
      prev.end = reg.end;
      prev.energy = (prev.energy + reg.energy) / 2;
    } else {
      merged.push({ ...reg });
    }
  }

  return merged.filter((p) => p.end - p.start >= minPhraseLen);
}

export function snapWordTimingsToOnsets(
  text: string,
  lineStart: number,
  lineEnd: number,
  onsets: number[],
  lineId: string,
  envelope?: number[],
  frameDurationSec?: number
): WordTiming[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const safeStart = Number.isFinite(lineStart) ? Math.max(0, lineStart) : 0;
  const safeEnd = Number.isFinite(lineEnd)
    ? Math.max(safeStart + 0.15, lineEnd)
    : safeStart + 1.0;
  const fullDuration = Math.max(0.15, safeEnd - safeStart);
  const weights = tokens.map((t) => countSyllables(t) + 0.35);
  const totalWeight = Math.max(0.1, weights.reduce((a, b) => a + b, 0));

  // If vocal envelope is available, tighten the active vocal sub-span inside [safeStart, safeEnd]
  // so trailing/leading dead silence inside a cue never delays or rushes words.
  // Keep Word 0 locked directly to safeStart (line.start) so word-by-word never hides early text;
  // trim only dead trailing silence at activeEnd so words do not linger past vocal decay.
  const activeStart = safeStart;
  let activeEnd = safeEnd;
  const hasEnv =
    Array.isArray(envelope) &&
    envelope.length > 4 &&
    typeof frameDurationSec === 'number' &&
    frameDurationSec > 0;

  let localEnvSlice: number[] | null = null;
  if (hasEnv && envelope && frameDurationSec) {
    const fStart = Math.max(0, Math.floor(safeStart / frameDurationSec));
    const fEnd = Math.min(envelope.length - 1, Math.ceil(safeEnd / frameDurationSec));
    if (fEnd > fStart + 3) {
      let localMax = 0;
      let localMin = 1;
      for (let f = fStart; f <= fEnd; f++) {
        const v = envelope[f] ?? 0;
        if (v > localMax) localMax = v;
        if (v < localMin) localMin = v;
      }
      if (localMax - localMin >= 0.1) {
        const minNeededSpan = Math.min(fullDuration, Math.max(0.28, tokens.length * 0.11));
        const tailThresh = localMin + (localMax - localMin) * 0.14;

        let lastActive = fEnd;
        while (lastActive > fStart && (envelope[lastActive] ?? 0) < tailThresh) {
          lastActive--;
        }

        const candEnd = Math.max(
          activeStart + minNeededSpan,
          Math.min(safeEnd, (lastActive + 1) * frameDurationSec + 0.04)
        );
        if (candEnd - activeStart >= minNeededSpan && candEnd <= safeEnd) {
          activeEnd = candEnd;
        }
      }

      const aStartF = Math.max(0, Math.floor(activeStart / frameDurationSec));
      const aEndF = Math.min(envelope.length - 1, Math.ceil(activeEnd / frameDurationSec));
      if (aEndF > aStartF + 1) {
        localEnvSlice = envelope.slice(aStartF, aEndF + 1);
      }
    }
  }

  const duration = Math.max(0.15, activeEnd - activeStart);
  const minWordDur = Math.min(0.075, (duration / tokens.length) * 0.65);

  const cumEnergy =
    localEnvSlice && localEnvSlice.length > 2
      ? (() => {
          const mean =
            localEnvSlice.reduce((s, v) => s + v, 0) / Math.max(1, localEnvSlice.length);
          const floor = Math.max(0.02, mean * 0.2);
          const cum: number[] = new Array(localEnvSlice.length).fill(0);
          let acc = 0;
          for (let i = 0; i < localEnvSlice.length; i++) {
            acc += Math.max(floor, localEnvSlice[i] ?? 0);
            cum[i] = acc;
          }
          return cum;
        })()
      : null;

  const mapSyllableRatioToTime = (ratio: number): number => {
    const r = Math.max(0, Math.min(1, ratio));
    const linearTime = activeStart + r * duration;
    if (!cumEnergy || cumEnergy.length < 2) return linearTime;
    const targetE = r * cumEnergy[cumEnergy.length - 1];
    let lo = 0;
    let hi = cumEnergy.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumEnergy[mid] < targetE) lo = mid + 1;
      else hi = mid;
    }
    const prevE = lo > 0 ? cumEnergy[lo - 1] : 0;
    const curE = cumEnergy[lo];
    const frac = curE > prevE ? (targetE - prevE) / (curE - prevE) : 0;
    const envRatio = Math.max(0, Math.min(1, (lo - 1 + frac) / Math.max(1, cumEnergy.length - 1)));
    const envTime = activeStart + envRatio * duration;
    return linearTime * 0.62 + envTime * 0.38;
  };

  const localOnsets = onsets.filter(
    (o) => Number.isFinite(o) && o >= activeStart - 0.04 && o <= activeEnd - minWordDur
  );

  let accWeight = 0;
  const words: WordTiming[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const startRatio = accWeight / totalWeight;
    accWeight += weights[i];
    const endRatio = accWeight / totalWeight;

    const expectedStart = i === 0 ? activeStart : mapSyllableRatioToTime(startRatio);
    const expectedEnd =
      i === tokens.length - 1 ? activeEnd : mapSyllableRatioToTime(endRatio);
    let snappedStart = expectedStart;

    if (i > 0 && localOnsets.length > 0) {
      const remainingWords = tokens.length - i;
      const maxAllowedStart = activeEnd - remainingWords * minWordDur;
      const minAllowedStart = words[i - 1].start + minWordDur;

      let bestOnset = expectedStart;
      let bestDist = 0.18;
      for (const onset of localOnsets) {
        const dist = Math.abs(onset - expectedStart);
        if (dist < bestDist && onset >= minAllowedStart && onset <= maxAllowedStart) {
          bestDist = dist;
          bestOnset = onset;
        }
      }
      snappedStart = Math.max(minAllowedStart, Math.min(maxAllowedStart, bestOnset));
    }

    words.push({
      id: `${lineId}_w${i}_${Math.random().toString(36).slice(2, 6)}`,
      text: tokens[i],
      start: Number(snappedStart.toFixed(3)),
      end: Number(Math.min(activeEnd, Math.max(snappedStart + minWordDur, expectedEnd)).toFixed(3)),
    });
  }

  // Ensure strictly monotonic, non-overlapping word bounds within [activeStart, activeEnd]
  for (let i = 0; i < words.length; i++) {
    if (i < words.length - 1) {
      const nextStart = words[i + 1].start;
      const gap = Math.min(0.012, (nextStart - words[i].start) * 0.12);
      words[i].end = Number(
        Math.min(nextStart, Math.max(words[i].start + minWordDur * 0.5, nextStart - gap)).toFixed(3)
      );
    } else {
      words[i].end = Number(Math.max(words[i].start + minWordDur * 0.5, activeEnd).toFixed(3));
    }
  }

  return words;
}

/**
 * Computes natural proportional weights for a lyric line using syllable density,
 * punctuation pauses, and section boundaries so fallback spacing reflects cadence.
 */
function computeLineWeight(line: LyricLine, nextLine?: LyricLine): number {
  const words = line.text.trim().split(/\s+/).filter(Boolean);
  const syllables =
    words.length > 0
      ? words.reduce((sum, w) => sum + countSyllables(w), 0)
      : 2;
  const endsWithPause = /[.!?;:—–-]$/.test(line.text.trim()) ? 0.75 : 0;
  const sectionShift = nextLine && nextLine.section !== line.section ? 0.9 : 0;
  return Math.max(1.5, syllables + endsWithPause + sectionShift);
}

/**
 * Intelligent proportional fallback alignment across the usable track duration.
 * Guarantees strictly monotonic, non-overlapping line and word timestamps inside [0, totalDuration].
 */
export function distributeLyricsProportionally(
  lines: LyricLine[],
  totalDuration: number,
  onsets: number[] = [],
  warningMessage = 'Complex background mix or low vocal contrast detected. Applied proportional cadence distribution; refine individual cues on the timeline if needed.',
  confidence = 0.38,
  envelope?: number[],
  frameDurationSec?: number
): { lines: LyricLine[]; report: SyncReport } {
  const totalLines = lines.length;
  if (totalLines === 0) {
    return {
      lines: [],
      report: {
        method: 'local-acoustic',
        confidence: 0,
        matchedPhrases: 0,
        totalLines: 0,
        warnings: ['No lyric lines provided to synchronise.'],
        timestamp: Date.now(),
      },
    };
  }

  const safeDuration =
    Number.isFinite(totalDuration) && totalDuration > 0.5
      ? totalDuration
      : Math.max(totalLines * 2.5, 10);

  // Use first meaningful onset as smart lead-in if it sits cleanly in the intro window
  const introOnset = onsets.find(
    (o) => Number.isFinite(o) && o >= 0.08 && o <= Math.min(4.0, safeDuration * 0.22)
  );
  const defaultLeadIn =
    safeDuration > totalLines * 0.7 ? Math.min(0.6, safeDuration * 0.04) : 0;
  const leadIn =
    introOnset !== undefined && safeDuration > totalLines * 0.8
      ? Math.min(introOnset, safeDuration * 0.18)
      : defaultLeadIn;
  const tailMargin =
    safeDuration > totalLines * 0.7 ? Math.min(0.4, safeDuration * 0.03) : 0;

  const usableSpan = Math.max(0.25 * totalLines, safeDuration - leadIn - tailMargin);
  const scaleFactor =
    leadIn + usableSpan > safeDuration ? safeDuration / (leadIn + usableSpan) : 1;
  const effectiveLeadIn = leadIn * scaleFactor;
  const effectiveSpan = Math.max(0.2 * totalLines, (safeDuration - effectiveLeadIn - tailMargin * scaleFactor));

  const weights = lines.map((line, i) => computeLineWeight(line, lines[i + 1]));
  const totalWeight = Math.max(1, weights.reduce((a, b) => a + b, 0));

  let cursor = effectiveLeadIn;
  const distributed: LyricLine[] = [];

  for (let i = 0; i < totalLines; i++) {
    const slotDuration = (weights[i] / totalWeight) * effectiveSpan;
    const minDur = Math.min(0.4, slotDuration * 0.75);
    const breathGap = Math.min(0.08, slotDuration * 0.12);

    let rawStart = cursor;
    // Gently snap line start to a nearby onset if it preserves monotonicity and minimum duration
    if (onsets.length > 0 && slotDuration > 0.6) {
      const prevEnd = distributed[i - 1]?.end ?? 0;
      let bestOnset = rawStart;
      let bestDist = 0.14;
      for (const onset of onsets) {
        if (!Number.isFinite(onset)) continue;
        const d = Math.abs(onset - rawStart);
        if (
          d < bestDist &&
          onset >= prevEnd + 0.02 &&
          onset <= cursor + slotDuration - minDur - breathGap
        ) {
          bestDist = d;
          bestOnset = onset;
        }
      }
      rawStart = bestOnset;
    }

    const prevEnd = distributed[i - 1]?.end ?? 0;
    const start = Number(
      Math.max(prevEnd + (i > 0 ? 0.02 : 0), Math.min(safeDuration - minDur, rawStart)).toFixed(2)
    );
    const targetEnd =
      i === totalLines - 1
        ? Math.min(safeDuration, cursor + slotDuration)
        : Math.min(safeDuration, cursor + Math.max(minDur, slotDuration - breathGap));
    const end = Number(Math.max(start + minDur * 0.6, Math.min(safeDuration, targetEnd)).toFixed(2));

    cursor += slotDuration;

    distributed.push({
      ...lines[i],
      start,
      end,
      confidence,
      words: snapWordTimingsToOnsets(
        lines[i].text,
        start,
        end,
        onsets,
        lines[i].id,
        envelope,
        frameDurationSec
      ),
    });
  }

  return {
    lines: distributed,
    report: {
      method: 'local-acoustic',
      confidence,
      matchedPhrases: 0,
      totalLines,
      warnings: [warningMessage],
      timestamp: Date.now(),
    },
  };
}

function normalizeAlignedMonotonicity(
  aligned: LyricLine[],
  totalDuration: number,
  onsets: number[],
  envelope?: number[],
  frameDurationSec?: number
): LyricLine[] {
  const safeDuration =
    Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 30;

  const result: LyricLine[] = [];
  for (let i = 0; i < aligned.length; i++) {
    const line = aligned[i];
    const prevEnd = result[i - 1]?.end ?? 0;
    const rawStart = Number.isFinite(line.start) ? line.start : prevEnd + 0.04;
    const start = Number(
      Math.max(prevEnd + (i > 0 ? 0.02 : 0), Math.min(safeDuration - 0.25, rawStart)).toFixed(2)
    );
    const rawEnd = Number.isFinite(line.end) ? line.end : start + 1.5;
    const end = Number(
      Math.max(start + 0.25, Math.min(safeDuration, rawEnd)).toFixed(2)
    );

    result.push({
      ...line,
      start,
      end,
      words: snapWordTimingsToOnsets(
        line.text,
        start,
        end,
        onsets,
        line.id,
        envelope,
        frameDurationSec
      ),
    });
  }
  return result;
}

/**
 * Subdivides a long phrase or distributes lines monotonically across detected
 * vocal phrases using syllable density weights, falling back cleanly to
 * proportional cadence distribution whenever acoustic phrase extraction is
 * obscured by complex mixes or non-standard vocal dynamics.
 */
export function alignLyricsToAudio(
  lines: LyricLine[],
  analysis: AudioAnalysisResult
): { lines: LyricLine[]; report: SyncReport } {
  const warnings: string[] = [];
  const totalLines = lines.length;
  const phrases = Array.isArray(analysis?.phrases) ? analysis.phrases : [];
  const onsets = Array.isArray(analysis?.onsets) ? analysis.onsets : [];
  const totalDuration = Number.isFinite(analysis?.totalDuration)
    ? analysis.totalDuration
    : 0;
  const dynamicRange = Number.isFinite(analysis?.dynamicRange)
    ? analysis.dynamicRange
    : 0;

  if (totalLines === 0) {
    return {
      lines: [],
      report: {
        method: 'local-acoustic',
        confidence: 0,
        matchedPhrases: 0,
        totalLines: 0,
        warnings: ['No lyric lines provided to synchronise.'],
        timestamp: Date.now(),
      },
    };
  }

  try {
    if (totalDuration < 1 || dynamicRange < 0.05 || phrases.length === 0) {
      return distributeLyricsProportionally(
        lines,
        totalDuration,
        onsets,
        'Audio contains minimal vocal dynamic variation or continuous background instrumentation. Applied proportional cadence spacing; adjust timings manually on the timeline if needed.',
        0.32,
        analysis?.envelope,
        analysis?.frameDurationSec
      );
    }

    const totalPhraseTime = phrases.reduce(
      (s, p) => s + Math.max(0, p.end - p.start),
      0
    );
    const phraseCoverage = totalPhraseTime / Math.max(1, totalDuration);

    // Guard against compressed/sparse phrase false-positives on complex mixes
    // (e.g., 1 brief vocal peak detected inside a 60s dense instrumental track with 8 lines)
    if (
      (totalLines >= 3 && phraseCoverage < 0.25 && totalPhraseTime < totalLines * 0.9) ||
      (totalPhraseTime < totalLines * 0.35 && totalDuration >= totalLines * 0.9)
    ) {
      return distributeLyricsProportionally(
        lines,
        totalDuration,
        onsets,
        'Detected sparse vocal peaks inside a dense track mix. Applied proportional cadence distribution across the full track duration.',
        0.38,
        analysis?.envelope,
        analysis?.frameDurationSec
      );
    }

    const lineSyllables = lines.map((l) =>
      Math.max(2, l.text.split(/\s+/).reduce((s, w) => s + countSyllables(w), 0))
    );
    const totalSyllables = Math.max(1, lineSyllables.reduce((a, b) => a + b, 0));

    const aligned: LyricLine[] = [];
    let matchedPhrases = 0;

    if (phrases.length === totalLines) {
      // 1-to-1 phrase match
      matchedPhrases = totalLines;
      for (let i = 0; i < totalLines; i++) {
        const p = phrases[i];
        const start = Number(p.start.toFixed(2));
        const end = Number(p.end.toFixed(2));
        aligned.push({
          ...lines[i],
          start,
          end,
          confidence: 0.82,
          words: snapWordTimingsToOnsets(
            lines[i].text,
            start,
            end,
            onsets,
            lines[i].id,
            analysis.envelope,
            analysis.frameDurationSec
          ),
        });
      }
    } else if (phrases.length > totalLines) {
      // More detected audio regions than lyric lines: group adjacent regions by syllable proportion
      let pIdx = 0;
      let sylDone = 0;

      for (let i = 0; i < totalLines; i++) {
        const targetRatio = (sylDone + lineSyllables[i]) / totalSyllables;
        const targetTime = targetRatio * totalPhraseTime;
        const startPhrase = phrases[Math.min(pIdx, phrases.length - 1)];
        let endPhrase = startPhrase;
        let accTime = 0;

        for (let k = 0; k <= pIdx; k++) {
          accTime += phrases[k].end - phrases[k].start;
        }

        while (
          pIdx < phrases.length - (totalLines - i) &&
          accTime < targetTime * 0.92
        ) {
          pIdx++;
          endPhrase = phrases[pIdx];
          accTime += endPhrase.end - endPhrase.start;
        }

        const start = Number(startPhrase.start.toFixed(2));
        const end = Number(Math.max(start + 0.65, endPhrase.end).toFixed(2));
        matchedPhrases++;
        pIdx = Math.min(phrases.length - 1, pIdx + 1);
        sylDone += lineSyllables[i];

        aligned.push({
          ...lines[i],
          start,
          end,
          confidence: 0.68,
          words: snapWordTimingsToOnsets(
            lines[i].text,
            start,
            end,
            onsets,
            lines[i].id,
            analysis.envelope,
            analysis.frameDurationSec
          ),
        });
      }
      warnings.push(
        `Detected ${phrases.length} vocal phrases for ${totalLines} lyric lines (instrumental fills or ad-libs may have shifted grouping). Review timeline segments.`
      );
    } else {
      // Fewer phrases than lines (e.g. continuous singing without breath gaps):
      // Distribute lines across active vocal phrases proportionally by syllable count
      let phraseIdx = 0;
      let phraseOffset = 0;

      for (let i = 0; i < totalLines; i++) {
        const neededTime = (lineSyllables[i] / totalSyllables) * totalPhraseTime;
        let remaining = neededTime;
        let lineStart: number | null = null;
        let lineEnd = phrases[phrases.length - 1].end;

        while (remaining > 0.01 && phraseIdx < phrases.length) {
          const curPhrase = phrases[phraseIdx];
          const curStart = curPhrase.start + phraseOffset;
          const avail = Math.max(0, curPhrase.end - curStart);

          if (lineStart === null) lineStart = curStart;

          if (avail >= remaining || phraseIdx === phrases.length - 1) {
            lineEnd = Math.min(curPhrase.end, curStart + remaining);
            phraseOffset += remaining;
            remaining = 0;
          } else {
            remaining -= avail;
            phraseIdx++;
            phraseOffset = 0;
          }
        }

        const rawStart = lineStart ?? phrases[phrases.length - 1].start;
        let snappedStart = rawStart;
        let bestDist = 0.14;
        for (const onset of onsets) {
          const d = Math.abs(onset - rawStart);
          if (d < bestDist) {
            bestDist = d;
            snappedStart = onset;
          }
        }

        const prevEnd = aligned[i - 1]?.end ?? 0;
        const finalStart = Number(Math.max(prevEnd + 0.04, snappedStart).toFixed(2));
        const finalEnd = Number(Math.max(finalStart + 0.45, lineEnd).toFixed(2));

        aligned.push({
          ...lines[i],
          start: finalStart,
          end: finalEnd,
          confidence: 0.56,
          words: snapWordTimingsToOnsets(
            lines[i].text,
            finalStart,
            finalEnd,
            onsets,
            lines[i].id,
            analysis.envelope,
            analysis.frameDurationSec
          ),
        });
      }

      matchedPhrases = phrases.length;
      warnings.push(
        `Local acoustic analysis found ${phrases.length} continuous vocal blocks for ${totalLines} lines. Verify line boundaries on the timeline or use Tap Sync.`
      );
    }

    const normalized = normalizeAlignedMonotonicity(
      aligned,
      totalDuration,
      onsets,
      analysis.envelope,
      analysis.frameDurationSec
    );
    const alignedSpan =
      normalized.length > 0
        ? normalized[normalized.length - 1].end - normalized[0].start
        : 0;

    // Final safety check: if acoustic alignment collapsed lines into a tiny sliver of a long track, fall back
    if (totalLines >= 3 && totalDuration > 8 && alignedSpan < totalDuration * 0.18) {
      return distributeLyricsProportionally(
        lines,
        totalDuration,
        onsets,
        'Vocal isolation covered only a small portion of the track. Applied proportional cadence distribution across the full duration.',
        0.38,
        analysis.envelope,
        analysis.frameDurationSec
      );
    }

    const ratio = Math.min(phrases.length, totalLines) / Math.max(phrases.length, totalLines);
    const confidence = Number(
      Math.min(0.88, Math.max(0.35, 0.45 + ratio * 0.4)).toFixed(2)
    );

    return {
      lines: normalized,
      report: {
        method: 'local-acoustic',
        confidence,
        matchedPhrases,
        totalLines,
        warnings,
        timestamp: Date.now(),
      },
    };
  } catch {
    return distributeLyricsProportionally(
      lines,
      totalDuration,
      onsets,
      'Applied proportional cadence distribution fallback after encountering an irregular audio energy profile.',
      0.35,
      analysis?.envelope,
      analysis?.frameDurationSec
    );
  }
}

export interface AiAlignedSegment {
  lineIndex: number;
  start: number;
  end: number;
  words?: Array<{ text: string; start: number; end: number }>;
}

function getEnvelopeAtTime(
  envelope: number[],
  frameDurationSec: number,
  t: number
): number {
  if (envelope.length === 0 || frameDurationSec <= 0) return 0;
  const idx = Math.max(0, Math.min(envelope.length - 1, Math.round(t / frameDurationSec)));
  return envelope[idx] ?? 0;
}

export function resolveLineOverlaps(lines: LyricLine[], totalDuration: number): LyricLine[] {
  const safeDuration = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 30;
  const out = lines.map((l) => ({ ...l }));
  const minDur = 0.35;
  const gap = 0.03;

  for (let i = 0; i < out.length; i++) {
    out[i].start = Number(
      Math.max(0, Math.min(safeDuration - minDur, Number.isFinite(out[i].start) ? out[i].start : 0)).toFixed(2)
    );
    out[i].end = Number(
      Math.max(out[i].start + minDur, Math.min(safeDuration, Number.isFinite(out[i].end) ? out[i].end : out[i].start + 1.5)).toFixed(2)
    );

    if (i > 0) {
      const prev = out[i - 1];
      const cur = out[i];
      if (cur.start < prev.end + gap) {
        const overlap = prev.end + gap - cur.start;
        // Prefer trimming prev's lingering tail if prev stays comfortably readable (>= 0.45s),
        // preventing a single slow line from pushing every subsequent cue late.
        const maxTrimPrev = Math.max(0, prev.end - (prev.start + 0.45));
        if (overlap <= maxTrimPrev) {
          prev.end = Number(Math.max(prev.start + 0.4, cur.start - gap).toFixed(2));
        } else {
          // Split the budget evenly so neither line swallows the other
          if (maxTrimPrev > 0) {
            prev.end = Number((prev.end - Math.min(maxTrimPrev, overlap * 0.55)).toFixed(2));
          }
          cur.start = Number(Math.min(safeDuration - minDur, prev.end + gap).toFixed(2));
          if (cur.end < cur.start + minDur) {
            cur.end = Number(Math.min(safeDuration, cur.start + 0.65).toFixed(2));
          }
        }
      }
    }
  }
  return out;
}

function estimateGlobalTimingOffset(
  lines: LyricLine[],
  analysis: AudioAnalysisResult,
  totalDuration: number
): number {
  const { envelope, frameDurationSec, dynamicRange, onsets } = analysis;
  if (envelope.length < 10 || frameDurationSec <= 0 || dynamicRange < 0.05 || lines.length < 2) {
    return 0;
  }

  const scoreShift = (delta: number): number => {
    let activeSum = 0;
    let activeCount = 0;
    let gapSum = 0;
    let gapCount = 0;
    let onsetHits = 0;

    for (let i = 0; i < lines.length; i++) {
      const s = Math.max(0, Math.min(totalDuration - 0.2, lines[i].start + delta));
      const e = Math.max(s + 0.2, Math.min(totalDuration, lines[i].end + delta));
      const attackStart = s;
      const attackEnd = Math.min(e - 0.02, s + 0.24);
      const step = Math.max(frameDurationSec, (attackEnd - attackStart) / 6);
      for (let t = attackStart; t <= attackEnd; t += step) {
        activeSum += getEnvelopeAtTime(envelope, frameDurationSec, t);
        activeCount++;
      }

      // Check immediate pre-line gap (0.26s before cue start)
      const preStart = Math.max(0, s - 0.26);
      const prevEnd = i > 0 ? Math.max(0, lines[i - 1].end + delta) : 0;
      const gapFloor = Math.max(prevEnd, preStart);
      const gapCeil = Math.max(gapFloor, s - 0.02);
      if (gapCeil - gapFloor >= 0.04) {
        for (let t = gapFloor; t < gapCeil; t += frameDurationSec) {
          gapSum += getEnvelopeAtTime(envelope, frameDurationSec, t);
          gapCount++;
        }
      }

      if (onsets.length > 0) {
        for (let k = 0; k < onsets.length; k++) {
          const dist = Math.abs(onsets[k] - 0.02 - s);
          if (dist <= 0.07) {
            onsetHits += 1 - dist / 0.075;
            break;
          }
        }
      }
    }

    const activeMean = activeCount > 0 ? activeSum / activeCount : 0;
    const gapMean = gapCount > 0 ? gapSum / gapCount : activeMean * 0.7;
    const onsetBonus = (onsetHits / Math.max(1, lines.length)) * 0.24;
    return activeMean - gapMean * 0.92 + onsetBonus - 0.04 * delta * delta;
  };

  const baseScore = scoreShift(0);
  let bestDelta = 0;
  let bestScore = baseScore;

  for (let delta = -0.9; delta <= 0.901; delta += 0.02) {
    const rounded = Number(delta.toFixed(3));
    if (rounded === 0) continue;
    const sc = scoreShift(rounded);
    if (sc > bestScore) {
      bestScore = sc;
      bestDelta = rounded;
    }
  }

  return bestScore > baseScore + Math.max(0.015, Math.abs(baseScore) * 0.025)
    ? bestDelta
    : 0;
}

/**
 * Refines LLM-generated or rough lyric line timestamps against decoded vocal-band
 * envelope transitions and spectral-flux onsets so cues snap tightly to real singing.
 */
export function refineSegmentsWithAcousticAnalysis(
  lines: LyricLine[],
  analysis: AudioAnalysisResult | null | undefined,
  totalDuration: number
): LyricLine[] {
  if (lines.length === 0) return [];
  const safeDuration =
    Number.isFinite(totalDuration) && totalDuration > 0.5
      ? totalDuration
      : analysis?.totalDuration && analysis.totalDuration > 0.5
        ? analysis.totalDuration
        : 30;

  if (!analysis || analysis.envelope.length === 0 || analysis.frameDurationSec <= 0) {
    return resolveLineOverlaps(lines, safeDuration).map((line) => ({
      ...line,
      words: snapWordTimingsToOnsets(line.text, line.start, line.end, analysis?.onsets ?? [], line.id),
    }));
  }

  const { envelope, frameDurationSec, onsets, dynamicRange } = analysis;
  const globalOffset = estimateGlobalTimingOffset(lines, analysis, safeDuration);

  const shifted = lines.map((l) => ({
    ...l,
    start: Math.max(0, Math.min(safeDuration - 0.35, l.start + globalOffset)),
    end: Math.max(0.35, Math.min(safeDuration, l.end + globalOffset)),
  }));

  const snapped: LyricLine[] = [];
  const backSearchRadius = dynamicRange >= 0.05 ? 0.9 : 0.25;
  const fwdSearchRadius = dynamicRange >= 0.05 ? 0.42 : 0.16;

  for (let i = 0; i < shifted.length; i++) {
    const line = shifted[i];
    // Never let a preceding line's lingering reverb tail block line i from snapping back to its true vocal onset.
    const prevFloor = i > 0 ? snapped[i - 1].start + 0.38 : 0;
    const nextStart = i < shifted.length - 1 ? shifted[i + 1].start : safeDuration;

    const minStart = Math.max(prevFloor, line.start - backSearchRadius, 0);
    const maxStart = Math.min(line.end - 0.35, line.start + fwdSearchRadius, safeDuration - 0.35);

    let refinedStart = Math.max(minStart, Math.min(maxStart, line.start));

    if (maxStart > minStart + frameDurationSec * 2) {
      const fMin = Math.max(0, Math.floor(minStart / frameDurationSec));
      const fMax = Math.min(envelope.length - 1, Math.ceil(maxStart / frameDurationSec));

      let localMin = 1;
      let localMax = 0;
      for (let f = fMin; f <= fMax; f++) {
        if (envelope[f] < localMin) localMin = envelope[f];
        if (envelope[f] > localMax) localMax = envelope[f];
      }

      const localContrast = localMax - localMin;
      let startedInSilence = false;
      if (localContrast >= 0.08 && dynamicRange >= 0.04) {
        const silenceThresh = localMin + localContrast * 0.1;
        const riseThresh = localMin + localContrast * 0.14;
        const curEnv = getEnvelopeAtTime(envelope, frameDurationSec, line.start);
        const nextEnv = getEnvelopeAtTime(envelope, frameDurationSec, line.start + frameDurationSec * 2);

        if (curEnv < silenceThresh && nextEnv < silenceThresh) {
          startedInSilence = true;
          for (let f = Math.max(fMin, Math.floor(line.start / frameDurationSec)); f <= fMax; f++) {
            if (envelope[f] >= riseThresh) {
              refinedStart = Math.max(minStart, f * frameDurationSec - 0.025);
              break;
            }
          }
        } else {
          // Walk backward from line.start to find the crisp initial rise edge of this phrase
          const fStart = Math.min(fMax, Math.round(line.start / frameDurationSec));
          let entryFrame = fStart;
          for (let f = fStart; f > fMin; f--) {
            if (envelope[f - 1] < riseThresh && envelope[f] >= riseThresh) {
              entryFrame = f;
              break;
            }
          }
          if (entryFrame !== fStart) {
            refinedStart = Math.max(minStart, entryFrame * frameDurationSec - 0.025);
          } else if (onsets.length > 0) {
            // Backing instruments can keep envelope above riseThresh; walk backward through onsets
            // until the onset preceded by a low-energy pre-attack trough before this phrase.
            for (let k = onsets.length - 1; k >= 0; k--) {
              const cand = onsets[k] - 0.025;
              if (cand > line.start - 0.03) continue;
              if (cand < minStart || cand > maxStart) continue;
              const preE =
                (getEnvelopeAtTime(envelope, frameDurationSec, cand - 0.1) +
                  getEnvelopeAtTime(envelope, frameDurationSec, cand - 0.04)) *
                0.5;
              const postE =
                (getEnvelopeAtTime(envelope, frameDurationSec, cand + 0.05) +
                  getEnvelopeAtTime(envelope, frameDurationSec, cand + 0.12)) *
                0.5;
              if (postE - preE >= localContrast * 0.16 && preE <= localMin + localContrast * 0.42) {
                refinedStart = cand;
                break;
              }
            }
          }
        }
      }

      // Fine-snap onto nearby spectral-flux onset without pulling active vocals onto a later syllable
      let bestOnset = refinedStart;
      let bestDist = 0.14;
      for (const onset of onsets) {
        const candidate = onset - 0.025;
        if (!startedInSilence && candidate > refinedStart + 0.04) continue;
        const d = Math.abs(candidate - refinedStart);
        if (d < bestDist && candidate >= minStart && candidate <= maxStart) {
          bestDist = d;
          bestOnset = candidate;
        }
      }
      refinedStart = bestOnset;
    }

    // If line i pulled back into line i-1's lingering tail, trim line i-1's end cleanly instead of delaying line i
    if (i > 0 && refinedStart < snapped[i - 1].end + 0.02) {
      const trimmedPrevEnd = Math.max(snapped[i - 1].start + 0.35, refinedStart - 0.02);
      snapped[i - 1] = {
        ...snapped[i - 1],
        end: Number(trimmedPrevEnd.toFixed(2)),
      };
      refinedStart = Math.max(refinedStart, snapped[i - 1].end + 0.02);
    }

    const startShift = refinedStart - line.start;
    const hardMaxEnd =
      i < shifted.length - 1 ? Math.max(refinedStart + 0.35, nextStart - 0.03) : safeDuration;
    const maxEnd = Math.min(safeDuration, hardMaxEnd, line.end + 0.34);
    const minEndPullback = startShift < -0.1 ? 0.85 : 0.58;
    const defaultMinEnd = Math.min(maxEnd, Math.max(refinedStart + 0.35, line.end - minEndPullback));
    let refinedEnd = Math.max(defaultMinEnd, Math.min(maxEnd, line.end + Math.min(0, startShift * 0.4)));

    if (maxEnd > refinedStart + 0.5 && dynamicRange >= 0.04) {
      const tokenCount = Math.max(1, line.text.trim().split(/\s+/).filter(Boolean).length);
      const minVocalEnd = Math.min(maxEnd, refinedStart + Math.max(0.55, tokenCount * 0.18));
      const fLineStart = Math.max(0, Math.floor(refinedStart / frameDurationSec));
      const fMinEnd = Math.max(fLineStart, Math.floor(minVocalEnd / frameDurationSec));
      const fMax = Math.min(envelope.length - 1, Math.ceil(maxEnd / frameDurationSec));

      let localMin = 1;
      let localMax = 0;
      for (let f = fLineStart; f <= fMax; f++) {
        if (envelope[f] < localMin) localMin = envelope[f];
        if (envelope[f] > localMax) localMax = envelope[f];
      }
      if (localMax - localMin >= 0.1) {
        const dropThresh = localMin + (localMax - localMin) * 0.24;
        let lastActiveFrame = -1;
        for (let f = fMax; f >= fMinEnd; f--) {
          if (envelope[f] >= dropThresh) {
            lastActiveFrame = f;
            break;
          }
        }
        if (lastActiveFrame >= fMinEnd) {
          const quietTailSec = (fMax - lastActiveFrame) * frameDurationSec;
          const isSustainedInstrumentalGap =
            quietTailSec >= 1.15 && localMax - localMin >= 0.15;
          const activeMinEnd = isSustainedInstrumentalGap ? minVocalEnd : defaultMinEnd;
          refinedEnd = Math.max(
            activeMinEnd,
            Math.min(maxEnd, lastActiveFrame * frameDurationSec + (isSustainedInstrumentalGap ? 0.08 : 0.05))
          );
        }
      }
    }

    snapped.push({
      ...line,
      start: Number(refinedStart.toFixed(2)),
      end: Number(Math.max(refinedStart + 0.35, refinedEnd).toFixed(2)),
    });
  }

  const resolved = resolveLineOverlaps(snapped, safeDuration);

  return resolved.map((line) => {
    const tokens = line.text.trim().split(/\s+/).filter(Boolean);
    const orig = lines.find((o) => o.id === line.id);
    const origWords = orig?.words ?? [];
    const origSpan = orig ? Math.max(0.1, orig.end - orig.start) : 0;

    let validMonotonicWords =
      origWords.length === tokens.length &&
      tokens.length > 0 &&
      origWords.every(
        (w, idx) =>
          Number.isFinite(w.start) &&
          Number.isFinite(w.end) &&
          w.end > w.start + 0.03 &&
          (idx === 0 || w.start >= origWords[idx - 1].start + 0.02)
      );

    if (validMonotonicWords && orig) {
      const coveredSpan = origWords[origWords.length - 1].end - origWords[0].start;
      if (coveredSpan < origSpan * 0.4) {
        validMonotonicWords = false;
      }
    }

    if (validMonotonicWords && orig) {
      const scale = (line.end - line.start) / origSpan;
      const mappedWords: WordTiming[] = origWords.map((w, idx) => {
        const relS = (w.start - orig.start) * scale;
        const relE = (w.end - orig.start) * scale;
        const wStart = Number(
          Math.max(line.start, Math.min(line.end - 0.04, line.start + relS)).toFixed(3)
        );
        const wEnd = Number(
          Math.max(wStart + 0.04, Math.min(line.end, line.start + relE)).toFixed(3)
        );
        return {
          ...w,
          id: w.id || `${line.id}_w${idx}`,
          start: wStart,
          end: wEnd,
        };
      });
      return { ...line, words: mappedWords };
    }

    return {
      ...line,
      words: snapWordTimingsToOnsets(
        line.text,
        line.start,
        line.end,
        onsets,
        line.id,
        envelope,
        frameDurationSec
      ),
    };
  });
}

/**
 * Uniformly nudges all lyric cues and word timestamps earlier (negative deltaSec)
 * or later (positive deltaSec), keeping monotonic bounds within [0, totalDuration].
 */
export function shiftLyricsTiming(
  lines: LyricLine[],
  deltaSec: number,
  totalDuration: number
): LyricLine[] {
  if (lines.length === 0 || !Number.isFinite(deltaSec) || deltaSec === 0) return lines;
  const safeDuration = Number.isFinite(totalDuration) && totalDuration > 0.5 ? totalDuration : 300;
  const shifted = lines.map((line) => {
    const dur = Math.max(0.35, line.end - line.start);
    const nextStart = Number(
      Math.max(0, Math.min(safeDuration - 0.35, line.start + deltaSec)).toFixed(2)
    );
    const nextEnd = Number(
      Math.max(nextStart + 0.35, Math.min(safeDuration, nextStart + dur)).toFixed(2)
    );
    const actualShift = nextStart - line.start;
    return {
      ...line,
      start: nextStart,
      end: nextEnd,
      words: line.words.map((w, idx) => {
        const wDur = Math.max(0.04, w.end - w.start);
        const wStart = Number(
          Math.max(nextStart, Math.min(nextEnd - 0.04, idx === 0 ? nextStart : w.start + actualShift)).toFixed(3)
        );
        const wEnd = Number(
          Math.max(wStart + 0.04, Math.min(nextEnd, wStart + wDur)).toFixed(3)
        );
        return { ...w, start: wStart, end: wEnd };
      }),
    };
  });
  return resolveLineOverlaps(shifted, safeDuration);
}

export function refineWithAiTimestamps(
  lines: LyricLine[],
  aiSegments: AiAlignedSegment[],
  onsets: number[],
  totalDuration: number,
  aiNotes: string[],
  analysis?: AudioAnalysisResult | null
): { lines: LyricLine[]; report: SyncReport } {
  const warnings = [...aiNotes];
  const safeDuration =
    Number.isFinite(totalDuration) && totalDuration > 0.5 ? totalDuration : 30;

  // Detect 1-based lineIndex output from LLM (no index 0, max index == lines.length)
  const indices = aiSegments
    .map((s) => s.lineIndex)
    .filter((n) => Number.isInteger(n));
  const looksOneBased =
    indices.length > 0 &&
    !indices.includes(0) &&
    indices.includes(1) &&
    Math.max(...indices) <= lines.length;
  const indexShift = looksOneBased ? -1 : 0;

  const matchedByIdx = new Map<number, AiAlignedSegment>();
  for (const seg of aiSegments) {
    if (!Number.isInteger(seg.lineIndex)) continue;
    const normalizedIdx = seg.lineIndex + indexShift;
    if (
      normalizedIdx >= 0 &&
      normalizedIdx < lines.length &&
      Number.isFinite(seg.start) &&
      Number.isFinite(seg.end) &&
      !matchedByIdx.has(normalizedIdx)
    ) {
      matchedByIdx.set(normalizedIdx, seg);
    }
  }

  let matched = 0;
  const preliminary: Array<LyricLine & { _matched: boolean }> = lines.map((line, idx) => {
    const seg = matchedByIdx.get(idx);
    if (!seg) {
      return { ...line, _matched: false };
    }

    matched++;
    const start = Number(Math.max(0, Math.min(safeDuration - 0.35, seg.start)).toFixed(2));
    const end = Number(Math.max(start + 0.35, Math.min(safeDuration, seg.end)).toFixed(2));

    let words: WordTiming[] = [];
    if (Array.isArray(seg.words) && seg.words.length > 0) {
      const candidateWords = seg.words
        .filter((w) => typeof w.text === 'string' && w.text.trim().length > 0)
        .map((w, wIdx) => ({
          id: `${line.id}_w${wIdx}_${Math.random().toString(36).slice(2, 6)}`,
          text: w.text.trim(),
          start: Number(Math.max(start, Math.min(end - 0.05, Number(w.start) || start)).toFixed(3)),
          end: Number(Math.max(start + 0.05, Math.min(end, Number(w.end) || end)).toFixed(3)),
        }));
      const monotonic = candidateWords.every(
        (w, wIdx) => w.end > w.start + 0.02 && (wIdx === 0 || w.start >= candidateWords[wIdx - 1].start + 0.01)
      );
      if (monotonic && candidateWords.length > 0) {
        words = candidateWords;
      }
    }

    if (words.length === 0) {
      words = snapWordTimingsToOnsets(line.text, start, end, onsets, line.id);
    }

    return {
      ...line,
      start,
      end,
      confidence: 0.9,
      words,
      _matched: true,
    };
  });

  // Interpolate any unmatched gap spans between matched anchors using syllable proportions
  if (matched > 0 && matched < preliminary.length) {
    let i = 0;
    while (i < preliminary.length) {
      if (preliminary[i]._matched) {
        i++;
        continue;
      }
      const gapStartIdx = i;
      while (i < preliminary.length && !preliminary[i]._matched) i++;
      const gapEndIdx = i - 1;

      const anchorStart = gapStartIdx > 0 ? preliminary[gapStartIdx - 1].end + 0.04 : 0;
      const anchorEnd =
        i < preliminary.length ? Math.max(anchorStart + 0.4 * (gapEndIdx - gapStartIdx + 1), preliminary[i].start - 0.04) : safeDuration;
      const span = Math.max(0.4 * (gapEndIdx - gapStartIdx + 1), anchorEnd - anchorStart);

      const gapWeights: number[] = [];
      for (let g = gapStartIdx; g <= gapEndIdx; g++) {
        gapWeights.push(computeLineWeight(preliminary[g], preliminary[g + 1]));
      }
      const totalGapWeight = Math.max(1, gapWeights.reduce((a, b) => a + b, 0));

      let cursor = anchorStart;
      for (let g = gapStartIdx; g <= gapEndIdx; g++) {
        const dur = (gapWeights[g - gapStartIdx] / totalGapWeight) * span;
        const s = Number(Math.max(0, Math.min(safeDuration - 0.35, cursor)).toFixed(2));
        const e = Number(Math.max(s + 0.35, Math.min(safeDuration, cursor + dur - 0.04)).toFixed(2));
        preliminary[g].start = s;
        preliminary[g].end = e;
        preliminary[g].confidence = 0.62;
        preliminary[g].words = snapWordTimingsToOnsets(
          preliminary[g].text,
          s,
          e,
          onsets,
          preliminary[g].id
        );
        cursor += dur;
      }
    }
  }

  const cleanLines: LyricLine[] = preliminary.map(({ _matched: _, ...rest }) => rest);
  const refined = analysis
    ? refineSegmentsWithAcousticAnalysis(cleanLines, analysis, safeDuration)
    : resolveLineOverlaps(cleanLines, safeDuration).map((line) => ({
        ...line,
        words:
          line.words.length > 0
            ? line.words
            : snapWordTimingsToOnsets(line.text, line.start, line.end, onsets, line.id),
      }));

  const confidence = Number(((matched / Math.max(1, lines.length)) * 0.92).toFixed(2));
  if (matched < lines.length) {
    warnings.push(
      `AI vocal alignment matched ${matched} of ${lines.length} lines; remaining lines interpolated between anchors.`
    );
  }

  return {
    lines: refined,
    report: {
      method: 'ai-acoustic',
      confidence,
      matchedPhrases: matched,
      totalLines: lines.length,
      warnings,
      timestamp: Date.now(),
    },
  };
}

export function encodeFloat32ToWavBlob(
  samples: Float32Array,
  sampleRate: number
): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

