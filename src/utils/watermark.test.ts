import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWatermarkShake,
  computeWatermarkStyle,
  renderWatermark,
  WATERMARK_FONT_FAMILY,
  WATERMARK_FONT_WEIGHT,
  WATERMARK_TEXT,
} from './watermark';

test('computeWatermarkStyle scales cleanly across aspect ratios with bold stroke', () => {
  const hd = computeWatermarkStyle(1920, 1080);
  const vertical = computeWatermarkStyle(1080, 1920);
  const square = computeWatermarkStyle(1080, 1080);
  const draft = computeWatermarkStyle(960, 540);

  assert.equal(hd.scale, 1);
  assert.equal(hd.fontSize, 48);
  assert.ok(hd.strokeWidth >= 6, `Expected bold stroke width >= 6, got ${hd.strokeWidth}`);
  assert.equal(vertical.fontSize, hd.fontSize);
  assert.equal(square.fontSize, hd.fontSize);
  assert.ok(draft.fontSize < hd.fontSize);
  assert.ok(draft.marginX >= 16);
  assert.ok(draft.marginY >= 14);
});

test('computeWatermarkShake produces dynamic motion over time and scales with beatEnergy', () => {
  const samples = [0, 0.06, 0.14, 0.29, 0.55, 1.12].map((t) =>
    computeWatermarkShake(t, 1)
  );

  const uniqueX = new Set(samples.map((s) => Number(s.offsetX.toFixed(3))));
  const uniqueY = new Set(samples.map((s) => Number(s.offsetY.toFixed(3))));
  const uniqueRot = new Set(samples.map((s) => Number(s.rotationRad.toFixed(4))));

  assert.ok(uniqueX.size >= 5, 'Expected horizontal shake to vary dynamically across frames');
  assert.ok(uniqueY.size >= 5, 'Expected vertical shake to vary dynamically across frames');
  assert.ok(uniqueRot.size >= 5, 'Expected rotation wobble to vary dynamically across frames');

  const calm = computeWatermarkShake(0.25, 1, { beatEnergy: 0 });
  const energetic = computeWatermarkShake(0.25, 1, { beatEnergy: 1 });
  assert.ok(
    Math.hypot(energetic.offsetX, energetic.offsetY) >
      Math.hypot(calm.offsetX, calm.offsetY),
    'Expected beatEnergy to amplify shake amplitude'
  );

  // Verify slower, smoother frame-to-frame motion (no rapid high-frequency jitter)
  let maxFrameStep = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i <= 45; i++) {
    const t = i * 0.033;
    const cur = computeWatermarkShake(t, 1);
    minX = Math.min(minX, cur.offsetX);
    maxX = Math.max(maxX, cur.offsetX);
    if (i > 0) {
      const prev = computeWatermarkShake((i - 1) * 0.033, 1);
      const step = Math.hypot(cur.offsetX - prev.offsetX, cur.offsetY - prev.offsetY);
      if (step > maxFrameStep) maxFrameStep = step;
    }
  }
  assert.ok(maxFrameStep < 1.25, `Expected smooth step < 1.25px/frame at 30fps, got ${maxFrameStep}`);
  assert.ok(maxX - minX >= 4.0, `Expected visible dynamic sway >= 4px, got ${maxX - minX}`);
});

test('computeWatermarkShake respects reducedMotion preference', () => {
  const s1 = computeWatermarkShake(0.1, 1, { reducedMotion: true });
  const s2 = computeWatermarkShake(0.85, 1, { reducedMotion: true });

  assert.equal(s1.offsetX, 0);
  assert.equal(s1.offsetY, 0);
  assert.equal(s1.scalePulse, 1);
  assert.deepEqual(s1, s2);
});

test('renderWatermark draws bold Caveat handwriting text at bottom-middle with stroke before fill', () => {
  const calls: string[] = [];
  let capturedFont = '';
  let capturedLineWidth = 0;
  let capturedTranslate: [number, number] | null = null;

  const mockCtx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x: number, y: number) => {
      capturedTranslate = [x, y];
    },
    rotate: () => {},
    scale: () => {},
    measureText: (text: string) => ({ width: text.length * 20 }),
    strokeText: (text: string) => {
      assert.equal(text, WATERMARK_TEXT);
      calls.push('strokeText');
    },
    fillText: (text: string) => {
      assert.equal(text, WATERMARK_TEXT);
      calls.push('fillText');
    },
    set font(v: string) {
      capturedFont = v;
    },
    get font() {
      return capturedFont;
    },
    set lineWidth(v: number) {
      capturedLineWidth = v;
    },
    get lineWidth() {
      return capturedLineWidth;
    },
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    miterLimit: 10,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    strokeStyle: '',
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;

  renderWatermark(mockCtx, 1920, 1080, 0.35);

  assert.ok(capturedFont.includes(String(WATERMARK_FONT_WEIGHT)));
  assert.ok(capturedFont.includes(WATERMARK_FONT_FAMILY));
  assert.ok(capturedLineWidth >= 6);
  assert.ok(capturedTranslate !== null);
  assert.ok(
    Math.abs(capturedTranslate[0] - 1920 / 2) < 20,
    `Expected bottom-middle X near 960, got ${capturedTranslate[0]}`
  );
  assert.ok(capturedTranslate[1] > 950, `Expected bottom-middle Y near bottom, got ${capturedTranslate[1]}`);

  const strokeIdx = calls.indexOf('strokeText');
  const fillIdx = calls.indexOf('fillText');
  assert.ok(strokeIdx !== -1 && fillIdx !== -1 && strokeIdx < fillIdx);
});
