import { BACKGROUND_TEMPLATES } from '../data/presets';
import { AspectRatio, LyricLine, ProjectData, TypographyStyle } from '../types/editor';

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

export function getActiveLyricsAtTime(
  lyrics: LyricLine[],
  currentTime: number
): ActiveLyricSample[] {
  const results: ActiveLyricSample[] = [];

  for (let i = 0; i < lyrics.length; i++) {
    const line = lyrics[i];
    const nextLine = i + 1 < lyrics.length ? lyrics[i + 1] : null;

    const entranceDur = line.entranceDuration ?? 0.35;
    const exitDuration = line.exitDuration ?? 0.4;
    const delayBefore = line.delayBefore ?? 0.0;
    const easingFn = resolveEasing(line.easing);

    const effectiveStart = line.start - delayBefore - entranceDur;
    const effectiveEnd = nextLine ? Math.min(line.end, nextLine.start - 0.002) : line.end;

    if (currentTime < effectiveStart || currentTime > effectiveEnd) {
      continue;
    }

    const duration = Math.max(0.2, effectiveEnd - line.start);
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
      const outT = (effectiveEnd - currentTime) / Math.max(0.05, exitDuration);
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
      } else if (line.effect === 'cinematic' || line.effect === 'neon-glow' || line.effect === 'shimmer-gold' || line.effect === 'elastic-pop') {
        const cinWindow = entranceDur + delayBefore;
        const cinT = elapsedSincePre < cinWindow ? easingFn(elapsedSincePre / Math.max(0.01, cinWindow)) : 1;
        letterSpacingDelta = (1 - cinT) * 4;
        scale = 1.02 - cinT * 0.02;
      } else if (line.effect === 'subtle-drift') {
        offsetY = Math.sin(progress * Math.PI) * -12;
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

  if (results.length > 1) {
    results.sort((a, b) => b.line.start - a.line.start);
    return [results[0]];
  }

  return results;
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

export function wrapWordsForWidth(
  ctx: CanvasRenderingContext2D,
  line: LyricLine,
  maxWidth: number,
  letterSpacingPx: number
): WrappedLineRow[] {
  const spaceWidth = ctx.measureText(' ').width + letterSpacingPx;
  const wordObjects =
    line.words.length > 0
      ? line.words
      : line.text
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((t, idx) => ({
            id: `${line.id}_f${idx}`,
            text: t,
            start: line.start,
            end: line.end,
          }));

  const rows: WrappedLineRow[] = [];
  let currentRow: WrappedWord[] = [];
  let currentWidth = 0;

  wordObjects.forEach((w, idx) => {
    const measured =
      ctx.measureText(w.text).width + Math.max(0, w.text.length - 1) * letterSpacingPx;
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

  return rows;
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
  strokeWidth: number
) {
  if (Math.abs(letterSpacing) < 0.25) {
    if (strokeWidth > 0) ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    return;
  }

  let cursor = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
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

export interface RenderFrameOptions {
  transparentVideoBg?: boolean;
  hasAudio?: boolean;
  waveformPeaks?: number[];
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

  // 2. Render Active Lyrics (or [instrumental] when only instruments are playing)
  const activeSamples = getActiveLyricsAtTime(lyrics, currentTime);
  let samplesToRender = activeSamples;
  if (samplesToRender.length === 0) {
    const hasAudio = options?.hasAudio ?? Boolean(project.audioFileName);
    const instrumentalSample = getInstrumentalSampleAtTime(lyrics, currentTime, {
      duration: project.duration,
      hasAudio,
      waveformPeaks: options?.waveformPeaks,
    });
    if (instrumentalSample) {
      samplesToRender = [instrumentalSample];
    }
  }
  const scaleFactor = height / 1080;

  for (const sample of samplesToRender) {
    renderSingleLyricSample(ctx, width, height, scaleFactor, currentTime, sample, typography);
  }

  ctx.restore();
}

function renderSingleLyricSample(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scaleFactor: number,
  currentTime: number,
  sample: ActiveLyricSample,
  style: TypographyStyle
) {
  const { line, alpha, offsetY, scale, letterSpacingDelta, progress } = sample;
  const fontSize = Math.max(14, style.fontSize * scaleFactor);
  const letterSpacing = (style.letterSpacing + letterSpacingDelta) * scaleFactor;
  const strokeWidth = style.outlineWidth * scaleFactor * 2;
  const lineHeight = fontSize * style.lineSpacing;

  ctx.save();
  ctx.font = `${style.fontWeight} ${fontSize}px "${style.fontFamily}", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const maxTextWidth = width * 0.84;
  const rows = wrapWordsForWidth(ctx, line, maxTextWidth, letterSpacing);
  if (rows.length === 0) {
    ctx.restore();
    return;
  }
  const blockHeight = rows.length * lineHeight;
  const maxRowWidth = rows.reduce((m, r) => Math.max(m, r.totalWidth), 0);

  const anchorX = style.positionX * width + (sample.offsetX ?? 0) * scaleFactor;
  const anchorY = style.positionY * height + offsetY * scaleFactor;

  let effectScale = scale;
  if (line.effect === 'elastic-pop') {
    const pop = 1 + 0.22 * Math.sin(progress * Math.PI * 3.5) * Math.exp(-progress * 4.2);
    effectScale *= Math.max(0.85, Math.min(1.25, pop));
  }

  ctx.translate(anchorX, anchorY);
  ctx.scale(effectScale, effectScale);
  ctx.globalAlpha = Math.max(0, Math.min(1, style.opacity * alpha));

  // Optional background pill/plate behind lyrics
  if (style.backgroundOpacity > 0 && maxRowWidth > 0) {
    const padX = style.backgroundPadding * scaleFactor * 1.4;
    const padY = style.backgroundPadding * scaleFactor * 0.85;
    let boxX = -maxRowWidth / 2 - padX;
    if (style.align === 'left') boxX = -padX;
    if (style.align === 'right') boxX = -maxRowWidth - padX;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, style.backgroundOpacity * alpha));
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

  // Shadow & Outline setup
  if (style.shadowBlur > 0 || line.effect === 'neon-glow') {
    ctx.shadowColor = line.effect === 'neon-glow' ? (style.highlightColor || '#22D3EE') : style.shadowColor;
    ctx.shadowBlur = (line.effect === 'neon-glow' ? 36 : style.shadowBlur) * scaleFactor;
    ctx.shadowOffsetY = style.shadowOffsetY * scaleFactor;
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = line.effect === 'neon-glow' ? (style.highlightColor || '#22D3EE') : style.outlineColor;

  const spaceW = ctx.measureText(' ').width + letterSpacing;
  const startY = -blockHeight / 2 + lineHeight / 2;

  // For progressive wipe effect, clip entire line smoothly
  if (line.effect === 'progressive') {
    // Draw dim base first
    ctx.save();
    ctx.globalAlpha *= 0.32;
    ctx.fillStyle = style.color;
    rows.forEach((row, rIdx) => {
      const y = startY + rIdx * lineHeight;
      let cursorX = getRowStartX(row.totalWidth, style.align);
      for (const word of row.words) {
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

    for (const word of row.words) {
      if (line.effect === 'word-by-word') {
        if (currentTime < word.start) {
          cursorX += word.width + spaceW;
          continue;
        }
        const wordAge = (currentTime - word.start) / 0.022;
        const wordAlpha = Math.min(1, 0.8 + 0.2 * Math.max(0, wordAge));
        ctx.save();
        ctx.globalAlpha *= wordAlpha;
        ctx.fillStyle = style.color;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        ctx.restore();
      } else if (line.effect === 'karaoke') {
        // Draw base lyric color slightly muted
        ctx.save();
        ctx.fillStyle = style.color;
        ctx.globalAlpha *= 0.45;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        ctx.restore();

        // Fill active or completed word with highlightColor locked to exact word timings
        if (currentTime >= word.start) {
          const wordDur = Math.max(0.06, word.end - word.start);
          const fillRatio = Math.min(1, Math.max(0.16, (currentTime - word.start) / wordDur));
          ctx.save();
          ctx.beginPath();
          ctx.rect(cursorX - 4, y - lineHeight * 0.6, word.width * fillRatio + 8, lineHeight * 1.2);
          ctx.clip();
          ctx.fillStyle = style.highlightColor;
          drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
          ctx.restore();
        }
      } else if (line.effect === 'shimmer-gold') {
        ctx.fillStyle = style.color;
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        const beamX = (progress * 2.2 - 0.6) * maxRowWidth;
        ctx.save();
        ctx.beginPath();
        ctx.rect(beamX - 50, y - lineHeight * 0.7, 100, lineHeight * 1.4);
        ctx.clip();
        ctx.fillStyle = style.highlightColor || '#FCD34D';
        drawSpacedText(ctx, word.text, cursorX, y, letterSpacing, strokeWidth);
        ctx.restore();
      } else {
        ctx.fillStyle = style.color;
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
