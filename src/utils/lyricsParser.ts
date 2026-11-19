import { EffectType, LyricLine, SectionType, VocalRole, WordTiming } from '../types/editor';
import { parseLrcTimestamp } from './timeFormat';
import {
  cleanLyricSegmentText,
  formatLyricForVocalRole,
  inferVocalRoleFromText,
} from './transcriptionParser';

const BANTU_OR_OPEN_END_RE =
  /^(?:mb|nd|ng|nj|ny|nz|mv|mw|bw|kw|gw|tw|pw|sv|zv|tsv|dzv|vh|dh|bh)|(?:tsv|dzv|ny|ng|mb|nd|sv|zv)/;

export function countSyllables(word: string): number {
  const nfc = (word || '').normalize('NFC').trim();
  if (!nfc) return 1;

  // Korean Hangul syllable blocks: 1 block = 1 syllable
  const hangulMatches = nfc.match(/[\uAC00-\uD7AF]/g);
  // CJK Unified Ideographs: 1 character = 1 syllable
  const cjkMatches = nfc.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g);
  // Japanese Kana morae (excluding small yoon/sokuon/chouonpu modifiers counted gently)
  const kanaMatches = nfc.match(/[\u3041-\u3096\u30A1-\u30FA]/g);
  // Ethiopic / Amharic fidel: each base glyph carries a CV syllable
  const ethiopicMatches = nfc.match(/[\u1200-\u135A]/g);
  // Devanagari / Indic consonant + independent vowel bases
  const indicMatches = nfc.match(/[\u0904-\u0939\u0958-\u0961]/g);
  // Arabic / Hebrew letters
  const rtlMatches = nfc.match(/[\u0621-\u064A\u0671-\u06D3\u05D0-\u05EA]/g);

  const nonLatinCount =
    (hangulMatches?.length ?? 0) +
    (cjkMatches?.length ?? 0) +
    (kanaMatches?.length ?? 0) +
    (ethiopicMatches?.length ?? 0) +
    (indicMatches?.length ?? 0) +
    (rtlMatches ? Math.max(1, Math.round(rtlMatches.length / 2.2)) : 0);

  if (nonLatinCount > 0) {
    return Math.max(1, nonLatinCount);
  }

  // Handle apostrophe elisions / clitics (e.g. French "l'amour", "c'est", Shona "n'anga", Swahili "ng'ombe")
  const hasAccent = /[\u00C0-\u024F\u1E00-\u1EFF]/.test(nfc) &&
    /[\u0300-\u036f]/.test(nfc.normalize('NFD'));

  const folded = nfc
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^a-z']/g, '');

  const cleaned = folded.replace(/'/g, '');
  if (!cleaned) return 1;
  if (cleaned.length <= 3) return 1;

  const rawVowelMatches = cleaned.match(/[aeiouy]{1,2}/g);
  const rawCount = rawVowelMatches ? rawVowelMatches.length : 1;

  // Preserve terminal -e syllables for accented words (French "adoré", "grâce"),
  // Bantu/Swahili/Shona open syllables ("mbele", "asante", "mutsvene", "ng'ombe"),
  // and 3+ syllable non-English words ending in vowel+consonant+e.
  const preserveFinalVowel =
    hasAccent ||
    BANTU_OR_OPEN_END_RE.test(cleaned) ||
    (rawCount >= 3 && /(?:ante|ele|ene|ile|ole|ule|one|ane|ende|ombe|ange)$/.test(cleaned));

  let normalized = preserveFinalVowel
    ? cleaned
    : cleaned.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
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
    vocalRole: VocalRole;
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
        const inferredRole = inferVocalRoleFromText(cleanBody);
        entries.push({
          text: formatLyricForVocalRole(cleanBody, inferredRole),
          section: currentSection,
          vocalRole: inferredRole,
          lrcTime: parsedTime,
        });
      }
      continue;
    }

    const { text: cleanedBody, detectedSection } = cleanLyricSegmentText(trimmed);
    const sec = asSectionType(detectedSection);
    if (sec) {
      currentSection = sec;
    }
    if (!cleanedBody) continue;

    const inferredRole = inferVocalRoleFromText(cleanedBody);
    entries.push({
      text: formatLyricForVocalRole(cleanedBody, inferredRole),
      section: currentSection,
      vocalRole: inferredRole,
      lrcTime: null,
    });
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
      vocalRole: entry.vocalRole,
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
  const rebuilt = buildWordTimings(line.text, line.start, line.end, line.id);
  const existingWords = line.words ?? [];
  const merged = rebuilt.map((w, idx) => {
    const prev = existingWords[idx];
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
    words: merged,
  };
}
