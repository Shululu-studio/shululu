import { BACKGROUND_TEMPLATES, DEFAULT_VOCAL_LAYERS } from '../data/presets';
import {
  AspectRatio,
  LyricLine,
  ProjectData,
  TypographyStyle,
  VocalLayersConfig,
  VocalRole,
} from '../types/editor';
import { renderWatermark } from './watermark';

export function getResolutionForAspect(
  aspectRatio: AspectRatio,
  heightPreset: 720 | 1080 = 1080
): { width: number; height: number } {
  if (aspectRatio === '16:9') {
    return heightPreset === 720
      ? { width: 1280, height: 720 }
      : { width: 1920, height: 1080 };
  }
  if (aspectRatio === '9:16') {
    return heightPreset === 720
      ? { width: 720, height: 1280 }
      : { width: 1080, height: 1920 };
  }
  return heightPreset === 720
    ? { width: 720, height: 720 }
    : { width: 1080, height: 1080 };
}

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

export function easeInOutSine(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return -(Math.cos(Math.PI * c) - 1) / 2;
}

export function easeLinear(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function easeElastic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  if (c === 0 || c === 1) return c;
  return -Math.pow(2, 10 * (c - 1)) * Math.sin((c - 1.1) * 5 * Math.PI);
}

export function resolveEasing(easingName?: string): (t: number) => number {
  switch (easingName) {
    case 'linear': return easeLinear;
    case 'easeInOutSine': return easeInOutSine;
    case 'elastic': return easeElastic;
    case 'easeOutCubic':
    default:
      return easeOutCubic;
  }
}

export interface ActiveLyricSample {
  line: LyricLine;
  progress: number; // 0..1 across line duration
  alpha: number; // 0..1 envelope opacity
  offsetY: number; // normalized px offset
  offsetX?: number; // horizontal slide offset
  scale: number;
  letterSpacingDelta: number;
}

export function resolveVocalLayers(vocalLayers?: VocalLayersConfig): VocalLayersConfig {
  return {
    leadVisible: vocalLayers?.leadVisible ?? DEFAULT_VOCAL_LAYERS.leadVisible,
    backing: {
      visible: vocalLayers?.backing?.visible ?? DEFAULT_VOCAL_LAYERS.backing.visible,
      color: vocalLayers?.backing?.color ?? DEFAULT_VOCAL_LAYERS.backing.color,
      fontScale: vocalLayers?.backing?.fontScale ?? DEFAULT_VOCAL_LAYERS.backing.fontScale,
      positionX: vocalLayers?.backing?.positionX ?? DEFAULT_VOCAL_LAYERS.backing.positionX,
      positionY: vocalLayers?.backing?.positionY ?? DEFAULT_VOCAL_LAYERS.backing.positionY,
    },
    choirVisible: vocalLayers?.choirVisible ?? DEFAULT_VOCAL_LAYERS.choirVisible,
    choirColor: vocalLayers?.choirColor ?? DEFAULT_VOCAL_LAYERS.choirColor,
    adlibVisible: vocalLayers?.adlibVisible ?? DEFAULT_VOCAL_LAYERS.adlibVisible,
    adlibColor: vocalLayers?.adlibColor ?? DEFAULT_VOCAL_LAYERS.adlibColor,
  };
}

export function stripDisplayBrackets(text: string): string {
  let working = (text || '').trim();
  if (!working) return '';
  if (/^\[\s*instrumental\s*\]$/i.test(working)) {
    return '[instrumental]';
  }
  working = working.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!working) return '';

  // Unwrap whole-line outer parentheses "(Jireh)" -> "Jireh"
  while (working.startsWith('(') && working.endsWith(')') && working.length >= 2) {
    let depth = 0;
    let closesAtEnd = true;
    for (let i = 0; i < working.length; i++) {
      if (working[i] === '(') depth++;
      else if (working[i] === ')') depth--;
      if (depth === 0 && i < working.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd || depth !== 0) break;
    working = working.slice(1, -1).trim();
  }

  // Remove any inline parenthesized backing vocals e.g. "Your Jireh (Jireh)" -> "Your Jireh"
  if (working.includes('(') && working.includes(')')) {
    const stripped = working.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (stripped.length > 0) {
      working = stripped.replace(/\s+([,.;!?])/g, '$1').trim();
    }
  }

  return working;
}

