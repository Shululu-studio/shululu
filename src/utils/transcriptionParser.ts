import type { VocalRole } from '../types/editor';

export interface RawWordCandidate {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  confidence?: unknown;
  uncertain?: unknown;
}

export interface RawTranscribedSegment {
  lineIndex: number;
  text: string;
  section: string;
  vocalRole?: VocalRole;
  start: number;
  end: number;
  startTime?: string;
  endTime?: string;
  confidence?: number;
  uncertain?: boolean;
  uncertainWords?: string[];
  words?: Array<{
    text: string;
    start: number;
    end: number;
    confidence?: number;
    uncertain?: boolean;
  }>;
}

export function normalizeVocalRole(raw?: unknown): VocalRole | undefined {
  if (typeof raw !== 'string') return undefined;
  const lower = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!lower) return undefined;
  if (lower === 'lead' || lower === 'leadvocal' || lower === 'leadvocalist' || lower === 'main') {
    return 'lead';
  }
  if (
    lower === 'backing' ||
    lower === 'backingvocal' ||
    lower === 'backingvocalist' ||
    lower === 'background' ||
    lower === 'bgv' ||
    lower === 'echo' ||
    lower === 'harmony'
  ) {
    return 'backing';
  }
  if (lower === 'choir' || lower === 'ensemble' || lower === 'group' || lower === 'crowd') {
    return 'choir';
  }
  if (lower === 'adlib' || lower === 'adlibs' || lower === 'riff' || lower === 'run') {
    return 'adlib';
  }
  return undefined;
}

export function stripOuterParentheses(text: string): string {
  let out = (text || '').trim();
  while (out.startsWith('(') && out.endsWith(')') && out.length >= 2) {
    // Only strip if the opening '(' at index 0 matches the closing ')' at the end
    let depth = 0;
    let closesAtEnd = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') depth--;
      if (depth === 0 && i < out.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd || depth !== 0) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

export function formatLyricForVocalRole(text: string, _role: VocalRole): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  return stripOuterParentheses(trimmed);
}

export function inferVocalRoleFromText(text: string, explicitRole?: unknown): VocalRole {
  const normalized = normalizeVocalRole(explicitRole);
  if (normalized) return normalized;
  const trimmed = (text || '').trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')') && stripOuterParentheses(trimmed).length > 0) {
    return 'backing';
  }
  return 'lead';
}

export function countVocalWords(text: string): number {
  const cleaned = stripOuterParentheses((text || '').trim())
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function normalizeMultilingualToken(token: string): string {
  return (token || '')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function normalizeFuzzyToken(token: string): string {
  return normalizeMultilingualToken(token);
}

function tokenizeNormalizedWords(text: string): string[] {
  return stripOuterParentheses((text || '').trim())
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map(normalizeFuzzyToken)
    .filter(Boolean);
}

function boundedLevenshtein(a: string, b: string, maxDist = 2): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const dp: number[] = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) dp[j] = j;

  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const temp = dp[j];
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      if (dp[j] < rowMin) rowMin = dp[j];
      prev = temp;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[lb];
}

/**
 * Matches two normalized words cleanly even when one is a clipped phonetic fragment
 * or 1–2 char spelling variation (e.g. "amtenda" vs "ametenda", "bwan" vs "bwana"),
 * while avoiding false positives on short distinct words (e.g. "lord" vs "word").
 */
export function fuzzyWordMatch(wordA: string, wordB: string): boolean {
  const a = normalizeFuzzyToken(wordA);
  const b = normalizeFuzzyToken(wordB);
  if (!a || !b) return false;
  if (a === b) return true;

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen < 3) return false;

  if (minLen >= 4 && (a.startsWith(b) || b.startsWith(a)) && minLen / maxLen >= 0.72) {
    return true;
  }

  if (minLen >= 4 && maxLen >= 5) {
    const d = boundedLevenshtein(a, b, 2);
    if (d <= 1) return true;
    if (minLen >= 5 && d <= 2 && d / maxLen <= 0.28) return true;
  }

  return false;
}

function tokensPrefixMatch(
  shortTokens: string[],
  longTokens: string[]
): { matched: boolean; allExact: boolean } {
  if (shortTokens.length === 0 || shortTokens.length >= longTokens.length) {
    return { matched: false, allExact: false };
  }
  let allExact = true;
  let directOk = true;
  for (let i = 0; i < shortTokens.length; i++) {
    if (shortTokens[i] !== longTokens[i]) {
      allExact = false;
      if (!fuzzyWordMatch(shortTokens[i], longTokens[i])) {
        directOk = false;
        break;
      }
    }
  }
  if (directOk) {
    return { matched: true, allExact };
  }

  // Handle accidentally space-split agglutinative words: ["ame", "tenda"] -> "ametenda"
  if (shortTokens.length >= 2) {
    const joined = shortTokens.join('');
    if (fuzzyWordMatch(joined, longTokens[0])) {
      return { matched: true, allExact: false };
    }
  }
  return { matched: false, allExact: false };
}

function tokensSuffixMatch(shortTokens: string[], longTokens: string[]): boolean {
  if (shortTokens.length === 0 || shortTokens.length >= longTokens.length) return false;
  const offset = longTokens.length - shortTokens.length;
  for (let i = 0; i < shortTokens.length; i++) {
    if (!fuzzyWordMatch(shortTokens[i], longTokens[offset + i])) {
      return false;
    }
  }
  return true;
}

function stretchMergedWords<
  T extends {
    words?: Array<{
      id?: string;
      text: string;
      start: number;
      end: number;
      confidence?: number;
      uncertain?: boolean;
    }>;
  }
