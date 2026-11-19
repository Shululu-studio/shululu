export const WATERMARK_TEXT = 'Shululu Lyrics';
export const WATERMARK_FONT_FAMILY = 'Caveat';
export const WATERMARK_FONT_WEIGHT = 700;

export interface WatermarkStyle {
  scale: number;
  fontSize: number;
  marginX: number;
  marginY: number;
  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
}

export interface WatermarkShake {
  offsetX: number;
  offsetY: number;
  rotationRad: number;
  scalePulse: number;
}

export interface WatermarkRenderOptions {
  beatEnergy?: number;
  reducedMotion?: boolean;
}

export function computeWatermarkStyle(width: number, height: number): WatermarkStyle {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const scale = Math.min(safeW, safeH) / 1080;
  const fontSize = Math.max(20, Math.round(48 * scale));
  const marginX = Math.max(16, Math.round(40 * scale));
  const marginY = Math.max(14, Math.round(30 * scale));
  const strokeWidth = Math.max(3, Number((fontSize * 0.16).toFixed(2)));
  const shadowBlur = Math.max(3, Math.round(8 * scale));
  const shadowOffsetY = Math.max(1, Math.round(3 * scale));

  return {
    scale,
    fontSize,
    marginX,
    marginY,
    strokeWidth,
    shadowBlur,
    shadowOffsetY,
  };
}

export function computeWatermarkShake(
  timeSec: number,
  scale: number,
  options?: WatermarkRenderOptions
): WatermarkShake {
  if (options?.reducedMotion) {
    return {
      offsetX: 0,
      offsetY: 0,
      rotationRad: -0.025,
      scalePulse: 1,
    };
  }

  const t = Number.isFinite(timeSec) ? timeSec : 0;
  const beatEnergy = Number.isFinite(options?.beatEnergy)
    ? Math.min(1, Math.max(0, options?.beatEnergy ?? 0))
    : 0;
  const energy = 1 + 0.75 * beatEnergy;

  // Calm, deliberate multi-harmonic sway (~0.6-1.5 Hz) instead of rapid buzzing
  const offsetX =
    (Math.sin(t * 4.6) * 2.6 + Math.cos(t * 8.2 + 0.8) * 1.3) * scale * energy;
  const offsetY =
    (Math.cos(t * 5.4 + 0.4) * 2.2 + Math.sin(t * 9.6) * 1.1) * scale * energy;
  const rotationRad =
    (-0.032 + Math.sin(t * 3.8) * 0.026 + Math.cos(t * 6.9) * 0.012) * energy;
  const scalePulse = 1 + Math.sin(t * 4.2) * 0.018 * energy;

  return {
    offsetX,
    offsetY,
    rotationRad,
    scalePulse,
  };
}

export function renderWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeSec: number,
  options?: WatermarkRenderOptions
): void {
  const style = computeWatermarkStyle(width, height);
  const shake = computeWatermarkShake(timeSec, style.scale, options);

  ctx.save();
  ctx.font = `${WATERMARK_FONT_WEIGHT} ${style.fontSize}px "${WATERMARK_FONT_FAMILY}", cursive`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const pivotX = width / 2 + shake.offsetX;
  const pivotY = height - style.marginY - style.fontSize * 0.42 + shake.offsetY;

  ctx.translate(pivotX, pivotY);
  ctx.rotate(shake.rotationRad);
  ctx.scale(shake.scalePulse, shake.scalePulse);

  ctx.globalAlpha = 0.94;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.miterLimit = 2;

  // Pass 1: Bold dark outer stroke + soft drop shadow for high contrast over any backdrop
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = style.shadowBlur;
  ctx.shadowOffsetY = style.shadowOffsetY;
  ctx.lineWidth = style.strokeWidth;
  ctx.strokeStyle = '#090D14';
  ctx.strokeText(WATERMARK_TEXT, 0, 0);

  // Pass 2: Clean bold handwritten fill
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText(WATERMARK_TEXT, 0, 0);

  ctx.restore();
}