export function normalizeLyricComparisonText(text: string): string {
  return stripDisplayBrackets(text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMPLEX_SHAPED_SCRIPT_RE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u0DF7\u0E00-\u0FFF]/;
const RTL_SCRIPT_RE = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;

function isComplexShapedScript(text: string): boolean {
  return COMPLEX_SHAPED_SCRIPT_RE.test(text);
}

function hasRtlScript(text: string): boolean {
  return RTL_SCRIPT_RE.test(text);
}

export function isVocalRoleVisible(role: VocalRole, vocalLayers?: VocalLayersConfig): boolean {
  const layers = resolveVocalLayers(vocalLayers);
  if (role === 'backing') return layers.backing.visible;
  if (role === 'choir') return layers.choirVisible;
  if (role === 'adlib') return layers.adlibVisible;
  return layers.leadVisible;
}

/**
 * Filters active vocal samples by per-layer visibility, suppresses redundant duplicate
 * unison lines (e.g. when Lead and Backing/Choir sing identical words simultaneously),
 * and caps simultaneous visible layers to 2 to enforce a clean max-2-line preview.
 */
export function filterAndDeduplicateActiveSamples(
  samples: ActiveLyricSample[],
  vocalLayers?: VocalLayersConfig
): ActiveLyricSample[] {
  const rolePriority: Record<VocalRole, number> = {
    lead: 0,
    choir: 1,
    backing: 2,
    adlib: 3,
  };

  const rawVisible = samples.filter((sample) =>
    isVocalRoleVisible(sample.line.vocalRole ?? 'lead', vocalLayers)
  );
  const wordCountOf = (sample: ActiveLyricSample) =>
    stripDisplayBrackets(sample.line.text).split(/\s+/).filter(Boolean).length;

  const visibleSamples = rawVisible
    .filter((sample) => {
      const role: VocalRole = sample.line.vocalRole ?? 'lead';
      if (role !== 'lead' && role !== 'adlib') return true;
      const wc = wordCountOf(sample);
      if (wc === 0 || wc > 2) return true;

      const dur = Math.max(0.05, sample.line.end - sample.line.start);
      const suppressedByHost = rawVisible.some((other) => {
        if (other === sample) return false;
        const otherRole: VocalRole = other.line.vocalRole ?? 'lead';
        const otherWc = wordCountOf(other);
        const otherDur = Math.max(0.05, other.line.end - other.line.start);
        if (otherRole === 'backing' || otherRole === 'choir') {
          return (
            otherWc >= 3 ||
            otherWc > wc ||
            (other.line.start <= sample.line.start - 0.12 && otherDur >= dur * 1.15)
          );
        }
        if (role === 'adlib' && otherRole === 'lead') {
          return (
            otherWc >= 3 ||
            (otherWc >= 2 && (otherWc > wc || other.line.start <= sample.line.start))
          );
        }
        return false;
      });
      return !suppressedByHost;
    })
    .sort(
      (a, b) =>
        (rolePriority[a.line.vocalRole ?? 'lead'] ?? 4) -
          (rolePriority[b.line.vocalRole ?? 'lead'] ?? 4) || a.line.start - b.line.start
    );

  const seenNormalized = new Set<string>();
  const kept: ActiveLyricSample[] = [];
  const MAX_SIMULTANEOUS_LAYERS = 2;

  for (const sample of visibleSamples) {
    const norm = normalizeLyricComparisonText(sample.line.text);
    if (norm && seenNormalized.has(norm)) {
      continue;
    }
    if (norm) seenNormalized.add(norm);
    kept.push(sample);
    if (kept.length >= MAX_SIMULTANEOUS_LAYERS) break;
  }

  return kept;
}

export function getActiveLyricsAtTime(
  lyrics: LyricLine[],
  currentTime: number,
  vocalLayers?: VocalLayersConfig
): ActiveLyricSample[] {
  const results: ActiveLyricSample[] = [];

  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    const lineRole: VocalRole = line.vocalRole ?? 'lead';
    if (vocalLayers && !isVocalRoleVisible(lineRole, vocalLayers)) {
      continue;
    }

    // Only sequential cues in the SAME vocal layer clamp effectiveEnd / effectiveStart;
    // simultaneous backing/choir/adlib vocals never cut off an overlapping lead vocal early.
    let nextSameLayer: LyricLine | null = null;
    let prevSameLayer: LyricLine | null = null;
    for (let j = 0; j < lyrics.length; j++) {
      if (j === i) continue;
      const cand = lyrics[j];
      const candRole: VocalRole = cand.vocalRole ?? 'lead';
      if (candRole !== lineRole) continue;
      if (cand.start >= line.start && (cand.start >= line.end - 0.08 || cand.start > line.start)) {
        if (!nextSameLayer || cand.start < nextSameLayer.start) {
          nextSameLayer = cand;
        }
      }
      if (cand.start < line.start) {
        if (!prevSameLayer || cand.start > prevSameLayer.start) {
          prevSameLayer = cand;
        }
      }
    }

    const entranceDur = line.entranceDuration ?? 0.32;
    // Keep lyrics at full opacity throughout the singer's complete word pronunciation;
    // perform the gentle fade-out in the post-word release hold whenever room permits.
    const exitDuration = Math.min(0.11, line.exitDuration ?? 0.1);
    const delayBefore = line.delayBefore ?? 0.0;
    const easingFn = resolveEasing(line.easing);

    const prevReleaseHang = prevSameLayer
      ? Math.min(0.18, Math.max(0, line.start - prevSameLayer.end - 0.005))
      : 0;
    const prevEffectiveEnd = prevSameLayer
      ? Math.min(
          prevSameLayer.end + prevReleaseHang,
          Math.max(prevSameLayer.start + 0.1, line.start - 0.002)
        )
      : 0;

    // Never allow a line's pre-roll fade-in to overtake the preceding sentence before its pronunciation release completes.
    const preRollFloor = prevSameLayer ? Math.min(line.start, prevEffectiveEnd + 0.002) : 0;
    const effectiveStart = Math.max(preRollFloor, line.start - delayBefore - entranceDur);

    const releaseHang = nextSameLayer
      ? Math.min(0.18, Math.max(0, nextSameLayer.start - line.end - 0.005))
      : 0.18;
    const effectiveEnd = nextSameLayer
      ? Math.min(line.end + releaseHang, Math.max(line.start + 0.1, nextSameLayer.start - 0.002))
      : line.end + releaseHang;

    if (currentTime < effectiveStart || currentTime > effectiveEnd) {
      continue;
    }

    const duration = Math.max(0.2, line.end - line.start);
    const rawProgress = (currentTime - line.start) / duration;
    const progress = Math.min(1, Math.max(0, rawProgress));

    let alpha = 1;
    let offsetY = 0;
    let offsetX = 0;
    let scale = 1;
    let letterSpacingDelta = 0;

    if (line.effect === 'none') {
      if (currentTime < line.start || currentTime > effectiveEnd) continue;
      alpha = 1;
    } else if (line.effect === 'line-crossfade') {
      const elapsedSinceStart = Math.max(0, currentTime - line.start);
      const inT =
        currentTime < line.start
          ? (currentTime - effectiveStart) / Math.max(0.01, delayBefore + entranceDur)
          : Math.min(1, 0.8 + 0.2 * easingFn(elapsedSinceStart / Math.max(0.05, entranceDur)));
      const outT = (effectiveEnd - currentTime) / Math.max(0.04, exitDuration);
      alpha = Math.min(inT, easingFn(Math.min(1, Math.max(0, outT))));
    } else {
      const elapsedSincePre = currentTime - effectiveStart;
      const remaining = effectiveEnd - currentTime;
      const fadeIn =
        currentTime >= line.start
          ? 1
          : easingFn(Math.min(1, Math.max(0, elapsedSincePre / Math.max(0.01, delayBefore + entranceDur))));
      const fadeOut = remaining < exitDuration ? easingFn(Math.max(0, remaining) / Math.max(0.01, exitDuration)) : 1;
      alpha = Math.min(fadeIn, fadeOut);

      if (line.effect === 'slide-up') {
        const slideWindow = entranceDur + delayBefore;
        const slideT = elapsedSincePre < slideWindow ? easingFn(elapsedSincePre / Math.max(0.01, slideWindow)) : 1;
        offsetY = (1 - slideT) * 16;
      } else if (line.effect === 'horizontal-slide') {
        const slideWindow = entranceDur + delayBefore;
        const slideT = elapsedSincePre < slideWindow ? easingFn(elapsedSincePre / Math.max(0.01, slideWindow)) : 1;
        offsetX = (1 - slideT) * -40;
      } else if (line.effect === 'gentle-zoom') {
        scale = 0.96 + progress * 0.08;
      } else if (
        line.effect === 'cinematic' ||
        line.effect === 'neon-glow' ||
        line.effect === 'shimmer-gold' ||
        line.effect === 'elastic-pop' ||
        line.effect === 'retro-pixel'
      ) {
        const cinWindow = entranceDur + delayBefore;
        const cinT = elapsedSincePre < cinWindow ? easingFn(elapsedSincePre / Math.max(0.01, cinWindow)) : 1;
        letterSpacingDelta = (1 - cinT) * 4;
        scale = 1.02 - cinT * 0.02;
      } else if (line.effect === 'subtle-drift') {
        offsetY = Math.sin(progress * Math.PI) * -12;
      } else if (line.effect === 'glitch-flash') {
        const glitchT = progress < 0.15 ? Math.sin(progress * 40) * 5 : 0;
        offsetX = glitchT;
        scale = 1 + (progress < 0.15 ? 0.06 : 0);
      } else if (line.effect === 'radial-burst') {
        const burstWindow = entranceDur + delayBefore;
        const burstT = elapsedSincePre < burstWindow ? easingFn(elapsedSincePre / Math.max(0.01, burstWindow)) : 1;
        scale = 0.7 + burstT * 0.3;
      }
    }

    if (alpha > 0.005) {
      results.push({
        line,
        progress,
        alpha,
        offsetY,
        offsetX,
        scale,
        letterSpacingDelta,
      });
    }
  }

  // Keep at most one active line per distinct vocal layer (so touching sequential cues in the same
  // layer never stack), while preserving simultaneous overlapping lead + backing/choir/adlib parts.
  const byLayer = new Map<string, ActiveLyricSample>();
  for (const sample of results) {
    const roleKey = sample.line.vocalRole ?? 'lead';
    const existing = byLayer.get(roleKey);
    if (!existing || sample.line.start > existing.line.start) {
      byLayer.set(roleKey, sample);
    }
  }

  return filterAndDeduplicateActiveSamples(Array.from(byLayer.values()), vocalLayers);
}