>(base: T, mergedStart: number, mergedEnd: number): T {
  if (!Array.isArray(base.words) || base.words.length === 0) {
    return base;
  }
  const n = base.words.length;
  const updated = base.words.map((w) => ({ ...w }));
  updated[0].start = Number(Math.min(updated[0].start, mergedStart).toFixed(3));
  updated[n - 1].end = Number(Math.max(updated[n - 1].end, mergedEnd).toFixed(3));

  for (let i = 0; i < n; i++) {
    const minS = i > 0 ? updated[i - 1].start + 0.025 : mergedStart;
    const maxS = Math.max(minS, mergedEnd - (n - i) * 0.025);
    const s = Number(Math.max(minS, Math.min(maxS, updated[i].start)).toFixed(3));
    const maxE = i < n - 1 ? Math.max(s + 0.025, updated[i + 1].start) : mergedEnd;
    const e = Number(Math.max(s + 0.025, Math.min(mergedEnd, maxE, updated[i].end)).toFixed(3));
    updated[i].start = s;
    updated[i].end = i === n - 1 ? Number(Math.max(e, mergedEnd).toFixed(3)) : e;
  }
  return { ...base, words: updated };
}

/**
 * Merges split or repeated sentence fragments in chronological transcription output:
 * - Hesitant/misheard leading fragment immediately preceding or overlapping the full phrase
 *   (e.g. "amtenda" [10.0..10.6] + "ametenda amani" [10.65..13.2] -> ONE "ametenda amani" [10.0..13.2])
 * - Redundant trailing word echo repeating the end of the preceding sentence
 *   (e.g. "ametenda amani" [10.0..12.6] + "amani" [12.55..13.2] -> extends prev [10.0..13.2])
 * - Overlapping shared bridge word across a cue seam
 *   (e.g. "Bwana Yesu ametenda" + "ametenda amani" -> "Bwana Yesu ametenda amani")
 * Leaves genuine full-phrase chorus repetitions untouched.
 */
export function mergeSplitPhraseDuplicates<
  T extends {
    text: string;
    start: number;
    end: number;
    vocalRole?: VocalRole;
    words?: Array<{
      id?: string;
      text: string;
      start: number;
      end: number;
      confidence?: number;
      uncertain?: boolean;
    }>;
  }
>(segments: T[]): T[] {
  if (segments.length <= 1) return segments;

  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: T[] = [];

  for (const cur of sorted) {
    if (merged.length === 0) {
      merged.push(cur);
      continue;
    }

    const prev = merged[merged.length - 1];
    const prevRole = inferVocalRoleFromText(prev.text, prev.vocalRole);
    const curRole = inferVocalRoleFromText(cur.text, cur.vocalRole);

    if (prevRole !== curRole) {
      merged.push(cur);
      continue;
    }

    const prevTokens = tokenizeNormalizedWords(prev.text);
    const curTokens = tokenizeNormalizedWords(cur.text);
    if (prevTokens.length === 0 || curTokens.length === 0) {
      merged.push(cur);
      continue;
    }

    const gap = cur.start - prev.end;
    const prevDur = Math.max(0.05, prev.end - prev.start);
    const curDur = Math.max(0.05, cur.end - cur.start);
    const overlaps = cur.start < prev.end + 0.12;

    // 1. Exact/near-exact consecutive repeat that overlaps temporally
    if (
      overlaps &&
      prevTokens.length === curTokens.length &&
      prevTokens.every((t, idx) => fuzzyWordMatch(t, curTokens[idx]))
    ) {
      const target =
        curTokens.join('').length >= prevTokens.join('').length ? cur : prev;
      const newStart = Math.min(prev.start, cur.start);
      const newEnd = Math.max(prev.end, cur.end);
      merged[merged.length - 1] = stretchMergedWords(
        { ...target, start: newStart, end: newEnd },
        newStart,
        newEnd
      );
      continue;
    }

    // 2. Clipped opening fragment -> full phrase (e.g. "amtenda" followed by "ametenda amani",
    //    or overlapping clipped stem "ndino" -> "Ndinotenda Mwari mutsvene")
    if (prevTokens.length < curTokens.length && prevTokens.length <= 3) {
      const prefix = tokensPrefixMatch(prevTokens, curTokens);
      const isOverlappingHalfWordStem =
        overlaps &&
        prevTokens.length === 1 &&
        prevTokens[0].length >= 4 &&
        prevDur <= 1.2 &&
        curTokens[0].startsWith(prevTokens[0]);
      if (prefix.matched || isOverlappingHalfWordStem) {
        const isFuzzyFragmentSplit = !prefix.allExact && prevDur <= 2.2 && gap <= 0.75;
        const isTightBriefSplit = prevDur <= 1.35 && gap <= 0.45;
        if (overlaps || isFuzzyFragmentSplit || isTightBriefSplit) {
          const newStart = Math.min(prev.start, cur.start);
          const newEnd = Math.max(prev.end, cur.end);
          merged[merged.length - 1] = stretchMergedWords(
            { ...cur, start: newStart, end: newEnd },
            newStart,
            newEnd
          );
          continue;
        }
      }
    }

    // 3. Full phrase -> clipped trailing echo/tail fragment (e.g. "ametenda amani" + "amani")
    if (
      curTokens.length < prevTokens.length &&
      curTokens.length <= 2 &&
      gap <= 0.45 &&
      (overlaps || curDur <= 1.35) &&
      tokensSuffixMatch(curTokens, prevTokens)
    ) {
      const newStart = Math.min(prev.start, cur.start);
      const newEnd = Math.max(prev.end, cur.end);
      merged[merged.length - 1] = stretchMergedWords(
        { ...prev, start: newStart, end: newEnd },
        newStart,
        newEnd
      );
      continue;
    }

    // 4. Overlapping bridge word split across seam (e.g. "Bwana ametenda" + "ametenda amani")
    if (
      overlaps &&
      prevTokens.length >= 2 &&
      curTokens.length >= 2 &&
      prevTokens.length + curTokens.length <= 10
    ) {
      const prevRaw = prev.text.trim().split(/\s+/).filter(Boolean);
      const curRaw = cur.text.trim().split(/\s+/).filter(Boolean);
      let bridgeLen = 0;
      const maxCheck = Math.min(2, prevTokens.length - 1, curTokens.length - 1);
      for (let k = maxCheck; k >= 1; k--) {
        let allMatch = true;
        for (let idx = 0; idx < k; idx++) {
          if (!fuzzyWordMatch(prevTokens[prevTokens.length - k + idx], curTokens[idx])) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          bridgeLen = k;
          break;
        }
      }

      if (bridgeLen > 0) {
        const joinedText = [...prevRaw.slice(0, prevRaw.length - bridgeLen), ...curRaw].join(' ');
        const newStart = Math.min(prev.start, cur.start);
        const newEnd = Math.max(prev.end, cur.end);
        const mergedWords =
          Array.isArray(prev.words) && Array.isArray(cur.words)
            ? [...prev.words.slice(0, prev.words.length - bridgeLen), ...cur.words]
            : undefined;
        merged[merged.length - 1] = stretchMergedWords(
          {
            ...prev,
            text: joinedText,
            start: newStart,
            end: newEnd,
            words: mergedWords,
          },
          newStart,
          newEnd
        );
        continue;
      }
    }

    merged.push(cur);
  }

  return merged;
}

