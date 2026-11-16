import { AutoEffectStyle, EffectType, LyricLine, SectionType } from '../types/editor';

const STYLE_MAP: Record<AutoEffectStyle, EffectType> = {
  'worship-serene': 'fade',
  'contemporary-clean': 'slide-up',
  'dynamic-stage': 'karaoke',
  'minimal-editorial': 'line-crossfade',
};

export function pickEffectForLine(
  line: LyricLine,
  style: AutoEffectStyle
): EffectType {
  const duration = line.end - line.start;
  const wordCount = line.words.length || line.text.trim().split(/\s+/).length;
  const baseEffect = STYLE_MAP[style] ?? 'fade';

  if (duration < 1.35 && (baseEffect === 'gentle-zoom' || baseEffect === 'cinematic')) {
    return 'fade';
  }
  if (wordCount <= 1 && (baseEffect === 'word-by-word' || baseEffect === 'karaoke')) {
    return 'fade';
  }
  return baseEffect;
}

export function assignAutoEffects(
  lines: LyricLine[],
  style: AutoEffectStyle,
  respectOverrides = true
): LyricLine[] {
  return lines.map((line) => {
    if (respectOverrides && line.effectOverride) {
      return line;
    }
    return {
      ...line,
      effect: pickEffectForLine(line, style),
    };
  });
}