export interface WrappedWord {
  text: string;
  start: number;
  end: number;
  width: number;
  wordIndex: number;
}

export interface WrappedLineRow {
  words: WrappedWord[];
  totalWidth: number;
}

function getDisplayWordObjects(line: LyricLine) {
  const cleanLineText = stripDisplayBrackets(line.text);
  const cleanTokens = cleanLineText.split(/\s+/).filter(Boolean);
  if (cleanTokens.length === 0) return [];

  if (line.words.length > 0 && line.words.length === cleanTokens.length) {
    return line.words.map((w, idx) => ({
      ...w,
      text: cleanTokens[idx],
    }));
  }

  return cleanTokens.map((t, idx) => {
    const matched = line.words[idx];
    return {
      id: matched?.id ?? `${line.id}_f${idx}`,
      text: t,
      start: matched?.start ?? line.start,
      end: matched?.end ?? line.end,
    };
  });
}

export function wrapWordsForWidth(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  maxWidth: number,
  letterSpacingPx: number
): WrappedLineRow[] {
  const spaceWidth = ctx.measureText(' ').width + letterSpacingPx;
  const wordObjects = getDisplayWordObjects(line);
  if (wordObjects.length === 0) return [];

  const rows: WrappedLineRow[] = [];
  let currentRow: WrappedWord[] = [];
  let currentWidth = 0;

  wordObjects.forEach((w, idx) => {
    const normalizedText = w.text.normalize('NFC');
    const codePointCount = Array.from(normalizedText).length;
    const effectiveSpacing = isComplexShapedScript(normalizedText) ? 0 : letterSpacingPx;
    const measured =
      ctx.measureText(normalizedText).width + Math.max(0, codePointCount - 1) * effectiveSpacing;
    const needed = currentRow.length === 0 ? measured : spaceWidth + measured;

    if (currentRow.length > 0 && currentWidth + needed > maxWidth) {
      rows.push({ words: currentRow, totalWidth: currentWidth });
      currentRow = [{ text: w.text, start: w.start, end: w.end, width: measured, wordIndex: idx }];
      currentWidth = measured;
    } else {
      currentRow.push({
        text: w.text,
        start: w.start,
        end: w.end,
        width: measured,
        wordIndex: idx,
      });
      currentWidth += needed;
    }
  });

  if (currentRow.length > 0) {
    rows.push({ words: currentRow, totalWidth: currentWidth });
  }

  // Balance 2-row splits visually so a single orphan word isn't pushed onto line 2 unnecessarily
  if (rows.length === 2 && wordObjects.length >= 3) {
    const allWrapped: WrappedWord[] = rows.flatMap((r) => r.words);
    let bestSplit = rows[0].words.length;
    let bestDiff = Math.abs(rows[0].totalWidth - rows[1].totalWidth);

    const widthForSlice = (slice: WrappedWord[]) =>
      slice.reduce((acc, w) => acc + w.width, 0) + Math.max(0, slice.length - 1) * spaceWidth;

    for (let splitIdx = 1; splitIdx < allWrapped.length; splitIdx++) {
      const topSlice = allWrapped.slice(0, splitIdx);
      const botSlice = allWrapped.slice(splitIdx);
      const topW = widthForSlice(topSlice);
      const botW = widthForSlice(botSlice);
      if (topW <= maxWidth && botW <= maxWidth) {
        const diff = Math.abs(topW - botW);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestSplit = splitIdx;
        }
      }
    }

    const topSlice = allWrapped.slice(0, bestSplit);
    const botSlice = allWrapped.slice(bestSplit);
    return [
      { words: topSlice, totalWidth: widthForSlice(topSlice) },
      { words: botSlice, totalWidth: widthForSlice(botSlice) },
    ];
  }

  return rows;
}