/**
 * Cleans simultaneous vocal segments for worship/lyric video presentation:
 * 1. Suppresses short 1–2 word lead/ad-lib interjections (e.g. "Come on", "Amen", "Sing")
 *    that cut in over active backing or choir singing.
 * 2. Promotes any backing chorus line whose lead interjection was suppressed to 'choir'
 *    so the primary sung lyrics stay visible in clean main typography.
 * 3. Drops secondary lower backing echo segments that overlap concurrent lead or choir lines.
 * 4. Merges split/repeated same-sentence fragments (e.g. "amtenda" + "ametenda amani").
 */
export function filterVocalSegmentsForCleanPresentation<
  T extends {
    text: string;
    start: number;
    end: number;
    vocalRole?: VocalRole;
    words?: Array<{
      id?: string;
      text: string;
      start: number;
      end: number;
      confidence?: number;
      uncertain?: boolean;
    }>;
  }
>(segments: T[]): T[] {
  if (segments.length <= 1) return segments;

  const meta = segments.map((seg) => ({
    role: inferVocalRoleFromText(seg.text, seg.vocalRole),
    wordCount: countVocalWords(seg.text),
    dur: Math.max(0.05, seg.end - seg.start),
  }));

  const dropIndices = new Set<number>();
  const promoteBackingIndices = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const curMeta = meta[i];
    if (curMeta.role !== 'lead' && curMeta.role !== 'adlib') continue;
    if (curMeta.wordCount === 0 || curMeta.wordCount > 2) continue;

    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      const other = segments[j];
      const otherMeta = meta[j];
      const overlap = Math.min(cur.end, other.end) - Math.max(cur.start, other.start);
      const nested = cur.start >= other.start - 0.08 && cur.end <= other.end + 0.08;
      if (overlap < 0.12 && !nested) continue;

      let interruptsHost = false;
      if (otherMeta.role === 'backing' || otherMeta.role === 'choir') {
        interruptsHost =
          otherMeta.wordCount >= 3 ||
          otherMeta.wordCount > curMeta.wordCount ||
          (other.start <= cur.start - 0.12 && otherMeta.dur >= curMeta.dur * 1.15);
      } else if (curMeta.role === 'adlib' && otherMeta.role === 'lead') {
        interruptsHost =
          otherMeta.wordCount >= 3 ||
          (otherMeta.wordCount >= 2 &&
            (otherMeta.wordCount > curMeta.wordCount || other.start <= cur.start));
      }

      if (interruptsHost) {
        dropIndices.add(i);
        if (otherMeta.role === 'backing') {
          promoteBackingIndices.add(j);
        }
        break;
      }
    }
  }

  const keptPrimary = segments
    .map((seg, idx) => {
      if (dropIndices.has(idx)) return null;
      if (promoteBackingIndices.has(idx)) {
        return { ...seg, vocalRole: 'choir' as VocalRole };
      }
      return seg;
    })
    .filter((seg): seg is T => seg !== null);

  // Drop remaining backing-vocal echoes that overlap concurrent lead or choir segments
  const withoutBackingEchoes = keptPrimary.filter((seg, idx) => {
    const role = inferVocalRoleFromText(seg.text, seg.vocalRole);
    if (role !== 'backing') return true;
    const hasMainOverlap = keptPrimary.some((other, oIdx) => {
      if (oIdx === idx) return false;
      const oRole = inferVocalRoleFromText(other.text, other.vocalRole);
      if (oRole !== 'lead' && oRole !== 'choir') return false;
      const overlap = Math.min(seg.end, other.end) - Math.max(seg.start, other.start);
      return overlap >= 0.1;
    });
    return !hasMainOverlap;
  });

  return mergeSplitPhraseDuplicates(withoutBackingEchoes);
}

const WORSHIP_VOCAB_REPAIRS: Array<[RegExp, string]> = [
  [/\b(?:jireh|jirah|jyrah|gyrah|jiroh|jire|jireah)\b/gi, 'Jireh'],
  [/\b(?:jehovah|jehova|jahovah|jehowah)\b/gi, 'Jehovah'],
  [/\b(?:yahweh|yahway|yahwe|yahwah|yaweh|yawah)\b/gi, 'Yahweh'],
  [/\b(?:hallelujah|h?allelu[iy]ah?|haleluj[ao]h?|h?alleluj?ah?|hallalujah)\b/gi, 'Hallelujah'],
  [/\b(?:hosanna|hosana|hozanna|hosanah)\b/gi, 'Hosanna'],
  [/\b(?:elohim|elohiem|eloheem|elohym)\b/gi, 'Elohim'],
  [/\b(?:adonai|adonay|adonayh|adonaiy)\b/gi, 'Adonai'],
];

