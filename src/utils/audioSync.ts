import { LyricLine, SyncReport, VocalRole, WordTiming } from '../types/editor';
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

  // Adaptive local-window onset peak picking so quiet verse words remain detectable
  // even when loud choruses elevate the track-wide mean flux.
  const meanFlux =
    fluxRaw.reduce((acc, v) => acc + v, 0) / Math.max(1, fluxRaw.length);
  const fluxPrefix = new Float64Array(numFrames + 1);
  for (let f = 0; f < numFrames; f++) {
    fluxPrefix[f + 1] = fluxPrefix[f] + fluxRaw[f];
  }
  const localHalfWin = Math.max(12, Math.round(0.6 / frameDurationSec));
  const minOnsetGapFrames = Math.max(2, Math.round(0.075 / frameDurationSec));
  const onsets: number[] = [];
  let lastOnsetFrame = -minOnsetGapFrames;

  for (let f = 1; f < numFrames - 1; f++) {
    const wStart = Math.max(0, f - localHalfWin);
    const wEnd = Math.min(numFrames, f + localHalfWin + 1);
    const localMean = (fluxPrefix[wEnd] - fluxPrefix[wStart]) / Math.max(1, wEnd - wStart);
    const onsetThreshold = Math.max(
      localMean * 1.38 + normMax * 0.006,
      meanFlux * 0.32 + normMax * 0.008
    );

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
        // Gentle release threshold (4% above local floor) so soft ending consonants
        // and held worship notes remain visible until full pronunciation decay.
        const tailThresh = localMin + (localMax - localMin) * 0.04;

        let lastActive = fEnd;
        while (lastActive > fStart && (envelope[lastActive] ?? 0) < tailThresh) {
          lastActive--;
        }

        const candEnd = Math.max(
          activeStart + minNeededSpan,
          Math.min(safeEnd, (lastActive + 1) * frameDurationSec + 0.1)
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

  const candidateOnsets = onsets.filter(
    (o) => Number.isFinite(o) && o >= activeStart - 0.04 && o <= activeEnd - minWordDur
  );

  // Also detect local sub-line syllable/word attack rises directly from localEnvSlice
  // so soft consonants and rapid words snap cleanly even if global spectral flux missed them.
  if (localEnvSlice && localEnvSlice.length > 4 && frameDurationSec && frameDurationSec > 0) {
    const aStartF = Math.max(0, Math.floor(activeStart / frameDurationSec));
    const diffs = localEnvSlice.map((val, idx) =>
      idx === 0 ? 0 : Math.max(0, val - localEnvSlice[idx - 1])
    );
    const meanDiff = diffs.reduce((s, d) => s + d, 0) / Math.max(1, diffs.length);
    const diffThresh = Math.max(0.012, meanDiff * 1.25);
    const minSubGap = 0.065;
    for (let k = 1; k < diffs.length - 1; k++) {
      if (diffs[k] > diffThresh && diffs[k] >= diffs[k - 1] && diffs[k] > diffs[k + 1]) {
        const t = Number(((aStartF + k) * frameDurationSec).toFixed(3));
        if (
          t >= activeStart &&
          t <= activeEnd - minWordDur &&
          !candidateOnsets.some((o) => Math.abs(o - t) < minSubGap)
        ) {
          candidateOnsets.push(t);
        }
      }
    }
    candidateOnsets.sort((a, b) => a - b);
  }

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

    if (i > 0 && candidateOnsets.length > 0) {
      const remainingWords = tokens.length - i;
      const maxAllowedStart = activeEnd - remainingWords * minWordDur;
      const minAllowedStart = words[i - 1].start + minWordDur;

      let bestOnset = expectedStart;
      let bestDist = Math.min(0.22, Math.max(0.14, (duration / tokens.length) * 0.55));
      for (const onset of candidateOnsets) {
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
  const lastEndByRole: Partial<Record<VocalRole, number>> = {};

  for (let i = 0; i < aligned.length; i++) {
    const line = aligned[i];
    const role = line.vocalRole ?? 'lead';
    const prevRoleEnd = lastEndByRole[role];
    const prevEnd = prevRoleEnd ?? 0;
    const rawStart = Number.isFinite(line.start) ? line.start : prevEnd + 0.04;
    const start = Number(
      Math.max(
        prevRoleEnd !== undefined ? prevRoleEnd + 0.02 : 0,
        Math.min(safeDuration - 0.25, rawStart)
      ).toFixed(2)
    );
    const rawEnd = Number.isFinite(line.end) ? line.end : start + 1.5;
    const end = Number(
      Math.max(start + 0.25, Math.min(safeDuration, rawEnd)).toFixed(2)
    );

    lastEndByRole[role] = end;
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

function lineRoleLayer(line: LyricLine): VocalRole {
  return line.vocalRole ?? 'lead';
}

export function resolveLineOverlaps(lines: LyricLine[], totalDuration: number): LyricLine[] {
  const safeDuration = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 30;
  const out = lines.map((l) => ({ ...l }));
  const minDur = 0.35;
  const gap = 0.015;
  const lastIndexByRole: Partial<Record<VocalRole, number>> = {};

  for (let i = 0; i < out.length; i++) {
    out[i].start = Number(
      Math.max(0, Math.min(safeDuration - minDur, Number.isFinite(out[i].start) ? out[i].start : 0)).toFixed(2)
    );
    out[i].end = Number(
      Math.max(out[i].start + minDur, Math.min(safeDuration, Number.isFinite(out[i].end) ? out[i].end : out[i].start + 1.5)).toFixed(2)
    );

    const role = lineRoleLayer(out[i]);
    const prevSameRoleIdx = lastIndexByRole[role];
    if (prevSameRoleIdx !== undefined) {
      const prev = out[prevSameRoleIdx];
      const cur = out[i];
      if (cur.start < prev.end + gap) {
        const overlap = prev.end + gap - cur.start;
        // Prefer keeping prev's tail pronunciation intact, trimming gently (<= 0.32s) only when needed.
        const maxTrimPrev = Math.min(0.32, Math.max(0, prev.end - (prev.start + 0.45)));
        if (overlap <= maxTrimPrev) {
          prev.end = Number(Math.max(prev.start + 0.4, cur.start - gap).toFixed(2));
        } else {
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
    lastIndexByRole[role] = i;
  }
  return out;
}

function estimateTimingOffsetForSubset(
  lines: LyricLine[],
  analysis: AudioAnalysisResult,
  totalDuration: number,
  maxSearchDelta = 0.9
): number {
  const { envelope, frameDurationSec, dynamicRange, onsets } = analysis;
  if (envelope.length < 10 || frameDurationSec <= 0 || dynamicRange < 0.05 || lines.length === 0) {
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
    return activeMean - gapMean * 0.92 + onsetBonus - 0.03 * delta * delta;
  };

  const baseScore = scoreShift(0);
  let bestDelta = 0;
  let bestScore = baseScore;

  for (let delta = -maxSearchDelta; delta <= maxSearchDelta + 0.001; delta += 0.02) {
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
 * Estimates smooth per-line timing offsets across long songs (2-10 minutes) using
 * local ~75s analysis windows so progressive clock or tempo drift in minutes 2-9
 * is calibrated independently from the opening verses.
 */
function computePerLineWindowOffsets(
  lines: LyricLine[],
  analysis: AudioAnalysisResult,
  totalDuration: number
): number[] {
  if (lines.length === 0) return [];
  const firstStart = lines[0].start;
  const lastEnd = lines[lines.length - 1].end;
  const spanSec = Math.max(0, lastEnd - firstStart);

  if (lines.length < 6 || spanSec <= 95) {
    const globalDelta =
      lines.length >= 2 ? estimateTimingOffsetForSubset(lines, analysis, totalDuration, 0.9) : 0;
    return lines.map(() => globalDelta);
  }

  const WINDOW_SPAN_SEC = 75;
  const MAX_CONTIGUOUS_GAP_SEC = 40;
  const windows: Array<{ startIdx: number; endIdx: number }> = [];
  let startIdx = 0;

  while (startIdx < lines.length) {
    const winOrigin = lines[startIdx].start;
    let endIdx = startIdx;
    while (
      endIdx + 1 < lines.length &&
      lines[endIdx + 1].start - lines[endIdx].end <= MAX_CONTIGUOUS_GAP_SEC &&
      (lines[endIdx + 1].end - winOrigin <= WINDOW_SPAN_SEC || endIdx - startIdx + 1 < 4)
    ) {
      endIdx++;
    }
    windows.push({ startIdx, endIdx });
    startIdx = endIdx + 1;
  }

  if (windows.length > 1) {
    const lastWin = windows[windows.length - 1];
    const prevWin = windows[windows.length - 2];
    const seamGap = lines[lastWin.startIdx].start - lines[prevWin.endIdx].end;
    if (lastWin.endIdx - lastWin.startIdx + 1 < 3 && seamGap <= MAX_CONTIGUOUS_GAP_SEC) {
      prevWin.endIdx = lastWin.endIdx;
      windows.pop();
    }
  }

  const anchors = windows.map((w) => {
    const subset = lines.slice(w.startIdx, w.endIdx + 1);
    const delta = estimateTimingOffsetForSubset(subset, analysis, totalDuration, 1.35);
    const center = (subset[0].start + subset[subset.length - 1].end) * 0.5;
    return { center, delta };
  });

  if (anchors.length === 1) {
    return lines.map(() => anchors[0].delta);
  }

  return lines.map((line) => {
    const t = (line.start + line.end) * 0.5;
    if (t <= anchors[0].center) return anchors[0].delta;
    if (t >= anchors[anchors.length - 1].center) return anchors[anchors.length - 1].delta;
    for (let a = 0; a < anchors.length - 1; a++) {
      const left = anchors[a];
      const right = anchors[a + 1];
      if (t >= left.center && t <= right.center) {
        const ratio =
          right.center > left.center ? (t - left.center) / (right.center - left.center) : 0;
        return Number((left.delta * (1 - ratio) + right.delta * ratio).toFixed(3));
      }
    }
    return 0;
  });
}

/**
 * Refines LLM-generated or rough lyric line timestamps against decoded vocal-band
 * envelope transitions and spectral-flux onsets so cues snap tightly to real singing
 * from start to finish even across 5-10 minute tracks.
 */
export function refineSegmentsWithAcousticAnalysis(
  lines: LyricLine[],
  analysis: AudioAnalysisResult | null | undefined,
  totalDuration: number,
  options?: { preserveAiAnchors?: boolean }
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

  const preserveAiAnchors = Boolean(options?.preserveAiAnchors);
  const { envelope, frameDurationSec, onsets, dynamicRange } = analysis;
  const lineOffsets = preserveAiAnchors
    ? lines.map(() => 0)
    : computePerLineWindowOffsets(lines, analysis, safeDuration);

  const shifted = lines.map((l, idx) => {
    const offset = lineOffsets[idx] ?? 0;
    return {
      ...l,
      start: Math.max(0, Math.min(safeDuration - 0.35, l.start + offset)),
      end: Math.max(0.35, Math.min(safeDuration, l.end + offset)),
    };
  });

  const snapped: LyricLine[] = [];
  const backSearchRadius = preserveAiAnchors
    ? 0.14
    : dynamicRange >= 0.05
      ? 0.9
      : 0.25;
  const fwdSearchRadius = preserveAiAnchors
    ? 0.14
    : dynamicRange >= 0.05
      ? 0.42
      : 0.16;

  for (let i = 0; i < shifted.length; i++) {
    const line = shifted[i];
    const curRole = lineRoleLayer(line);
    let prevSameIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (lineRoleLayer(shifted[j]) === curRole) {
        prevSameIdx = j;
        break;
      }
    }
    let nextSameIdx = -1;
    for (let j = i + 1; j < shifted.length; j++) {
      if (lineRoleLayer(shifted[j]) === curRole) {
        nextSameIdx = j;
        break;
      }
    }

    // Check whether this secondary vocal cue (backing/choir/adlib) intentionally overlaps a lead cue.
    const overlapsDifferentRole =
      curRole !== 'lead' &&
      shifted.some(
        (other, j) =>
          j !== i &&
          lineRoleLayer(other) !== curRole &&
          Math.min(line.end, other.end) - Math.max(line.start, other.start) > 0.15
      );

    // Never let a preceding sequential line's lingering reverb tail block line i from snapping back.
    const prevFloor = prevSameIdx >= 0 ? snapped[prevSameIdx].start + 0.38 : 0;
    const nextStart = nextSameIdx >= 0 ? shifted[nextSameIdx].start : safeDuration;

    const minStart = Math.max(prevFloor, line.start - backSearchRadius, 0);
    const maxStartBase = Math.min(line.end - 0.35, line.start + fwdSearchRadius, safeDuration - 0.35);
    const maxStartExpanded = Math.min(
      line.end - 0.35,
      line.start + Math.max(fwdSearchRadius, dynamicRange >= 0.05 ? 0.85 : 0.24),
      safeDuration - 0.35
    );
    let maxStart = maxStartBase;

    let refinedStart = Math.max(minStart, Math.min(maxStart, line.start));

    if (maxStartExpanded > minStart + frameDurationSec * 2) {
      const fMin = Math.max(0, Math.floor(minStart / frameDurationSec));
      const fMaxExpanded = Math.min(envelope.length - 1, Math.ceil(maxStartExpanded / frameDurationSec));

      let localMin = 1;
      let localMax = 0;
      for (let f = fMin; f <= fMaxExpanded; f++) {
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
          maxStart = maxStartExpanded;
          for (let f = Math.max(fMin, Math.floor(line.start / frameDurationSec)); f <= fMaxExpanded; f++) {
            if (envelope[f] >= riseThresh) {
              refinedStart = Math.max(minStart, Math.min(maxStart, f * frameDurationSec - 0.025));
              break;
            }
          }
        } else {
          const fMax = Math.min(fMaxExpanded, Math.ceil(maxStart / frameDurationSec));
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

    // If overlapping backing/choir/adlib cue shares the mix with a lead belt, keep its own explicit window
    // rather than letting the dominant lead attack hijack its timestamps.
    if (overlapsDifferentRole) {
      snapped.push({
        ...line,
        start: Number(Math.max(prevFloor, line.start).toFixed(2)),
        end: Number(Math.max(line.start + 0.35, Math.min(safeDuration, line.end)).toFixed(2)),
      });
      continue;
    }

    // If line i pulled back into prevSameIdx's lingering tail, trim prevSameIdx's end cleanly instead of delaying line i
    if (prevSameIdx >= 0 && refinedStart < snapped[prevSameIdx].end + 0.02) {
      const trimmedPrevEnd = Math.max(snapped[prevSameIdx].start + 0.35, refinedStart - 0.02);
      snapped[prevSameIdx] = {
        ...snapped[prevSameIdx],
        end: Number(trimmedPrevEnd.toFixed(2)),
      };
      refinedStart = Math.max(refinedStart, snapped[prevSameIdx].end + 0.02);
    }

    const startShift = refinedStart - line.start;
    const hardMaxEnd =
      nextSameIdx >= 0 ? Math.max(refinedStart + 0.35, nextStart - 0.02) : safeDuration;
    const maxEnd = Math.min(safeDuration, hardMaxEnd, line.end + (preserveAiAnchors ? 0.35 : 0.85));
    // Never pull AI-anchored line endings earlier than line.end so final syllables and vowels never vanish mid-word.
    const defaultMinEnd = preserveAiAnchors
      ? Math.min(maxEnd, Math.max(refinedStart + 0.35, line.end))
      : Math.min(
          maxEnd,
          Math.max(refinedStart + 0.35, line.end - (startShift < -0.1 ? 0.45 : 0.22))
        );
    let refinedEnd = preserveAiAnchors
      ? defaultMinEnd
      : Math.max(defaultMinEnd, Math.min(maxEnd, line.end + Math.min(0, startShift * 0.25)));

    if (maxEnd > refinedStart + 0.5 && dynamicRange >= 0.04) {
      const tokenCount = Math.max(1, line.text.trim().split(/\s+/).filter(Boolean).length);
      const minVocalEnd = preserveAiAnchors
        ? defaultMinEnd
        : Math.min(maxEnd, refinedStart + Math.max(0.55, tokenCount * 0.18));
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
        // Gentle release threshold (4.5% above floor) so soft ending consonants/vowels
        // keep the lyric visible through complete pronunciation decay.
        const dropThresh = localMin + (localMax - localMin) * 0.045;
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
            !preserveAiAnchors && quietTailSec >= 1.6 && localMax - localMin >= 0.15;
          const activeMinEnd = preserveAiAnchors
            ? defaultMinEnd
            : isSustainedInstrumentalGap
              ? minVocalEnd
              : Math.max(defaultMinEnd, Math.min(maxEnd, line.end - 0.08));
          refinedEnd = Math.max(
            activeMinEnd,
            Math.min(maxEnd, lastActiveFrame * frameDurationSec + (preserveAiAnchors ? 0.14 : 0.22))
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
          w.end > w.start + 0.015 &&
          (idx === 0 || w.start >= origWords[idx - 1].start + 0.01)
      );

    if (validMonotonicWords && orig) {
      const coveredSpan = origWords[origWords.length - 1].end - origWords[0].start;
      if (coveredSpan < origSpan * 0.28) {
        validMonotonicWords = false;
      }
    }

    if (validMonotonicWords && orig) {
      const scale = (line.end - line.start) / origSpan;
      const minW = Math.min(0.03, ((line.end - line.start) / tokens.length) * 0.5);
      const mappedWords: WordTiming[] = [];
      for (let idx = 0; idx < origWords.length; idx++) {
        const w = origWords[idx];
        const relS = (w.start - orig.start) * scale;
        const relE = (w.end - orig.start) * scale;
        const prevStartFloor = idx > 0 ? mappedWords[idx - 1].start + minW : line.start;
        const maxStart = line.end - (origWords.length - idx) * minW;
        const wStart = Number(
          Math.max(line.start, prevStartFloor, Math.min(maxStart, line.start + relS)).toFixed(3)
        );
        const rawWEnd = Math.max(wStart + minW, Math.min(line.end, line.start + relE));
        const wEnd = Number(
          (idx === origWords.length - 1 ? Math.max(rawWEnd, line.end) : rawWEnd).toFixed(3)
        );
        mappedWords.push({
          ...w,
          id: w.id || `${line.id}_w${idx}`,
          text: tokens[idx],
          start: wStart,
          end: wEnd,
        });
      }
      return { ...line, words: mappedWords };
    }

    const snappedWords = snapWordTimingsToOnsets(
      line.text,
      line.start,
      line.end,
      onsets,
      line.id,
      envelope,
      frameDurationSec
    ).map((w, idx) => {
      const prev = origWords[idx];
      if (
        prev &&
        prev.text.toLowerCase() === w.text.toLowerCase() &&
        (prev.confidence !== undefined || prev.uncertain)
      ) {
        return {
          ...w,
          ...(prev.confidence !== undefined ? { confidence: prev.confidence } : {}),
          ...(prev.uncertain ? { uncertain: true } : {}),
        };
      }
      return w;
    });

    return {
      ...line,
      words: snappedWords,
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
      words = snapWordTimingsToOnsets(
        line.text,
        start,
        end,
        onsets,
        line.id,
        analysis?.envelope,
        analysis?.frameDurationSec
      );
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

  // Interpolate any unmatched gap spans between matched anchors using detected vocal phrases when available
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
        i < preliminary.length
          ? Math.max(anchorStart + 0.4 * (gapEndIdx - gapStartIdx + 1), preliminary[i].start - 0.04)
          : safeDuration;
      const span = Math.max(0.4 * (gapEndIdx - gapStartIdx + 1), anchorEnd - anchorStart);

      const gapSlice = preliminary.slice(gapStartIdx, gapEndIdx + 1).map(({ _matched: _, ...rest }) => rest);
      const alignedGap = alignLinesToWindow(gapSlice, anchorStart, anchorStart + span, analysis);

      for (let g = gapStartIdx; g <= gapEndIdx; g++) {
        const mapped = alignedGap[g - gapStartIdx];
        preliminary[g].start = mapped.start;
        preliminary[g].end = mapped.end;
        preliminary[g].confidence = 0.62;
        preliminary[g].words = mapped.words;
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
      `Vocal alignment matched ${matched} of ${lines.length} lines; remaining lines aligned to detected phrases.`
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

/**
 * Aligns a sequence of lyric lines strictly inside [windowStart, windowEnd] using
 * detected vocal phrases and spectral-flux onsets inside that window when available.
 */
export function alignLinesToWindow(
  rawLines: LyricLine[],
  windowStart: number,
  windowEnd: number,
  analysis?: AudioAnalysisResult | null
): LyricLine[] {
  if (rawLines.length === 0) return [];
  const startBound = Math.max(0, Number.isFinite(windowStart) ? windowStart : 0);
  const endBound = Math.max(startBound + 0.4 * rawLines.length, Number.isFinite(windowEnd) ? windowEnd : startBound + 30);
  const span = Math.max(0.4 * rawLines.length, endBound - startBound);

  if (analysis && analysis.phrases.length > 0 && analysis.frameDurationSec > 0) {
    const subPhrases = analysis.phrases
      .map((p) => ({
        start: Math.max(startBound, p.start) - startBound,
        end: Math.min(endBound, p.end) - startBound,
        energy: p.energy,
      }))
      .filter((p) => p.end - p.start >= 0.35);

    const subPhraseTime = subPhrases.reduce((s, p) => s + (p.end - p.start), 0);
    if (subPhrases.length > 0 && subPhraseTime >= Math.max(0.8, rawLines.length * 0.45)) {
      const fStart = Math.max(0, Math.floor(startBound / analysis.frameDurationSec));
      const fEnd = Math.min(analysis.envelope.length, Math.ceil(endBound / analysis.frameDurationSec));
      const localEnv = fEnd > fStart ? analysis.envelope.slice(fStart, fEnd) : [];
      const localOnsets = analysis.onsets
        .filter((o) => o >= startBound && o <= endBound)
        .map((o) => Number((o - startBound).toFixed(3)));

      const localAnalysis: AudioAnalysisResult = {
        envelope: localEnv,
        onsets: localOnsets,
        waveformPeaks: [],
        frameDurationSec: analysis.frameDurationSec,
        totalDuration: span,
        phrases: subPhrases,
        dynamicRange: analysis.dynamicRange,
      };

      const alignedLocal = alignLyricsToAudio(rawLines, localAnalysis).lines;
      const shifted = alignedLocal.map((l) => {
        const s = Number(Math.max(startBound, Math.min(endBound - 0.35, l.start + startBound)).toFixed(2));
        const e = Number(Math.max(s + 0.35, Math.min(endBound, l.end + startBound)).toFixed(2));
        return {
          ...l,
          start: s,
          end: e,
          words: snapWordTimingsToOnsets(
            l.text,
            s,
            e,
            analysis.onsets,
            l.id,
            analysis.envelope,
            analysis.frameDurationSec
          ),
        };
      });
      return resolveLineOverlaps(shifted, endBound);
    }
  }

  // Fallback: syllable-weighted distribution within [startBound, endBound]
  const localOnsets = (analysis?.onsets ?? [])
    .filter((o) => o >= startBound && o <= endBound)
    .map((o) => Number((o - startBound).toFixed(3)));
  const distLocal = distributeLyricsProportionally(rawLines, span, localOnsets).lines;
  const shifted = distLocal.map((l) => {
    const s = Number(Math.max(startBound, Math.min(endBound - 0.35, l.start + startBound)).toFixed(2));
    const e = Number(Math.max(s + 0.35, Math.min(endBound, l.end + startBound)).toFixed(2));
    return {
      ...l,
      start: s,
      end: e,
      words: snapWordTimingsToOnsets(
        l.text,
        s,
        e,
        analysis?.onsets ?? [],
        l.id,
        analysis?.envelope,
        analysis?.frameDurationSec
      ),
    };
  });
  return resolveLineOverlaps(shifted, endBound);
}

/**
 * Fills remaining uncovered tail time of a long song (e.g., 2-9 min worship vamps/choruses)
 * by mapping chorus/bridge cues directly onto detected vocal phrases in the tail of the track.
 */
export function fillRemainingSongCuesWithAnalysis(
  existingLines: LyricLine[],
  totalDuration: number,
  analysis?: AudioAnalysisResult | null
): LyricLine[] {
  if (existingLines.length === 0) return [];
  const safeDur =
    Number.isFinite(totalDuration) && totalDuration > 1
      ? totalDuration
      : analysis?.totalDuration && analysis.totalDuration > 1
        ? analysis.totalDuration
        : existingLines[existingLines.length - 1].end;

  const lastExistingEnd = existingLines[existingLines.length - 1].end;
  if (lastExistingEnd >= safeDur - 8) {
    return resolveLineOverlaps(existingLines, safeDur);
  }

  const chorusOrBridge = existingLines.filter(
    (l) => l.section === 'chorus' || l.section === 'bridge'
  );
  const templatePool = chorusOrBridge.length > 0 ? chorusOrBridge : existingLines;
  const tailStart = Math.min(safeDur - 4, lastExistingEnd + 0.8);
  const tailEnd = Math.max(tailStart + 4, safeDur - 0.5);
  const stamp = Date.now();

  const tailPhrases = (analysis?.phrases ?? [])
    .map((p) => ({
      start: Math.max(tailStart, p.start),
      end: Math.min(tailEnd, p.end),
      energy: p.energy,
    }))
    .filter((p) => p.end - p.start >= 0.45);

  const appended: LyricLine[] = [];

  if (tailPhrases.length >= 2 && analysis) {
    // Subdivide long continuous vamps/chorus swells (> 6.5s) into natural cue blocks
    const cueWindows: Array<{ start: number; end: number }> = [];
    for (const ph of tailPhrases) {
      const dur = ph.end - ph.start;
      if (dur <= 6.5) {
        cueWindows.push({ start: ph.start, end: ph.end });
      } else {
        const subCount = Math.max(2, Math.round(dur / 4.2));
        const subDur = dur / subCount;
        for (let k = 0; k < subCount; k++) {
          cueWindows.push({
            start: ph.start + k * subDur,
            end: ph.start + (k + 1) * subDur - (k < subCount - 1 ? 0.06 : 0),
          });
        }
      }
    }

    cueWindows.forEach((win, idx) => {
      const template = templatePool[idx % templatePool.length];
      const id = `line_loop_${stamp}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      const s = Number(Math.max(tailStart, Math.min(tailEnd - 0.4, win.start)).toFixed(2));
      const e = Number(Math.max(s + 0.4, Math.min(tailEnd, win.end)).toFixed(2));
      appended.push({
        id,
        text: template.text,
        section: template.section,
        ...(template.vocalRole ? { vocalRole: template.vocalRole } : {}),
        start: s,
        end: e,
        effect: template.effect,
        effectOverride: false,
        words: snapWordTimingsToOnsets(
          template.text,
          s,
          e,
          analysis.onsets,
          id,
          analysis.envelope,
          analysis.frameDurationSec
        ),
      });
    });

    const refinedTail = refineSegmentsWithAcousticAnalysis(appended, analysis, safeDur);
    return resolveLineOverlaps([...existingLines, ...refinedTail], safeDur);
  }

  // Fallback without phrase detections: natural paced cues starting right after lastExistingEnd
  let cursor = tailStart;
  let templateIdx = 0;
  while (cursor < tailEnd - 2) {
    const template = templatePool[templateIdx % templatePool.length];
    const templateDur = Math.max(2.4, Math.min(5.5, template.end - template.start));
    const start = Number(cursor.toFixed(2));
    const end = Number(Math.min(tailEnd, start + templateDur).toFixed(2));
    const id = `line_loop_${stamp}_${templateIdx}_${Math.random().toString(36).slice(2, 6)}`;
    appended.push({
      id,
      text: template.text,
      section: template.section,
      ...(template.vocalRole ? { vocalRole: template.vocalRole } : {}),
      start,
      end: Math.max(start + 0.4, end),
      effect: template.effect,
      effectOverride: false,
      words: snapWordTimingsToOnsets(
        template.text,
        start,
        Math.max(start + 0.4, end),
        analysis?.onsets ?? [],
        id,
        analysis?.envelope,
        analysis?.frameDurationSec
      ),
    });
    cursor = end + 1.2;
    templateIdx++;
  }

  return resolveLineOverlaps([...existingLines, ...appended], safeDur);
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

export function generateDemoAudioWavBlob(durationSec = 30, sampleRate = 44100): Blob {
  const numSamples = Math.floor(durationSec * sampleRate);
  const floatData = new Float32Array(numSamples);
  const bpm = 120;
  const beatInterval = sampleRate * (60 / bpm);
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const beatPhase = (i % beatInterval) / beatInterval;
    const kick = Math.sin(t * 2 * Math.PI * 80) * Math.exp(-beatPhase * 8) * (i % (beatInterval * 2) < beatInterval ? 0.8 : 0.4);
    const chordFreq = Math.floor(t / 4) % 2 === 0 ? 220 : 261.63;
    const synth = Math.sin(t * 2 * Math.PI * chordFreq) * 0.15 + Math.sin(t * 2 * Math.PI * chordFreq * 1.5) * 0.1;
    const env = Math.min(1, t / 0.5) * Math.min(1, (durationSec - t) / 0.5);
    floatData[i] = (kick + synth) * env;
  }
  return encodeFloat32ToWavBlob(floatData, sampleRate);
}


