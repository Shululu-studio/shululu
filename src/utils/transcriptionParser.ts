export interface RawTranscribedSegment {
  lineIndex: number;
  text: string;
  section: string;
  start: number;
  end: number;
  startTime?: string;
  endTime?: string;
  words?: Array<{ text: string; start: number; end: number }>;
}

/**
 * Parses numeric seconds OR clock strings ("MM:SS.cc", "M:SS", "HH:MM:SS.cc") into seconds.
 */
export function parseFlexibleTimestamp(value: unknown): number | null {
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

  // HH:MM:SS(.frac) or MM:SS(.frac)
  const hms = trimmed.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,:](\d{1,3}))?$/);
  if (hms) {
    const hours = hms[1] ? parseInt(hms[1], 10) : 0;
    const mins = parseInt(hms[2], 10);
    const secs = parseInt(hms[3], 10);
    const frac = hms[4] ? parseInt(hms[4], 10) / Math.pow(10, hms[4].length) : 0;
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
  const clockStart = parseFlexibleTimestamp(seg.startTime);
  const clockEnd = parseFlexibleTimestamp(seg.endTime);
  const numStart = parseFlexibleTimestamp(seg.start);
  const numEnd = parseFlexibleTimestamp(seg.end);

  const chosenStart = clockStart ?? numStart;
  const chosenEnd = clockEnd ?? numEnd;
  const hasExplicitTiming = chosenStart !== null && chosenEnd !== null;

  const safeMax = Number.isFinite(maxDuration) && maxDuration > 0.5 ? maxDuration : 30;
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
 * [Verse 1: Acoustic Guitar], (Instrumental), Chorus:) while extracting any
 * section hint and preserving legitimate sung parentheticals like (yeah).
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
  // (Suno puts style/structure/instrument prompts inside square brackets)
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

  return { text: working, detectedSection };
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
            start?: unknown;
            end?: unknown;
            startTime?: unknown;
            endTime?: unknown;
          };
          if (typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
            const { text: cleanText, detectedSection } = cleanLyricSegmentText(parsed.text);
            if (!cleanText) continue;
            const s =
              parseFlexibleTimestamp(parsed.startTime) ??
              parseFlexibleTimestamp(parsed.start) ??
              out.length * 2.5;
            const e =
              parseFlexibleTimestamp(parsed.endTime) ??
              parseFlexibleTimestamp(parsed.end) ??
              s + 2.2;
            out.push({
              lineIndex: out.length,
              text: cleanText,
              section:
                typeof parsed.section === 'string' && parsed.section.trim()
                  ? parsed.section
                  : detectedSection || 'verse',
              start: s,
              end: Math.max(s + 0.35, e),
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
  existing: Array<{ text?: string; start?: number; end?: number }>,
  candidate: { text?: string; start?: number },
  overlapWindowEndSec: number
): boolean {
  if (existing.length === 0) return false;
  const absStart = candidate.start;
  if (absStart === undefined || !Number.isFinite(absStart)) return false;

  const curTokens = String(candidate.text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (curTokens.length === 0) return false;

  // Check last 4 accepted segments that fall near the overlap seam.
  // Never drop a segment with genuinely different lyrics OR a newly repeated phrase
  // sung distinctly after the previous phrase ended.
  const tail = existing.slice(-4);
  for (const prev of tail) {
    const prevTokens = String(prev.text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    if (prevTokens.length === 0) continue;

    const prevTokenSet = new Set(prevTokens);
    const overlapCount = curTokens.filter((t) => prevTokenSet.has(t)).length;
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