export function repairWorshipVocabulary(text: string): string {
  let out = text;
  for (const [pattern, replacement] of WORSHIP_VOCAB_REPAIRS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Parses numeric seconds OR clock strings ("MM:SS.cc", "M:SS", "HH:MM:SS.cc") into seconds.
 */
export function parseFlexibleTimestamp(value: unknown, maxDurationHint?: number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/[\[\]()]/g, '');
  if (!trimmed) return null;

  // Plain decimal seconds string e.g. "14.28" or "14,28"
  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    const n = Number(trimmed.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // HH:MM:SS(.frac) or MM:SS(.frac) or MM:SS:cc
  const hms = trimmed.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,:](\d{1,3}))?$/);
  if (hms) {
    const hours = hms[1] ? parseInt(hms[1], 10) : 0;
    const mins = parseInt(hms[2], 10);
    const secs = parseInt(hms[3], 10);
    const frac = hms[4] ? parseInt(hms[4], 10) / Math.pow(10, hms[4].length) : 0;

    // If formatted as MM:SS:cc (3 colon parts without dot) on a sub-hour track, treat parts as mins:secs.cc
    if (hms[1] && !hms[4] && mins < 60 && hours < 60) {
      const asHours = hours * 3600 + mins * 60 + secs;
      const limit = Number.isFinite(maxDurationHint) && (maxDurationHint ?? 0) > 0 ? (maxDurationHint as number) : 3600;
      if (asHours > limit * 1.05 && limit < 3600) {
        return Number((hours * 60 + mins + secs / 100).toFixed(3));
      }
    }

    if (secs < 60 && mins < 600) {
      return Number((hours * 3600 + mins * 60 + secs + frac).toFixed(3));
    }
  }

  return null;
}

/**
 * Resolves the cleanest [start, end] pair from either "MM:SS.cc" strings or numeric fields.
 */
export function resolveSegmentTiming(
  seg: { start?: unknown; end?: unknown; startTime?: unknown; endTime?: unknown },
  fallbackStart: number,
  fallbackEnd: number,
  maxDuration: number
): { start: number; end: number; hasExplicitTiming: boolean } {
  const safeMax = Number.isFinite(maxDuration) && maxDuration > 0.5 ? maxDuration : 30;
  const clockStart = parseFlexibleTimestamp(seg.startTime, safeMax);
  const clockEnd = parseFlexibleTimestamp(seg.endTime, safeMax);
  const numStart = parseFlexibleTimestamp(seg.start, safeMax);
  const numEnd = parseFlexibleTimestamp(seg.end, safeMax);

  const chosenStart = clockStart ?? numStart;
  const chosenEnd = clockEnd ?? numEnd;
  const hasExplicitTiming = chosenStart !== null && chosenEnd !== null;

  const start = Number(
    Math.max(0, Math.min(safeMax - 0.35, chosenStart ?? fallbackStart)).toFixed(2)
  );
  const rawEnd = chosenEnd ?? Math.max(start + 1.2, fallbackEnd);
  const end = Number(
    Math.max(start + 0.35, Math.min(safeMax, rawEnd)).toFixed(2)
  );

  return { start, end, hasExplicitTiming };
}

/**
 * Strips optional ```json / ``` markdown fences and extracts JSON text cleanly.
 */
export function stripMarkdownJson(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '{}';
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(stripMarkdownJson(raw)) as T;
  } catch {
    return null;
  }
}

export function detectSectionFromMarker(marker: string): string | null {
  const lower = marker.trim().toLowerCase();
  if (lower.includes('pre-chorus') || lower.includes('pre chorus')) return 'pre-chorus';
  if (lower.includes('post-chorus') || lower.includes('post chorus')) return 'chorus';
  if (lower.includes('chorus') || lower.includes('hook') || lower.includes('refrain')) return 'chorus';
  if (lower.includes('bridge')) return 'bridge';
  if (lower.includes('intro')) return 'intro';
  if (lower.includes('outro') || lower.includes('ending') || lower.includes('fade out')) return 'outro';
  if (lower.includes('verse')) return 'verse';
  return null;
}