export function fitSampleRowsForBudget(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  baseParams: RoleStyleParams,
  fontFamily: string,
  maxWidth: number,
  maxRows: number,
  minScale = 0.52
): { params: RoleStyleParams; rows: WrappedLineRow[] } {
  const safeMaxRows = Math.max(1, Math.floor(maxRows));
  let bestScale = 1;
  let bestRows: WrappedLineRow[] = [];

  const measureAtScale = (scale: number): { params: RoleStyleParams; rows: WrappedLineRow[] } => {
    const fontSize = Math.max(12, baseParams.fontSize * scale);
    const scaledParams: RoleStyleParams = {
      ...baseParams,
      fontSize,
      lineHeight: baseParams.lineHeight * scale,
      letterSpacing: baseParams.letterSpacing * scale,
      strokeWidth: baseParams.strokeWidth * scale,
    };
    ctx.save();
    ctx.font = `${scaledParams.fontStylePrefix}${scaledParams.fontWeight} ${scaledParams.fontSize}px "${fontFamily}", "Noto Sans", system-ui, -apple-system, sans-serif`;
    const rows = wrapWordsForWidth(ctx, line, maxWidth, scaledParams.letterSpacing);
    ctx.restore();
    return { params: scaledParams, rows };
  };

  const initial = measureAtScale(1);
  if (initial.rows.length <= safeMaxRows) {
    return initial;
  }

  bestScale = minScale;
  bestRows = initial.rows;

  for (let s = 0.94; s >= minScale - 0.001; s -= 0.04) {
    const clampedScale = Math.max(minScale, s);
    const attempt = measureAtScale(clampedScale);
    if (attempt.rows.length <= safeMaxRows) {
      return attempt;
    }
    bestScale = clampedScale;
    bestRows = attempt.rows;
  }

  const finalAttempt = measureAtScale(bestScale);
  const clampedRows = (finalAttempt.rows.length > 0 ? finalAttempt.rows : bestRows).slice(
    0,
    safeMaxRows
  );
  return {
    params: finalAttempt.params,
    rows: clampedRows,
  };
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  strokeWidth: number
) {
  const normalized = text.normalize('NFC');
  if (Math.abs(letterSpacing) < 0.25 || isComplexShapedScript(normalized)) {
    if (strokeWidth > 0) ctx.strokeText(normalized, x, y);
    ctx.fillText(normalized, x, y);
    return;
  }

  let cursor = x;
  for (const ch of Array.from(normalized)) {
    if (strokeWidth > 0) ctx.strokeText(ch, cursor, y);
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + letterSpacing;
  }
}

export interface MediaAssetCache {
  images: Map<string, HTMLImageElement>;
  videos?: Map<string, HTMLVideoElement>;
  videoElement?: HTMLVideoElement | null;
}

function drawCoverMedia(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement,
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  scale: number,
  offsetX: number,
  offsetY: number
) {
  if (srcW <= 0 || srcH <= 0) return;
  const baseScale = Math.max(canvasW / srcW, canvasH / srcH);
  const drawW = srcW * baseScale * scale;
  const drawH = srcH * baseScale * scale;
  const dx = (canvasW - drawW) / 2 + offsetX * canvasW;
  const dy = (canvasH - drawH) / 2 + offsetY * canvasH;
  ctx.drawImage(source, dx, dy, drawW, drawH);
}

export interface InstrumentalDetectionContext {
  duration: number;
  hasAudio: boolean;
  waveformPeaks?: number[];
  minGapSec?: number;
}

export function computeLocalPeakFromWaveform(
  waveformPeaks: number[] | undefined,
  duration: number,
  currentTime: number,
  windowSec = 0.35
): number {
  if (!waveformPeaks || waveformPeaks.length === 0 || duration <= 0) {
    return 1;
  }
  const len = waveformPeaks.length;
  const startRatio = Math.max(0, (currentTime - windowSec) / duration);
  const endRatio = Math.min(1, (currentTime + windowSec) / duration);
  const startIdx = Math.max(0, Math.min(len - 1, Math.floor(startRatio * (len - 1))));
  const endIdx = Math.max(startIdx, Math.min(len - 1, Math.ceil(endRatio * (len - 1))));

  let peak = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const v = waveformPeaks[i] ?? 0;
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  return peak;
}

export function getInstrumentalSampleAtTime(
  _lyrics: LyricLine[],
  _currentTime: number,
  _ctxInfo: InstrumentalDetectionContext
): ActiveLyricSample | null {
  return null;
}

export interface VocalLayoutBoxInput {
  id: string;
  role: VocalRole;
  desiredX: number;
  desiredY: number;
  boxWidth: number;
  boxHeight: number;
  align: TypographyStyle['align'];
}

