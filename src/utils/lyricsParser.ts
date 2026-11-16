import { EffectType, LyricLine, SectionType, WordTiming } from '../types/editor';
import { parseLrcTimestamp } from './timeFormat';
import { cleanLyricSegmentText } from './transcriptionParser';

export function countSyllables(word: string): number {
  const cleaned = word
    .toLowerCase()
    .replace(/[^a-z']/g, '')
    .replace(/'/g, '');
  if (!cleaned) return 1;
  if (cleaned.length <= 3) return 1;

  let normalized = cleaned.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  normalized = normalized.replace(/^y/, '');
  const matches = normalized.match(/[aeiouy]{1,2}/g);
  return Math.max(1, matches ? matches.length : 1);
}

export function buildWordTimings(
  text: string,
  lineStart: number,
  lineEnd: number,
  lineIdPrefix: string
): WordTiming[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const duration = Math.max(0.25, lineEnd - lineStart);
  const weights = tokens.map((t) => countSyllables(t) + 0.35);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = lineStart;
  return tokens.map((token, idx) => {
    const share = (weights[idx] / totalWeight) * duration;
    const start = Number(cursor.toFixed(3));
    const end =
      idx === tokens.length - 1
        ? Number(lineEnd.toFixed(3))
        : Number((cursor + share).toFixed(3));
    cursor += share;
    return {
      id: `${lineIdPrefix}_w${idx}_${Math.random().toString(36).slice(2, 6)}`,
      text: token,
      start,
      end: Math.max(start + 0.08, end),
    };
  });
}

function asSectionType(sec: string | null): SectionType | null {
  if (
    sec === 'intro' ||
    sec === 'verse' ||
    sec === 'pre-chorus' ||
    sec === 'chorus' ||
    sec === 'bridge' ||
    sec === 'outro'
  ) {
    return sec;
  }
  return null;
}

export interface ParsedLyricsResult {
  lines: LyricLine[];
  hasLrcTimestamps: boolean;
}

export function parseLyricsText(
  rawText: string,
  totalDuration = 30,
  defaultEffect: EffectType = 'fade'
): ParsedLyricsResult {
  const rawLines = rawText.split(/\r?\n/);
  let currentSection: SectionType = 'verse';
  let hasLrcTimestamps = false;

  interface TempEntry {
    text: string;
    section: SectionType;
    lrcTime: number | null;
  }

  const entries: TempEntry[] = [];

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Check LRC metadata tags like [ar:Artist], [ti:Title]
    if (/^\[(ar|ti|al|by|offset):/i.test(trimmed)) {
      continue;
    }

    // Check LRC timestamp prefix [mm:ss.xx]
    const lrcMatch = /^(\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])\s*(.*)$/.exec(trimmed);
    if (lrcMatch) {
      const parsedTime = parseLrcTimestamp(lrcMatch[1]);
      const { text: cleanBody, detectedSection } = cleanLyricSegmentText(lrcMatch[2]);
      const sec = asSectionType(detectedSection);
      if (sec) currentSection = sec;
      if (parsedTime !== null && cleanBody) {
        hasLrcTimestamps = true;
        entries.push({ text: cleanBody, section: currentSection, lrcTime: parsedTime });
      }
      continue;
    }

    const { text: cleanedBody, detectedSection } = cleanLyricSegmentText(trimmed);
    const sec = asSectionType(detectedSection);
    if (sec) {
      currentSection = sec;
    }
    if (!cleanedBody) continue;

    entries.push({ text: cleanedBody, section: currentSection, lrcTime: null });
  }

  if (entries.length === 0) {
    return { lines: [], hasLrcTimestamps: false };
  }

  const safeDuration = Math.max(totalDuration, entries.length * 2.5);

  const lines: LyricLine[] = entries.map((entry, idx) => {
    const id = `line_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
    let start: number;
    let end: number;

    if (hasLrcTimestamps && entry.lrcTime !== null) {
      start = entry.lrcTime;
      const nextLrc = entries[idx + 1]?.lrcTime;
      end =
        nextLrc !== null && nextLrc !== undefined
          ? Math.max(start + 0.6, nextLrc - 0.1)
          : Math.min(safeDuration, start + 3.5);
    } else {
      // Initial even distribution across usable span (with short lead-in/tail margin)
      const leadIn = Math.min(1.5, safeDuration * 0.04);
      const usable = Math.max(entries.length * 1.5, safeDuration - leadIn * 2);
      const slot = usable / entries.length;
      start = Number((leadIn + idx * slot).toFixed(2));
      end = Number(Math.min(safeDuration, start + Math.max(1.2, slot - 0.12)).toFixed(2));
    }

    return {
      id,
      text: entry.text,
      section: entry.section,
      start,
      end,
      effect: defaultEffect,
      effectOverride: false,
      words: buildWordTimings(entry.text, start, end, id),
    };
  });

  return { lines, hasLrcTimestamps };
}

export function redistributeWordTimings(line: LyricLine): LyricLine {
  return {
    ...line,
    words: buildWordTimings(line.text, line.start, line.end, line.id),
  };
}