const PAREN_DIRECTION_RE =
  /\(\s*(?:intro|outro|ending|pre[-\s]?chorus|post[-\s]?chorus|chorus|verse|hook|refrain|bridge|instrumental(?:\s+break)?|(?:guitar|piano|synth|drum|bass|sax|violin|organ)?\s*solo|break|breakdown|interlude|build(?:\s*-?\s*up)?|drop|fade\s*(?:in|out)|end|music|beat|spoken(?:\s+word)?|whispered|applause|silence|choir|vocals?)(?:\s*[-#\d][^)]*)?\s*\)/gi;

const LEADING_SECTION_COLON_RE =
  /^(?:intro|outro|ending|pre[-\s]?chorus|post[-\s]?chorus|chorus|verse|hook|refrain|bridge|instrumental|solo|style|prompt|title|lyrics|vocals|mood|genre|tempo|bpm)(?:\s*\d+)?\s*:\s*/i;

const STANDALONE_DIRECTION_RE =
  /^(?:intro|outro|ending|pre[-\s]?chorus|post[-\s]?chorus|instrumental(?:\s+break)?|(?:guitar|piano|synth|drum|bass|sax|violin|organ)\s+solo|fade\s*(?:in|out)|spoken\s+word|applause|silence)(?:\s+\d+)?$/i;

const STANDALONE_NUMBERED_SECTION_RE =
  /^(?:verse|chorus|bridge|hook|refrain)\s*\d+$/i;

/**
 * Strips Suno / AI structural & musical prompt tags (e.g. [Intro], [Chorus],
 * [Verse 1: Acoustic Guitar], (Instrumental), Chorus:) as well as inline
 * bracketed backing vocals like "Your Jireh (Jireh)" -> "Your Jireh".
 * Standalone single-group parentheticals like "(Jireh)" preserve their text
 * briefly so inferVocalRoleFromText can detect legacy backing-role hints before
 * formatLyricForVocalRole strips outer parentheses cleanly.
 */
export function cleanLyricSegmentText(rawText: string): {
  text: string;
  detectedSection: string | null;
} {
  let detectedSection: string | null = null;
  let working = (rawText || '').trim();
  if (!working) return { text: '', detectedSection: null };

  // Preserve explicit standalone [instrumental] cue verbatim when authored manually
  if (/^\[\s*instrumental\s*\]$/i.test(working)) {
    return { text: '[instrumental]', detectedSection: null };
  }

  // Inspect square bracket tags first for section metadata, then strip ALL [...] tags
  working = working.replace(/\[([^\]]*)\]/g, (_full, inner: string) => {
    const sec = detectSectionFromMarker(inner);
    if (sec) detectedSection = sec;
    return ' ';
  });

  // Inspect & strip parenthesized musical/structural directions like (Chorus) or (Guitar Solo)
  working = working.replace(PAREN_DIRECTION_RE, (full) => {
    const sec = detectSectionFromMarker(full.slice(1, -1));
    if (sec) detectedSection = sec;
    return ' ';
  });

  working = working.replace(/\s+/g, ' ').trim();

  // Strip leading colon labels like "Chorus: ..." or "Verse 1: ..." or "Style: ..."
  const colonMatch = working.match(LEADING_SECTION_COLON_RE);
  if (colonMatch) {
    const sec = detectSectionFromMarker(colonMatch[0]);
    if (sec) detectedSection = sec;
    working = working.slice(colonMatch[0].length).trim();
    // If it was a Suno metadata line like "Style: Afrobeats, 105 BPM" or "Prompt: ...", drop the whole line
    if (/^(?:style|prompt|tempo|bpm|genre|mood)\s*:/i.test(colonMatch[0])) {
      return { text: '', detectedSection };
    }
  }

  // Strip inline parenthesized backing vocals / ad-libs whenever surrounding words exist,
  // e.g. "Your Jireh (Jireh)" -> "Your Jireh" or "Hold on tight (oh yeah)" -> "Hold on tight".
  if (working.includes('(') && working.includes(')')) {
    const withoutParens = working.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (withoutParens.length > 0) {
      working = withoutParens.replace(/\s+([,.;!?])/g, '$1').trim();
    }
  }

  // Drop lines that are purely standalone structural directives
  if (
    !working ||
    STANDALONE_DIRECTION_RE.test(working) ||
    STANDALONE_NUMBERED_SECTION_RE.test(working)
  ) {
    const sec = detectSectionFromMarker(working);
    if (sec) detectedSection = sec;
    return { text: '', detectedSection };
  }

  return { text: repairWorshipVocabulary(working), detectedSection };
}

/**
 * Recovers completed segment objects from partially truncated JSON (e.g. MAX_TOKENS cutoff).
 */
export function recoverSegmentsFromPartialJson(raw: string): RawTranscribedSegment[] {
  const cleaned = stripMarkdownJson(raw);
  const segKeyIdx = cleaned.search(/"segments"\s*:\s*\[/);
  if (segKeyIdx === -1) return [];
  const arrStart = cleaned.indexOf('[', segKeyIdx);
  if (arrStart === -1) return [];

  const out: RawTranscribedSegment[] = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = arrStart + 1; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const candidate = cleaned.slice(objStart, i + 1);
        objStart = -1;
        try {
          const parsed = JSON.parse(candidate) as {
            text?: string;
            section?: string;
            vocalRole?: unknown;
            confidence?: unknown;
            uncertain?: unknown;
            uncertainWords?: unknown;
            start?: unknown;
            end?: unknown;
            startTime?: unknown;
            endTime?: unknown;
            words?: RawWordCandidate[];
          };
          if (typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
            const { text: cleanText, detectedSection } = cleanLyricSegmentText(parsed.text);
            if (!cleanText) continue;
            const role = inferVocalRoleFromText(cleanText, parsed.vocalRole);
            const formattedText =
              role === 'backing' ? formatLyricForVocalRole(cleanText, 'backing') : cleanText;
            const s =
              parseFlexibleTimestamp(parsed.startTime) ??
              parseFlexibleTimestamp(parsed.start) ??
              out.length * 2.5;
            const e =
              parseFlexibleTimestamp(parsed.endTime) ??
              parseFlexibleTimestamp(parsed.end) ??
              s + 2.2;
            const safeEnd = Math.max(s + 0.35, e);
            const uncertainWords = Array.isArray(parsed.uncertainWords)
              ? parsed.uncertainWords.filter((w): w is string => typeof w === 'string')
              : undefined;
            const alignedWords = alignWordsToCleanText(
              formattedText,
              parsed.words,
              s,
              safeEnd,
              uncertainWords
            );
            const conf =
              typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
                ? parsed.confidence
                : undefined;
            const isUncertain =
              Boolean(parsed.uncertain) ||
              (conf !== undefined && conf < 0.72) ||
              Boolean(alignedWords?.some((w) => w.uncertain));
            out.push({
              lineIndex: out.length,
              text: formattedText,
              section:
                typeof parsed.section === 'string' && parsed.section.trim()
                  ? parsed.section
                  : detectedSection || 'verse',
              vocalRole: role,
              start: s,
              end: safeEnd,
              ...(conf !== undefined ? { confidence: conf } : {}),
              ...(isUncertain ? { uncertain: true } : {}),
              ...(uncertainWords && uncertainWords.length > 0 ? { uncertainWords } : {}),
              ...(alignedWords && alignedWords.length > 0 ? { words: alignedWords } : {}),
            });
          }
        } catch {
          // Ignore malformed partial object
        }
      }
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }

  return out;
}

/**
 * Normalizes audio MIME types to clean IANA subtypes supported by Gemini multimodal audio.
 */
export function normalizeAudioMimeType(mimeType?: string, fileName?: string): string {
  const lower = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (lower === 'audio/mpeg' || lower === 'audio/mp3' || lower === 'audio/mpeg3') {
    return 'audio/mp3';
  }
  if (lower === 'audio/x-wav' || lower === 'audio/wave' || lower === 'audio/wav') {
    return 'audio/wav';
  }
  if (lower === 'audio/x-m4a' || lower === 'audio/m4a' || lower === 'audio/mp4') {
    return 'audio/mp4';
  }
  if (lower === 'audio/aac' || lower === 'audio/ogg' || lower === 'audio/flac' || lower === 'audio/webm') {
    return lower;
  }

  const ext = (fileName || '').toLowerCase().split('.').pop() || '';
  if (ext === 'mp3') return 'audio/mp3';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'webm') return 'audio/webm';
  return 'audio/wav';
}

