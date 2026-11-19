import { LyricLine, SectionType } from '../types/editor';
import { SECTION_LABELS } from '../data/presets';
import { parseLyricsText, redistributeWordTimings } from './lyricsParser';

export function formatDraftLinesForBulkEdit(lines: LyricLine[]): string {
  if (lines.length === 0) return '';
  const out: string[] = [];
  let prevSection: SectionType | null = null;
  for (const line of lines) {
    if (line.section !== prevSection) {
      if (out.length > 0) out.push('');
      out.push(`[${SECTION_LABELS[line.section]}]`);
      prevSection = line.section;
    }
    out.push(line.text);
  }
  return out.join('\n');
}

export function syncDraftLinesFromBulkText(
  rawText: string,
  existingLines: LyricLine[],
  duration: number
): LyricLine[] {
  const safeDuration = duration > 0 ? duration : Math.max(30, existingLines.reduce((m, l) => Math.max(m, l.end), 0));
  const parsed = parseLyricsText(rawText, safeDuration);
  if (parsed.lines.length === 0) return [];

  return parsed.lines.map((parsedLine, idx) => {
    const prev = existingLines[idx];
    if (!prev) {
      return parsedLine;
    }
    const start = parsed.hasLrcTimestamps ? parsedLine.start : prev.start;
    const end = parsed.hasLrcTimestamps
      ? parsedLine.end
      : Math.max(start + 0.4, prev.end);
    return redistributeWordTimings({
      ...prev,
      text: parsedLine.text,
      section: parsedLine.section,
      start,
      end,
    });
  });
}

export function applyTapAtIndex(
  lines: LyricLine[],
  activeIndex: number,
  currentTime: number,
  duration: number
): { lines: LyricLine[]; nextIndex: number } {
  if (activeIndex < 0 || activeIndex >= lines.length) {
    return { lines, nextIndex: activeIndex };
  }

  const t = Number(Math.max(0, currentTime).toFixed(2));
  const safeCeiling = duration > 0 ? Math.max(duration, t + 2.8) : t + 2.8;
  const next = lines.map((l) => ({ ...l }));

  if (activeIndex > 0 && next[activeIndex - 1]) {
    const prev = next[activeIndex - 1];
    const clampedPrevEnd = Math.max(prev.start + 0.35, Number((t - 0.08).toFixed(2)));
    next[activeIndex - 1] = {
      ...prev,
      end: clampedPrevEnd,
    };
  }

  const current = next[activeIndex];
  const nextCueEnd =
    activeIndex + 1 < next.length && next[activeIndex + 1].start > t + 0.45
      ? Math.min(safeCeiling, Number((next[activeIndex + 1].start - 0.08).toFixed(2)))
      : Math.min(safeCeiling, Number((t + 2.8).toFixed(2)));

  next[activeIndex] = {
    ...current,
    start: t,
    end: Math.max(t + 0.4, nextCueEnd),
  };

  return {
    lines: next,
    nextIndex: Math.min(lines.length, activeIndex + 1),
  };
}

export function createBlankTapCueLine(
  existingLines: LyricLine[],
  duration: number
): LyricLine {
  const last = existingLines[existingLines.length - 1];
  const start = last ? Number((last.end + 0.2).toFixed(2)) : 0.5;
  const rawEnd = Number((start + 2.8).toFixed(2));
  const end = duration > 0 && start < duration ? Math.min(duration, Math.max(start + 0.5, rawEnd)) : rawEnd;
  const id = `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return redistributeWordTimings({
    id,
    text: `Lyric line ${existingLines.length + 1}`,
    section: last?.section ?? 'verse',
    start,
    end: Math.max(start + 0.4, end),
    effect: last?.effect ?? 'fade',
    effectOverride: false,
    words: [],
  });
}

export function finalizeTapSyncLines(lines: LyricLine[]): LyricLine[] {
  return lines
    .map((line) => ({
      ...line,
      text: line.text.trim(),
    }))
    .filter((line) => line.text.length > 0)
    .map((line) => {
      const start = Number(Math.max(0, line.start).toFixed(2));
      const end = Number(Math.max(start + 0.4, line.end).toFixed(2));
      return redistributeWordTimings({
        ...line,
        start,
        end,
      });
    });
}