export interface ResolvedVocalLayoutBox {
  id: string;
  role: VocalRole;
  anchorX: number;
  anchorY: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getHorizontalBounds(
  anchorX: number,
  boxWidth: number,
  align: TypographyStyle['align']
): { left: number; right: number } {
  if (align === 'left') return { left: anchorX, right: anchorX + boxWidth };
  if (align === 'right') return { left: anchorX - boxWidth, right: anchorX };
  return { left: anchorX - boxWidth / 2, right: anchorX + boxWidth / 2 };
}

/**
 * Resolves non-overlapping vertical positions for simultaneous vocal layers using
 * measured multi-line bounding boxes and canvas safe margins (keeping clear of the watermark).
 */
export function resolveVocalLayerLayout(
  items: VocalLayoutBoxInput[],
  canvasWidth: number,
  canvasHeight: number,
  watermarkEnabled = true
): ResolvedVocalLayoutBox[] {
  if (items.length === 0) return [];

  const safeTop = Math.max(20, canvasHeight * 0.08);
  const safeBottom = watermarkEnabled ? canvasHeight * 0.84 : canvasHeight * 0.92;
  const minGap = Math.max(12, canvasHeight * 0.022);
  const hPad = Math.max(14, canvasWidth * 0.012);

  const placed: ResolvedVocalLayoutBox[] = [];

  for (const item of items) {
    const halfH = item.boxHeight / 2;
    const minCenterY = Math.min(safeBottom - halfH, safeTop + halfH);
    const maxCenterY = Math.max(minCenterY, safeBottom - halfH);
    const clampY = (y: number) => Math.max(minCenterY, Math.min(maxCenterY, y));

    const { left, right } = getHorizontalBounds(item.desiredX, item.boxWidth, item.align);
    const collidingPlaced = placed.filter(
      (p) => !(right + hPad <= p.left || left - hPad >= p.right)
    );

    const hasCollisionAt = (centerY: number, gap: number): boolean => {
      const top = centerY - halfH;
      const bottom = centerY + halfH;
      return collidingPlaced.some(
        (p) => !(bottom + gap <= p.top || top - gap >= p.bottom)
      );
    };

    const baseDesiredY = clampY(item.desiredY);
    let chosenY = baseDesiredY;

    if (collidingPlaced.length > 0 && hasCollisionAt(baseDesiredY, minGap)) {
      const candidates: number[] = [];
      for (const p of collidingPlaced) {
        candidates.push(p.bottom + minGap + halfH);
        candidates.push(p.top - minGap - halfH);
      }

      const validCandidates = candidates
        .filter((cy) => cy >= minCenterY - 2 && cy <= maxCenterY + 2)
        .map((cy) => clampY(cy))
        .filter((cy) => !hasCollisionAt(cy, minGap));

      if (validCandidates.length > 0) {
        const preferAbove = item.role === 'adlib';
        validCandidates.sort((a, b) => {
          const distA = Math.abs(a - item.desiredY);
          const distB = Math.abs(b - item.desiredY);
          if (Math.abs(distA - distB) <= 6) {
            return preferAbove ? a - b : b - a;
          }
          return distA - distB;
        });
        chosenY = validCandidates[0];
      } else {
        // Fallback with tight breathing gap when lines are unusually tall
        const tightGap = Math.max(6, minGap * 0.5);
        const tightValid = candidates
          .map((cy) => clampY(cy))
          .filter((cy) => !hasCollisionAt(cy, tightGap));
        if (tightValid.length > 0) {
          tightValid.sort((a, b) => Math.abs(a - item.desiredY) - Math.abs(b - item.desiredY));
          chosenY = tightValid[0];
        } else {
          // Avoid overlapping any higher-priority box if space is completely exhausted
          continue;
        }
      }
    }

    placed.push({
      id: item.id,
      role: item.role,
      anchorX: item.desiredX,
      anchorY: chosenY,
      left,
      right,
      top: chosenY - halfH,
      bottom: chosenY + halfH,
    });
  }

  return placed;
}

interface RoleStyleParams {
  role: VocalRole;
  fontSize: number;
  fontWeight: number;
  fontStylePrefix: string;
  letterSpacing: number;
  strokeWidth: number;
  lineHeight: number;
  color: string;
  highlightColor: string;
  roleAlpha: number;
  desiredAnchorX: number;
  desiredAnchorY: number;
  ensureContrastShadow: boolean;
}

function buildRoleStyleParams(
  sample: ActiveLyricSample,
  style: TypographyStyle,
  layers: VocalLayersConfig,
  width: number,
  height: number,
  scaleFactor: number,
  isSimultaneous: boolean
): RoleStyleParams {
  const role: VocalRole = sample.line.vocalRole ?? 'lead';
  const baseFontSize = Math.max(14, style.fontSize * scaleFactor);

  if (role === 'backing') {
    const backingScale = Math.max(0.48, Math.min(0.95, layers.backing.fontScale));
    const fontSize = Math.max(13, baseFontSize * backingScale);
    const fontWeight = style.fontWeight >= 600 ? 500 : style.fontWeight;
    return {
      role,
      fontSize,
      fontWeight,
      fontStylePrefix: 'italic ',
      letterSpacing: (style.letterSpacing + 0.6 + sample.letterSpacingDelta) * scaleFactor,
      strokeWidth: style.outlineWidth * scaleFactor * 2 * 0.85,
      lineHeight: fontSize * style.lineSpacing,
      color: layers.backing.color || '#CBD5E1',
      highlightColor: layers.backing.color || '#CBD5E1',
      roleAlpha: 0.92,
      desiredAnchorX: layers.backing.positionX * width + (sample.offsetX ?? 0) * scaleFactor,
      desiredAnchorY: layers.backing.positionY * height + sample.offsetY * scaleFactor,
      ensureContrastShadow: true,
    };
  }

  if (role === 'choir') {
    const choirScale = isSimultaneous ? 0.82 : 0.9;
    const fontSize = Math.max(14, baseFontSize * choirScale);
    const leadHalfGuess = baseFontSize * style.lineSpacing * 0.5;
    const choirHalfGuess = fontSize * style.lineSpacing * 0.5;
    const defaultOffset = isSimultaneous
      ? (style.positionY > 0.66 ? -1 : 1) * (leadHalfGuess + choirHalfGuess + Math.max(16, height * 0.025))
      : 0;
    return {
      role,
      fontSize,
      fontWeight: style.fontWeight,
      fontStylePrefix: '',
      letterSpacing: (style.letterSpacing + 1.1 + sample.letterSpacingDelta) * scaleFactor,
      strokeWidth: style.outlineWidth * scaleFactor * 2 * 0.9,
      lineHeight: fontSize * style.lineSpacing,
      color: layers.choirColor || '#E2E8F0',
      highlightColor: layers.choirColor || '#E2E8F0',
      roleAlpha: 0.94,
      desiredAnchorX: style.positionX * width + (sample.offsetX ?? 0) * scaleFactor,
      desiredAnchorY: style.positionY * height + defaultOffset + sample.offsetY * scaleFactor,
      ensureContrastShadow: true,
    };
  }

  if (role === 'adlib') {
    const adlibScale = isSimultaneous ? 0.66 : 0.78;
    const fontSize = Math.max(13, baseFontSize * adlibScale);
    const leadHalfGuess = baseFontSize * style.lineSpacing * 0.5;
    const adlibHalfGuess = fontSize * style.lineSpacing * 0.5;
    const defaultOffset = isSimultaneous
      ? (style.positionY < 0.28 ? 1 : -1) * (leadHalfGuess + adlibHalfGuess + Math.max(14, height * 0.022))
      : 0;
    return {
      role,
      fontSize,
      fontWeight: style.fontWeight >= 600 ? 500 : style.fontWeight,
      fontStylePrefix: 'italic ',
      letterSpacing: (style.letterSpacing + 0.4 + sample.letterSpacingDelta) * scaleFactor,
      strokeWidth: style.outlineWidth * scaleFactor * 2 * 0.8,
      lineHeight: fontSize * style.lineSpacing,
      color: layers.adlibColor || '#E5DEC9',
      highlightColor: layers.adlibColor || '#E5DEC9',
      roleAlpha: 0.88,
      desiredAnchorX: style.positionX * width + (sample.offsetX ?? 0) * scaleFactor,
      desiredAnchorY: style.positionY * height + defaultOffset + sample.offsetY * scaleFactor,
      ensureContrastShadow: true,
    };
  }

  // Lead vocal: main prominent typography
  return {
    role: 'lead',
    fontSize: baseFontSize,
    fontWeight: style.fontWeight,
    fontStylePrefix: '',
    letterSpacing: (style.letterSpacing + sample.letterSpacingDelta) * scaleFactor,
    strokeWidth: style.outlineWidth * scaleFactor * 2,
    lineHeight: baseFontSize * style.lineSpacing,
    color: style.color || '#FFFFFF',
    highlightColor: style.highlightColor || '#F59E0B',
    roleAlpha: 1,
    desiredAnchorX: style.positionX * width + (sample.offsetX ?? 0) * scaleFactor,
    desiredAnchorY: style.positionY * height + sample.offsetY * scaleFactor,
    ensureContrastShadow: false,
  };
}

export interface RenderFrameOptions {
  transparentVideoBg?: boolean;
  hasAudio?: boolean;
  waveformPeaks?: number[];
  watermarkTime?: number;
  reducedMotion?: boolean;
}

export function renderVideoFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  currentTime: number,
  project: ProjectData,
  mediaCache?: MediaAssetCache,
  options?: RenderFrameOptions
): void {
  const { background, typography, lyrics } = project;
  const vocalLayers = resolveVocalLayers(project.vocalLayers);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const isVideoBackdrop = background.type === 'template' || background.type === 'video';
  if (options?.transparentVideoBg && isVideoBackdrop) {
    // Hardware-composited <video> sits directly beneath this transparent lyrics canvas
    ctx.clearRect(0, 0, width, height);
  } else {
    // 1. Background fill
    ctx.fillStyle = background.solidColor || '#111214';
    ctx.fillRect(0, 0, width, height);

    if (background.blur > 0) {
      ctx.filter = `blur(${(background.blur * height) / 1080}px)`;
    }

    if (background.type === 'gradient') {
      const angleRad = ((background.gradientAngle - 90) * Math.PI) / 180;
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.hypot(width, height) / 2;
      const grad = ctx.createLinearGradient(
        cx - Math.cos(angleRad) * r,
        cy - Math.sin(angleRad) * r,
        cx + Math.cos(angleRad) * r,
        cy + Math.sin(angleRad) * r
      );
      grad.addColorStop(0, background.gradientFrom);
      grad.addColorStop(1, background.gradientTo);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    } else if (background.type === 'template') {
      const tpl =
        BACKGROUND_TEMPLATES.find((t) => t.id === background.templateId) ??
        BACKGROUND_TEMPLATES[0];
      const img = mediaCache?.images.get(tpl.imageUrl);
      if (img && img.complete && img.naturalWidth > 0) {
        drawCoverMedia(
          ctx,
          img,
          img.naturalWidth,
          img.naturalHeight,
          width,
          height,
          background.scale,
          background.offsetX,
          background.offsetY
        );
      } else {
        const fallbackGrad = ctx.createLinearGradient(0, 0, 0, height);
        fallbackGrad.addColorStop(0, '#181A1E');
        fallbackGrad.addColorStop(1, '#0B0C0E');
        ctx.fillStyle = fallbackGrad;
        ctx.fillRect(0, 0, width, height);
      }
    } else if (background.type === 'image' && background.mediaUrl) {
      const img = mediaCache?.images.get(background.mediaUrl);
      if (img && img.complete && img.naturalWidth > 0) {
        drawCoverMedia(
          ctx,
          img,
          img.naturalWidth,
          img.naturalHeight,
          width,
          height,
          background.scale,
          background.offsetX,
          background.offsetY
        );
      }
    } else if (background.type === 'video' && mediaCache?.videoElement) {
      const vid = mediaCache.videoElement;
      if (vid.readyState >= 2 && vid.videoWidth > 0) {
        drawCoverMedia(
          ctx,
          vid,
          vid.videoWidth,
          vid.videoHeight,
          width,
          height,
          background.scale,
          background.offsetX,
          background.offsetY
        );
      }
    }

    ctx.filter = 'none';
  }

  // Contrast scrim overlay
  if (background.dimOverlay > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.88, Math.max(0, background.dimOverlay))})`;
    ctx.fillRect(0, 0, width, height);
  }

  // 2. Measure active vocal layers and enforce strict max-2-line frame budget
  const samplesToRender = getActiveLyricsAtTime(lyrics, currentTime, vocalLayers);
  const scaleFactor = height / 1080;
  const isSimultaneous = samplesToRender.length > 1;
  const maxTextWidth = width * 0.86;
  const watermarkEnabled = project.watermark?.enabled ?? true;
  const MAX_PREVIEW_LINES = 2;

  type PreparedSample = {
    sample: ActiveLyricSample;
    params: RoleStyleParams;
    rows: WrappedLineRow[];
    blockHeight: number;
    maxRowWidth: number;
    totalBoxWidth: number;
    totalBoxHeight: number;
  };

  const buildPreparedEntry = (
    sample: ActiveLyricSample,
    params: RoleStyleParams,
    rows: WrappedLineRow[]
  ): PreparedSample | null => {
    if (rows.length === 0) return null;
    const blockHeight = rows.length * params.lineHeight;
    const maxRowWidth = rows.reduce((m, r) => Math.max(m, r.totalWidth), 0);
    const padX = typography.backgroundOpacity > 0 ? typography.backgroundPadding * scaleFactor * 1.4 : 0;
    const padY = typography.backgroundOpacity > 0 ? typography.backgroundPadding * scaleFactor * 0.85 : 0;
    return {
      sample,
      params,
      rows,
      blockHeight,
      maxRowWidth,
      totalBoxWidth: maxRowWidth + padX * 2,
      totalBoxHeight: blockHeight + padY * 2,
    };
  };

  const preparedSamples: PreparedSample[] = [];
  let remainingLineBudget = MAX_PREVIEW_LINES;

  if (samplesToRender.length === 1) {
    const sample = samplesToRender[0];
    const baseParams = buildRoleStyleParams(
      sample,
      typography,
      vocalLayers,
      width,
      height,
      scaleFactor,
      false
    );
    const fitted = fitSampleRowsForBudget(
      ctx,
      sample.line,
      baseParams,
      typography.fontFamily,
      maxTextWidth,
      MAX_PREVIEW_LINES,
      0.52
    );
    const entry = buildPreparedEntry(sample, fitted.params, fitted.rows);
    if (entry) preparedSamples.push(entry);
  } else if (samplesToRender.length >= 2) {
    // Primary layer: try fitting comfortably in 1 line (>= 72% scale) so secondary layer gets line 2;
    // otherwise allow primary up to 2 lines and skip secondary so total visible lines stay <= 2.
    const primary = samplesToRender[0];
    const primaryBase = buildRoleStyleParams(
      primary,
      typography,
      vocalLayers,
      width,
      height,
      scaleFactor,
      true
    );
    const singleLineAttempt = fitSampleRowsForBudget(
      ctx,
      primary.line,
      primaryBase,
      typography.fontFamily,
      maxTextWidth,
      1,
      0.72
    );
    const primaryFitsOneLine =
      singleLineAttempt.rows.length === 1 &&
      singleLineAttempt.rows[0].totalWidth <= maxTextWidth + 2;

    const chosenPrimary = primaryFitsOneLine
      ? singleLineAttempt
      : fitSampleRowsForBudget(
          ctx,
          primary.line,
          primaryBase,
          typography.fontFamily,
          maxTextWidth,
          MAX_PREVIEW_LINES,
          0.52
        );

    const primaryEntry = buildPreparedEntry(primary, chosenPrimary.params, chosenPrimary.rows);
    if (primaryEntry) {
      preparedSamples.push(primaryEntry);
      remainingLineBudget = Math.max(0, MAX_PREVIEW_LINES - primaryEntry.rows.length);
    }

    if (remainingLineBudget >= 1) {
      const secondary = samplesToRender[1];
      const secondaryBase = buildRoleStyleParams(
        secondary,
        typography,
        vocalLayers,
        width,
        height,
        scaleFactor,
        true
      );
      const fittedSecondary = fitSampleRowsForBudget(
        ctx,
        secondary.line,
        secondaryBase,
        typography.fontFamily,
        maxTextWidth,
        remainingLineBudget,
        0.65
      );
      const secondaryEntry = buildPreparedEntry(
        secondary,
        fittedSecondary.params,
        fittedSecondary.rows
      );
      if (secondaryEntry) preparedSamples.push(secondaryEntry);
    }
  }

  const layoutBoxes = resolveVocalLayerLayout(
    preparedSamples.map((p) => ({
      id: p.sample.line.id,
      role: p.params.role,
      desiredX: p.params.desiredAnchorX,
      desiredY: p.params.desiredAnchorY,
      boxWidth: p.totalBoxWidth,
      boxHeight: p.totalBoxHeight,
      align: typography.align,
    })),
    width,
    height,
    watermarkEnabled
  );

  const layoutById = new Map(layoutBoxes.map((b) => [b.id, b]));

  for (const entry of preparedSamples) {
    const resolvedBox = layoutById.get(entry.sample.line.id);
    if (!resolvedBox) continue;
    renderSingleLyricSample(
      ctx,
      scaleFactor,
      currentTime,
      entry.sample,
      typography,
      entry.params,
      entry.rows,
      entry.blockHeight,
      entry.maxRowWidth,
      resolvedBox.anchorX,
      resolvedBox.anchorY
    );
  }

  const beatEnergy = options?.waveformPeaks
    ? computeLocalPeakFromWaveform(options.waveformPeaks, project.duration, currentTime, 0.18)
    : 0;
  renderWatermark(ctx, width, height, options?.watermarkTime ?? currentTime, {
    beatEnergy,
    reducedMotion: options?.reducedMotion,
  });

  ctx.restore();
}

function renderSingleLyricSample(
  ctx: CanvasRenderingContext2D,
  scaleFactor: number,
  currentTime: number,
  sample: ActiveLyricSample,
  style: TypographyStyle,
  params: RoleStyleParams,
  rows: WrappedLineRow[],
  blockHeight: number,
  maxRowWidth: number,
  anchorX: number,
  anchorY: number
) {
  const { line, alpha, scale, progress } = sample;
  const {
    fontSize,
    fontWeight,
    fontStylePrefix,
    letterSpacing,
    strokeWidth,
    lineHeight,
    color,
    highlightColor,
    roleAlpha,
    ensureContrastShadow,
  } = params;

  ctx.save();
  ctx.font = `${fontStylePrefix}${fontWeight} ${fontSize}px "${style.fontFamily}", "Noto Sans", system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  let effectScale = scale;
  if (line.effect === 'elastic-pop') {
    const pop = 1 + 0.22 * Math.sin(progress * Math.PI * 3.5) * Math.exp(-progress * 4.2);
    effectScale *= Math.max(0.85, Math.min(1.25, pop));
  }

  ctx.translate(anchorX, anchorY);
  ctx.scale(effectScale, effectScale);
  ctx.globalAlpha = Math.max(0, Math.min(1, style.opacity * alpha * roleAlpha));

  // Optional background pill/plate behind lyrics
  if (style.backgroundOpacity > 0 && maxRowWidth > 0) {
    const padX = style.backgroundPadding * scaleFactor * 1.4;
    const padY = style.backgroundPadding * scaleFactor * 0.85;
    let boxX = -maxRowWidth / 2 - padX;
    if (style.align === 'left') boxX = -padX;
    if (style.align === 'right') boxX = -maxRowWidth - padX;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, style.backgroundOpacity * alpha * roleAlpha));
    ctx.fillStyle = style.backgroundColor;
    const boxW = maxRowWidth + padX * 2;
    const boxH = blockHeight + padY * 2;
    const boxY = -blockHeight / 2 - padY;
    const radius = 8 * scaleFactor;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, radius);
    ctx.fill();
    ctx.restore();
  }

  // Shadow & Outline setup (guarantees clean readability across bright or textured backgrounds)
  if (style.shadowBlur > 0 || line.effect === 'neon-glow' || ensureContrastShadow) {
    const baseBlur = ensureContrastShadow ? Math.max(style.shadowBlur, 14) : style.shadowBlur;
    ctx.shadowColor =
      line.effect === 'neon-glow'
        ? highlightColor
        : style.shadowBlur > 0
          ? style.shadowColor
          : 'rgba(4, 7, 14, 0.78)';
    ctx.shadowBlur = (line.effect === 'neon-glow' ? 36 : baseBlur) * scaleFactor;
    ctx.shadowOffsetY =
      (style.shadowBlur > 0 ? style.shadowOffsetY : 2) * scaleFactor;
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = line.effect === 'neon-glow' ? highlightColor : style.outlineColor;

  const spaceW = ctx.measureText(' ').width + letterSpacing;
  const startY = -blockHeight / 2 + lineHeight / 2;

  // For progressive wipe effect, clip entire line smoothly
  if (line.effect === 'progressive') {
    // Draw dim base first
    ctx.save();
    ctx.globalAlpha *= 0.32;
    ctx.fillStyle = color;
    rows.forEach((row, rIdx) => {
      const y = startY + rIdx * lineHeight;
      let cursorX = getRowStartX(row.totalWidth, style.align);
      const visualWords = hasRtlScript(row.words.map((w) => w.text).join(' '))
        ? [...row.words].reverse()
        : row.words;
      for (const word of visualWords) {
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, 0);
        cursorX += word.width + spaceW;
      }
    });
    ctx.restore();

    // Clip to progressive width locked 1:1 to line progress
    ctx.save();
    const wipeWidth = maxRowWidth * easeInOutSine(Math.min(1, progress));
    const clipLeft =
      style.align === 'center'
        ? -maxRowWidth / 2 - 20
        : style.align === 'left'
          ? -20
          : -maxRowWidth - 20;
    ctx.beginPath();
    ctx.rect(clipLeft, -blockHeight, wipeWidth + 40, blockHeight * 2);
    ctx.clip();
  }

  rows.forEach((row, rIdx) => {
    const y = startY + rIdx * lineHeight;
    let cursorX = getRowStartX(row.totalWidth, style.align);
    const visualWords = hasRtlScript(row.words.map((w) => w.text).join(' '))
      ? [...row.words].reverse()
      : row.words;

    for (const word of visualWords) {
      if (line.effect === 'word-by-word') {
        if (currentTime < word.start) {
          cursorX += word.width + spaceW;
          continue;
        }
        const wordAge = (currentTime - word.start) / 0.022;
        const wordAlpha = Math.min(1, 0.8 + 0.2 * Math.max(0, wordAge));
        ctx.save();
        ctx.globalAlpha *= wordAlpha;
        ctx.fillStyle = color;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        ctx.restore();
      } else if (line.effect === 'karaoke') {
        // Draw base lyric color slightly muted
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha *= 0.45;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        ctx.restore();

        // Fill active or completed word with role highlight color locked to exact word timings
        if (currentTime >= word.start) {
          const wordDur = Math.max(0.06, word.end - word.start);
          const fillRatio = Math.min(1, Math.max(0.16, (currentTime - word.start) / wordDur));
          ctx.save();
          ctx.beginPath();
          ctx.rect(cursorX - 4, y - lineHeight * 0.6, word.width * fillRatio + 8, lineHeight * 1.2);
          ctx.clip();
          ctx.fillStyle = highlightColor;
          drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
          ctx.restore();
        }
      } else if (line.effect === 'shimmer-gold') {
        ctx.fillStyle = color;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        const beamX = (progress * 2.2 - 0.6) * maxRowWidth;
        ctx.save();
        ctx.beginPath();
        ctx.rect(beamX - 50, y - lineHeight * 0.7, 100, lineHeight * 1.4);
        ctx.clip();
        ctx.fillStyle = params.role === 'lead' ? highlightColor || '#FCD34D' : color;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
      }

      cursorX += word.width + spaceW;
    }
  });

  if (line.effect === 'progressive') {
    ctx.restore();
  }

  ctx.restore();
}

function getRowStartX(rowWidth: number, align: TypographyStyle['align']): number {
  if (align === 'left') return 0;
  if (align === 'right') return -rowWidth;
  return -rowWidth / 2;
}