export function isNoVocalsTranscript(raw: string): boolean {
  const cleaned = (raw || '').trim();
  if (!cleaned) return true;
  if (/^no[_\s-]*vocals?\.?$/i.test(cleaned)) return true;
  if (
    cleaned.length < 140 &&
    /\b(no vocals|no singing|purely instrumental|instrumental only|no spoken words|no speech detected)\b/i.test(
      cleaned
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Converts plain transcribed lyrics (supporting optional [Verse]/[Chorus] headers and [mm:ss.xx] LRC tags)
 * into clean timed lyric segments when structured timestamp alignment is unavailable.
 */
export function parseTranscriptToSegments(
  rawTranscript: string,
  totalDuration: number
): RawTranscribedSegment[] {
  if (!rawTranscript || isNoVocalsTranscript(rawTranscript)) return [];

  const safeDur = Number.isFinite(totalDuration) && totalDuration > 0.5 ? totalDuration : 30;
  const rows = rawTranscript
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);

  let currentSection = 'verse';
  const collected: Array<{ text: string; section: string; explicitTime: number | null }> = [];

  for (const row of rows) {
    // Check LRC timestamp prefix first so `[00:14.28] [Chorus] Sing loud` parses both time and section tag
    let explicitTime: number | null = null;
    let body = row;
    const lrcMatch = row.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (lrcMatch) {
      const mins = parseInt(lrcMatch[1], 10);
      const secs = parseInt(lrcMatch[2], 10);
      const frac = lrcMatch[3]
        ? parseInt(lrcMatch[3], 10) / Math.pow(10, lrcMatch[3].length)
        : 0;
      explicitTime = mins * 60 + secs + frac;
      body = (lrcMatch[4] || '').trim();
    }

    const { text: cleanText, detectedSection } = cleanLyricSegmentText(body);
    if (detectedSection) {
      currentSection = detectedSection;
    }

    if (!cleanText) {
      continue;
    }

    collected.push({ text: cleanText, section: currentSection, explicitTime });
  }

  if (collected.length === 0) return [];

  const hasExplicit = collected.filter((c) => c.explicitTime !== null).length >= Math.max(1, Math.floor(collected.length / 2));

  if (hasExplicit) {
    return collected.map((item, idx) => {
      const start = item.explicitTime ?? (idx / collected.length) * safeDur;
      const nextTime = collected[idx + 1]?.explicitTime;
      const end =
        nextTime !== null && nextTime !== undefined
          ? Math.max(start + 0.35, Math.min(safeDur, nextTime - 0.05))
          : Math.min(safeDur, start + Math.max(1.2, (safeDur - start) / Math.max(1, collected.length - idx)));
      return {
        lineIndex: idx,
        text: item.text,
        section: item.section,
        start: Number(Math.max(0, start).toFixed(2)),
        end: Number(Math.max(start + 0.35, end).toFixed(2)),
      };
    });
  }

  const slot = safeDur / collected.length;
  return collected.map((item, idx) => {
    const start = Number((idx * slot).toFixed(2));
    const end = Number(Math.min(safeDur, (idx + 1) * slot - Math.min(0.08, slot * 0.1)).toFixed(2));
    return {
      lineIndex: idx,
      text: item.text,
      section: item.section,
      start,
      end: Math.max(Number((start + 0.35).toFixed(2)), end),
    };
  });
}

/**
 * Checks whether a new chunk segment duplicates the tail of already-accepted segments
 * across an overlapping audio window seam.
 */
export function isOverlappingDuplicateSegment(
  existing: Array<{ text?: string; start?: number; end?: number; vocalRole?: VocalRole }>,
  candidate: { text?: string; start?: number; vocalRole?: VocalRole },
  overlapWindowEndSec: number
): boolean {
  if (existing.length === 0) return false;
  const absStart = candidate.start;
  if (absStart === undefined || !Number.isFinite(absStart)) return false;

  const curTokens = tokenizeNormalizedWords(String(candidate.text ?? ''));
  if (curTokens.length === 0) return false;

  const curRole = inferVocalRoleFromText(String(candidate.text ?? ''), candidate.vocalRole);

  // Check last 4 accepted segments that fall near the overlap seam.
  // Never drop a segment with genuinely different lyrics, a distinct vocal role
  // (e.g. Lead vs Backing echo "(Jireh)"), or a newly repeated phrase sung after the previous ended.
  const tail = existing.slice(-4);
  for (const prev of tail) {
    const prevRole = inferVocalRoleFromText(String(prev.text ?? ''), prev.vocalRole);
    if (prevRole !== curRole) {
      continue;
    }

    const prevTokens = tokenizeNormalizedWords(String(prev.text ?? ''));
    if (prevTokens.length === 0) continue;

    const overlapCount = curTokens.filter((t) =>
      prevTokens.some((pt) => fuzzyWordMatch(t, pt))
    ).length;
    const textSimilarity = overlapCount / curTokens.length;
    if (textSimilarity < 0.6) {
      continue;
    }

    const prevEnd = prev.end;
    const prevStart = prev.start;
    if (Number.isFinite(prevEnd) && absStart < (prevEnd as number) - 0.15) {
      return true;
    }
    if (Number.isFinite(prevStart) && Math.abs(absStart - (prevStart as number)) <= 1.6) {
      return true;
    }
    if (
      Number.isFinite(prevEnd) &&
      absStart <= overlapWindowEndSec &&
      absStart - (prevEnd as number) <= 0.65
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Aligns AI-returned word-level timestamps to the cleaned lyric text even when
 * structural tags (like [Chorus] or Verse 1:) were stripped from the segment string.
 * Returns monotonic clamped word timings if alignment is clean, or undefined to let
 * acoustic onset analysis synthesize word boundaries.
 */
export function alignWordsToCleanText(
  cleanText: string,
  rawWords: RawWordCandidate[] | undefined,
  lineStart: number,
  lineEnd: number,
  uncertainWords?: string[]
): Array<{ text: string; start: number; end: number; confidence?: number; uncertain?: boolean }> | undefined {
  const cleanTokens = cleanText.trim().split(/\s+/).filter(Boolean);
  if (cleanTokens.length === 0 || !Array.isArray(rawWords) || rawWords.length === 0) {
    return undefined;
  }

  const uncertainLookup = new Set(
    (uncertainWords ?? [])
      .map((w) => normalizeMultilingualToken(w))
      .filter(Boolean)
  );

  const safeStart = Number.isFinite(lineStart) ? Math.max(0, lineStart) : 0;
  const safeEnd = Number.isFinite(lineEnd) ? Math.max(safeStart + 0.15, lineEnd) : safeStart + 1.0;

  interface ParsedWord {
    text: string;
    start: number;
    end: number;
    confidence?: number;
    uncertain?: boolean;
  }

  const expanded: ParsedWord[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  for (const rw of rawWords) {
    if (!rw || typeof rw.text !== 'string') continue;
    const rawStr = rw.text.trim();
    if (!rawStr) continue;

    // Skip multi-token parenthesized or bracketed backing vocal / structural spans like ["(oh", "yeah)"]
    const opensParen = (rawStr.match(/\(/g) || []).length;
    const closesParen = (rawStr.match(/\)/g) || []).length;
    const opensBracket = (rawStr.match(/\[/g) || []).length;
    const closesBracket = (rawStr.match(/\]/g) || []).length;

    if (parenDepth > 0 || bracketDepth > 0 || rawStr.startsWith('(') || rawStr.startsWith('[')) {
      parenDepth = Math.max(0, parenDepth + opensParen - closesParen);
      bracketDepth = Math.max(0, bracketDepth + opensBracket - closesBracket);
      if (
        rawStr.startsWith('(') ||
        rawStr.startsWith('[') ||
        parenDepth > 0 ||
        bracketDepth > 0 ||
        rawStr.endsWith(')') ||
        rawStr.endsWith(']')
      ) {
        continue;
      }
    }

    const cleanedWord = stripOuterParentheses(cleanLyricSegmentText(rawStr).text);
    if (!cleanedWord) continue;

    const ws =
      parseFlexibleTimestamp(rw.startTime, safeEnd + 60) ??
      parseFlexibleTimestamp(rw.start, safeEnd + 60);
    const we =
      parseFlexibleTimestamp(rw.endTime, safeEnd + 60) ??
      parseFlexibleTimestamp(rw.end, safeEnd + 60);

    if (ws === null && we === null) continue;
    const wStart = ws ?? Math.max(safeStart, (we as number) - 0.25);
    const wEnd = we ?? Math.min(safeEnd, wStart + 0.25);
    const wConf =
      typeof rw.confidence === 'number' && Number.isFinite(rw.confidence)
        ? rw.confidence
        : undefined;
    const wUncertain = Boolean(rw.uncertain) || (wConf !== undefined && wConf < 0.72);

    const subTokens = cleanedWord.split(/\s+/).filter(Boolean);
    if (subTokens.length === 1) {
      expanded.push({
        text: subTokens[0],
        start: wStart,
        end: Math.max(wStart + 0.03, wEnd),
        ...(wConf !== undefined ? { confidence: wConf } : {}),
        ...(wUncertain ? { uncertain: true } : {}),
      });
    } else {
      const span = Math.max(0.06 * subTokens.length, wEnd - wStart);
      const step = span / subTokens.length;
      for (let k = 0; k < subTokens.length; k++) {
        expanded.push({
          text: subTokens[k],
          start: wStart + k * step,
          end: wStart + (k + 1) * step,
          ...(wConf !== undefined ? { confidence: wConf } : {}),
          ...(wUncertain ? { uncertain: true } : {}),
        });
      }
    }
  }

  // Reconcile minor contraction/split mismatches (e.g. "You're" vs ["You", "'re"] or French ["L'", "amour"]) instead of dropping all AI timings
  if (expanded.length !== cleanTokens.length && expanded.length > 0 && cleanTokens.length > 0) {
    const norm = (s: string) => normalizeMultilingualToken(s);
    const reconciled: ParsedWord[] = [];
    let ei = 0;
    let failed = false;

    for (let ci = 0; ci < cleanTokens.length; ci++) {
      if (ei >= expanded.length) {
        failed = true;
        break;
      }
      const targetNorm = norm(cleanTokens[ci]);
      const cur = expanded[ei];
      if (norm(cur.text) === targetNorm || cleanTokens.length === expanded.length) {
        reconciled.push(cur);
        ei++;
      } else if (
        ei + 1 < expanded.length &&
        norm(cur.text + expanded[ei + 1].text) === targetNorm
      ) {
        // Merge split contraction tokens like ["You", "'re"] -> "You're"
        const nextW = expanded[ei + 1];
        reconciled.push({
          text: cleanTokens[ci],
          start: cur.start,
          end: Math.max(cur.end, nextW.end),
          ...(cur.confidence !== undefined || nextW.confidence !== undefined
            ? { confidence: Math.min(cur.confidence ?? 1, nextW.confidence ?? 1) }
            : {}),
          ...(cur.uncertain || nextW.uncertain ? { uncertain: true } : {}),
        });
        ei += 2;
      } else if (Math.abs(expanded.length - cleanTokens.length) <= 1) {
        reconciled.push(cur);
        ei++;
      } else {
        failed = true;
        break;
      }
    }

    if (!failed && reconciled.length === cleanTokens.length) {
      expanded.splice(0, expanded.length, ...reconciled);
    }
  }

  if (expanded.length !== cleanTokens.length) {
    return undefined;
  }

  const minWordDur = Math.min(0.04, ((safeEnd - safeStart) / cleanTokens.length) * 0.5);
  const aligned: Array<{
    text: string;
    start: number;
    end: number;
    confidence?: number;
    uncertain?: boolean;
  }> = [];

  for (let i = 0; i < cleanTokens.length; i++) {
    const rawW = expanded[i];
    const prevStart = i > 0 ? aligned[i - 1].start + minWordDur : safeStart;
    const maxAllowedStart = safeEnd - (cleanTokens.length - i) * minWordDur;
    const wStart = Math.max(safeStart, prevStart, Math.min(maxAllowedStart, rawW.start));
    const nextCap = i < cleanTokens.length - 1 ? Math.max(wStart + minWordDur, expanded[i + 1].start) : safeEnd;
    const wEnd = Math.max(wStart + minWordDur, Math.min(safeEnd, nextCap, Math.max(wStart + minWordDur, rawW.end)));
    const tokenKey = normalizeMultilingualToken(cleanTokens[i]);
    const markedUncertain = rawW.uncertain || (tokenKey.length > 0 && uncertainLookup.has(tokenKey));

    aligned.push({
      text: cleanTokens[i],
      start: Number(wStart.toFixed(3)),
      end: Number(wEnd.toFixed(3)),
      ...(rawW.confidence !== undefined ? { confidence: rawW.confidence } : {}),
      ...(markedUncertain ? { uncertain: true } : {}),
    });
  }

  // Verify the word timings aren't collapsed into a single tiny sliver
  const coveredSpan = aligned[aligned.length - 1].end - aligned[0].start;
  const lineSpan = safeEnd - safeStart;
  if (cleanTokens.length >= 3 && lineSpan > 0.8 && coveredSpan < lineSpan * 0.25) {
    return undefined;
  }

  return aligned;
}

export interface ChunkOverlapDecision {
  action: 'append' | 'skip' | 'replace';
  replaceIndex?: number;
}

/**
 * Decides whether a candidate segment from a subsequent overlapping audio chunk
 * should be appended, skipped as an overlap duplicate, or replace a boundary-clipped
 * tail segment from the previous chunk when the new chunk captures more words.
 */
export function resolveChunkOverlapSegment(
  existing: Array<{ text?: string; start?: number; end?: number; vocalRole?: VocalRole }>,
  candidate: { text?: string; start?: number; end?: number; vocalRole?: VocalRole },
  overlapWindowEndSec: number
): ChunkOverlapDecision {
  if (existing.length === 0) return { action: 'append' };
  const absStart = candidate.start;
  if (absStart === undefined || !Number.isFinite(absStart)) return { action: 'append' };

  const normalizeWords = (txt: string) => tokenizeNormalizedWords(txt);

  const curTokens = normalizeWords(String(candidate.text ?? ''));
  if (curTokens.length === 0) return { action: 'skip' };

  const curRole = inferVocalRoleFromText(String(candidate.text ?? ''), candidate.vocalRole);

  const startIdx = Math.max(0, existing.length - 4);
  for (let idx = startIdx; idx < existing.length; idx++) {
    const prev = existing[idx];
    const prevRole = inferVocalRoleFromText(String(prev.text ?? ''), prev.vocalRole);
    // Distinct vocal layers (e.g. Lead vs Backing echo "(Jireh)") are NEVER treated as chunk duplicates
    if (prevRole !== curRole) {
      continue;
    }

    const prevTokens = normalizeWords(String(prev.text ?? ''));
    if (prevTokens.length === 0) continue;

    const overlapFromCur =
      curTokens.filter((t) => prevTokens.some((pt) => fuzzyWordMatch(t, pt))).length /
      curTokens.length;
    const overlapFromPrev =
      prevTokens.filter((t) => curTokens.some((ct) => fuzzyWordMatch(t, ct))).length /
      prevTokens.length;
    const maxOverlap = Math.max(overlapFromCur, overlapFromPrev);

    if (maxOverlap < 0.6) {
      continue;
    }

    const prevStart = prev.start;
    const prevEnd = prev.end;
    const nearSameStart =
      Number.isFinite(prevStart) && Math.abs(absStart - (prevStart as number)) <= 1.5;
    const overlapsTime =
      Number.isFinite(prevEnd) && absStart < (prevEnd as number) - 0.15;
    const tightSeamFollow =
      Number.isFinite(prevEnd) &&
      absStart <= overlapWindowEndSec &&
      absStart - (prevEnd as number) <= 0.65;

    if (nearSameStart || overlapsTime || tightSeamFollow) {
      // If the new chunk captured noticeably more words for the same boundary line, upgrade it
      // rather than splitting one sung sentence across two chunks.
      if (
        (nearSameStart || overlapsTime || tightSeamFollow) &&
        curTokens.length > prevTokens.length &&
        overlapFromPrev >= 0.7
      ) {
        return { action: 'replace', replaceIndex: idx };
      }
      return { action: 'skip' };
    }
  }

  // Also check if a boundary-split cue in the same vocal role overlaps temporally by >0.35s
  // inside the chunk overlap window with partial shared phrasing (>= 40%)
  for (let idx = startIdx; idx < existing.length; idx++) {
    const prev = existing[idx];
    const prevRole = inferVocalRoleFromText(String(prev.text ?? ''), prev.vocalRole);
    if (prevRole !== curRole) continue;
    const prevEnd = prev.end;
    if (!Number.isFinite(prevEnd) || absStart > overlapWindowEndSec) continue;
    const temporalOverlap = (prevEnd as number) - absStart;
    if (temporalOverlap <= 0.35) continue;

    const prevTokens = normalizeWords(String(prev.text ?? ''));
    if (prevTokens.length === 0) continue;
    const shared = curTokens.filter((t) => prevTokens.some((pt) => fuzzyWordMatch(t, pt))).length;
    const sharedRatio = shared / Math.min(curTokens.length, prevTokens.length);
    if (sharedRatio >= 0.4) {
      if (curTokens.length > prevTokens.length) {
        return { action: 'replace', replaceIndex: idx };
      }
      return { action: 'skip' };
    }
  }

  return { action: 'append' };
}


