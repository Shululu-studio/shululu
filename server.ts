import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  alignWordsToCleanText,
  cleanLyricSegmentText,
  filterVocalSegmentsForCleanPresentation,
  formatLyricForVocalRole,
  inferVocalRoleFromText,
  isNoVocalsTranscript,
  normalizeAudioMimeType,
  parseFlexibleTimestamp,
  parseTranscriptToSegments,
  recoverSegmentsFromPartialJson,
  resolveSegmentTiming,
  safeParseJson,
} from './src/utils/transcriptionParser';
import type { VocalRole } from './src/types/editor';

function formatClockTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
}

const LANGUAGE_DIRECTIVES: Record<string, string> = {
  auto:
    'MULTILINGUAL AUTO-DETECTION & CODE-SWITCHING: Vocals may be sung in Swahili (Kiswahili), Shona (ChiShona), English, French (Français), Lingala, Yoruba, isiZulu, isiXhosa, isiNdebele, Luganda, Chichewa, Portuguese, Spanish, Arabic, Amharic, Hindi, Korean, Japanese, Chinese, or a MIX of languages in the same song or verse. Transcribe EVERY phrase verbatim in the exact language and standard script/orthography sung (e.g. French accents é/è/ê/à/ç & elisions like l\'amour/c\'est; Swahili words like Ametenda amani, Haleluya, Mungu, Nakushukuru; Shona words like Ndinotenda, Mutsvene, Mwari, Ishe, Ngakudzweni, Zvakanaka). NEVER translate lyrics into English and NEVER replace non-English words with English sound-alikes.',
  sw:
    'PRIMARY LANGUAGE — SWAHILI (KISWAHILI): Transcribe verbatim in authentic standard Kiswahili orthography (e.g. "Bwana Yesu", "Ametenda amani", "Haleluya", "Nakushukuru", "Umeinuliwa", "Mungu mwema", "Milele na milele"), preserving full agglutinative Bantu prefixes (a-me-tenda, ni-na-ku-shukuru, u-me-inuliwa) cleanly as whole words without breaking prefixes apart. If any verse switches into English, Shona, Lingala, or French, preserve those exact sung words without translating.',
  sn:
    'PRIMARY LANGUAGE — SHONA (CHISHONA): Transcribe verbatim in authentic standard ChiShona orthography (e.g. "Ndinotenda", "Mutsvene", "Mwari", "Ishe Jesu", "Ngakudzweni", "Zvakanaka", "Chokwadi", "Huya Mweya", "Mbiri kuna Mwari"). Preserve Shona prenasalized/digraph consonants (mb, nd, ng, nh, mh, sv, zv, tsv, dzv, pf, bh, vh, dh, ch, sh) accurately — NEVER alter Shona words into English or Swahili look-alikes. Preserve any English/Swahili/French code-switching verbatim.',
  en:
    'PRIMARY LANGUAGE — ENGLISH: Transcribe verbatim in natural English orthography (preserving contractions like You\'re, I\'ll, Don\'t). If the song mixes in non-English phrases (e.g. Swahili, Shona, French, Hebrew/Aramaic worship names), keep those original phrases verbatim without translating.',
  fr:
    'PRIMARY LANGUAGE — FRENCH (FRANÇAIS): Transcribe verbatim in standard French orthography with proper diacritics (é, è, ê, ë, à, â, ç, î, ï, ô, ù, û, œ) and authentic elisions/apostrophes (l\'amour, c\'est, j\'ai, d\'or, qu\'il, s\'il, n\'est, aujourd\'hui). Preserve any English or African-language code-switching verbatim without translating.',
  ln: 'PRIMARY LANGUAGE — LINGALA: Transcribe verbatim in authentic Lingala orthography (e.g. "Nzambe", "Nkolo Yesu", "Matondo", "Kembo", "Bolingo", "Lokumu") and preserve any French/Swahili/English code-switching verbatim.',
  yo: 'PRIMARY LANGUAGE — YORUBA: Transcribe verbatim in Yoruba orthography (preserving e/ẹ, o/ọ, s/ṣ and tonal marks when clear, e.g. "Oluwa", "Baba", "Oba", "Ese", "Kabiyesi") alongside any English code-switching.',
  zu: 'PRIMARY LANGUAGE — ISIZULU: Transcribe verbatim in standard isiZulu orthography (preserving clicks c/q/x and clusters hl/dl/kh/ph/th/ngc/nkc) without translating.',
  xh: 'PRIMARY LANGUAGE — ISIXHOSA: Transcribe verbatim in standard isiXhosa orthography (preserving clicks c/q/x and clusters xh/gx/nx/bh/dl/hl) without translating.',
  nd: 'PRIMARY LANGUAGE — ISINDEBELE: Transcribe verbatim in standard isiNdebele orthography alongside any Shona/English phrases without translating.',
  lg: 'PRIMARY LANGUAGE — LUGANDA: Transcribe verbatim in standard Luganda orthography (e.g. "Mukama", "Katonda", "Webale", "Yesu") without translating.',
  ny: 'PRIMARY LANGUAGE — CHICHEWA: Transcribe verbatim in standard Chichewa orthography (e.g. "Mulungu", "Ambuye", "Zikomo", "Yesu") without translating.',
  pt: 'PRIMARY LANGUAGE — PORTUGUESE: Transcribe verbatim in Portuguese with proper diacritics (ã, õ, ç, á, é, í, ó, ú, â, ê, ô).',
  es: 'PRIMARY LANGUAGE — SPANISH: Transcribe verbatim in Spanish with proper diacritics and punctuation (ñ, á, é, í, ó, ú, ü).',
  ar: 'PRIMARY LANGUAGE — ARABIC (العربية): Transcribe verbatim in natural Arabic script (العربية), never romanizing unless English words are explicitly sung.',
  am: 'PRIMARY LANGUAGE — AMHARIC (አማርኛ): Transcribe verbatim in native Ge\'ez/Amharic Fidel script (አማርኛ), never romanizing unless English is sung.',
  hi: 'PRIMARY LANGUAGE — HINDI (हिन्दी): Transcribe verbatim in standard Devanagari Hindi script (हिन्दी) or Hinglish only where English words are actually sung.',
  ko: 'PRIMARY LANGUAGE — KOREAN (한국어): Transcribe verbatim in standard Hangul script (한국어), preserving any sung English phrases verbatim.',
  ja: 'PRIMARY LANGUAGE — JAPANESE (日本語): Transcribe verbatim in natural Japanese script (Kanji/Hiragana/Katakana), preserving any sung English phrases verbatim.',
  zh: 'PRIMARY LANGUAGE — CHINESE (中文): Transcribe verbatim in natural Chinese characters (中文), preserving any sung English phrases verbatim.',
};

function buildLanguageDirective(language?: string): string {
  const code = typeof language === 'string' ? language.trim().toLowerCase() : 'auto';
  return LANGUAGE_DIRECTIVES[code] || LANGUAGE_DIRECTIVES.auto;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isQuotaOrRateLimitError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err || '');
  return raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || /quota|rate.?limit/i.test(raw);
}

function isAbortOrTimeoutError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') {
    return true;
  }
  const raw = err instanceof Error ? err.message : String(err || '');
  return /aborted|abort|timed out|timeout|ETIMEDOUT/i.test(raw);
}

function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Request failed');
  if (isQuotaOrRateLimitError(err)) {
    return 'Transcription quota limit reached. Try again shortly, or paste/import lyrics manually.';
  }
  if (isAbortOrTimeoutError(err)) {
    return 'Transcription request timed out on this audio segment. Retrying or using manual paste is available.';
  }
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message.split('\n')[0];
    }
  } catch {
    // plain message
  }
  return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
}

const PORT = Number(process.env.PORT) || 3000;

const LIBRARY_MANIFEST = {
  catalogVersion: '2026.11.1',
  checkedAt: new Date().toISOString(),
  packs: [
    {
      id: 'pack_worship_typography',
      title: 'Sanctuary & Acoustic Editorial Pack',
      category: 'typography-collections',
      version: '1.2.0',
      description:
        'Refined serif and humanist typography pairings calibrated for worship, gospel, and acoustic live sessions.',
      itemCount: 3,
      updatedAt: '2026-11-01',
      sizeLabel: '14 KB',
    },
    {
      id: 'pack_kinetic_transitions',
      title: 'Broadcast Kinetic Transitions',
      category: 'animation-presets',
      version: '1.4.0',
      description:
        'Smooth line crossfades, word-by-word reveals, and stage karaoke cue presets.',
      itemCount: 3,
      updatedAt: '2026-11-05',
      sizeLabel: '11 KB',
    },
    {
      id: 'pack_stage_gradients',
      title: 'Stage Lighting & Gradient Backdrops',
      category: 'background-templates',
      version: '1.1.0',
      description:
        'High-contrast obsidian, tungsten amber, and deep slate background templates with tuned scrims.',
      itemCount: 3,
      updatedAt: '2026-10-28',
      sizeLabel: '9 KB',
    },
    {
      id: 'pack_pro_editing_styles',
      title: 'Production Editing Presets',
      category: 'editing-presets',
      version: '1.3.0',
      description:
        'Complete typography + auto-effect + legibility bundles ready for 16:9, 9:16, and 1:1 release.',
      itemCount: 3,
      updatedAt: '2026-11-09',
      sizeLabel: '12 KB',
    },
  ],
};

const LIBRARY_PACKS: Record<string, unknown> = {
  pack_worship_typography: {
    id: 'pack_worship_typography',
    version: '1.2.0',
    category: 'typography-collections',
    title: 'Sanctuary & Acoustic Editorial Pack',
    presets: [
      {
        id: 'pre_cathedral_serif',
        name: 'Cathedral Serif',
        subtitle: 'Cormorant Garamond · Warm Ivory · Soft Drop Shadow',
        typography: {
          fontFamily: 'Cormorant Garamond',
          fontSize: 68,
          fontWeight: 600,
          color: '#FAF7F0',
          highlightColor: '#F59E0B',
          letterSpacing: 1.0,
          lineSpacing: 1.32,
          shadowBlur: 20,
          outlineWidth: 0,
        },
      },
      {
        id: 'pre_gospel_classic',
        name: 'Gospel Heritage',
        subtitle: 'Playfair Display · Crisp White · Gold Highlight',
        typography: {
          fontFamily: 'Playfair Display',
          fontSize: 62,
          fontWeight: 600,
          color: '#FFFFFF',
          highlightColor: '#FBBF24',
          letterSpacing: 0.4,
          lineSpacing: 1.3,
          shadowBlur: 18,
        },
      },
      {
        id: 'pre_hymnal_cinzel',
        name: 'Sanctuary Inscription',
        subtitle: 'Cinzel · Measured Tracking · Subtle Scrim',
        typography: {
          fontFamily: 'Cinzel',
          fontSize: 54,
          fontWeight: 600,
          color: '#F8FAFC',
          highlightColor: '#F59E0B',
          letterSpacing: 2.2,
          lineSpacing: 1.38,
        },
      },
    ],
  },
  pack_kinetic_transitions: {
    id: 'pack_kinetic_transitions',
    version: '1.4.0',
    category: 'animation-presets',
    title: 'Broadcast Kinetic Transitions',
    presets: [
      {
        id: 'pre_worship_flow',
        name: 'Worship Serene Flow',
        subtitle: 'Auto-assigns smooth fades on verses & karaoke on choruses',
        autoEffectStyle: 'worship-serene',
        effect: 'line-crossfade',
      },
      {
        id: 'pre_contemporary_lift',
        name: 'Contemporary Lift',
        subtitle: 'Upward slide settle paired with word-by-word choruses',
        autoEffectStyle: 'contemporary-clean',
        effect: 'slide-up',
      },
      {
        id: 'pre_stage_karaoke',
        name: 'Stage Karaoke Precision',
        subtitle: 'High-visibility word fill synced to vocal syllables',
        autoEffectStyle: 'dynamic-stage',
        effect: 'karaoke',
      },
    ],
  },
  pack_stage_gradients: {
    id: 'pack_stage_gradients',
    version: '1.1.0',
    category: 'background-templates',
    title: 'Stage Lighting & Gradient Backdrops',
    presets: [
      {
        id: 'pre_bg_tungsten',
        name: 'Tungsten Stage Mist',
        subtitle: 'Dark charcoal stage spotlight backdrop',
        background: {
          type: 'template',
          templateId: 'stage-amber',
          dimOverlay: 0.25,
          blur: 0,
          scale: 1,
        },
      },
      {
        id: 'pre_bg_twilight',
        name: 'Midnight Coastal Dusk',
        subtitle: 'Deep indigo twilight over calm horizon',
        background: {
          type: 'template',
          templateId: 'midnight-velvet',
          dimOverlay: 0.2,
          blur: 0,
          scale: 1,
        },
      },
      {
        id: 'pre_bg_amber_grad',
        name: 'Warm Obsidian Gradient',
        subtitle: 'Soft espresso-to-charcoal directional gradient',
        background: {
          type: 'gradient',
          gradientFrom: '#12100E',
          gradientTo: '#2E2319',
          gradientAngle: 150,
          dimOverlay: 0.12,
          blur: 0,
        },
      },
    ],
  },
  pack_pro_editing_styles: {
    id: 'pack_pro_editing_styles',
    version: '1.3.0',
    category: 'editing-presets',
    title: 'Production Editing Presets',
    presets: [
      {
        id: 'pre_edit_lyric_single',
        name: 'Contemporary Single Release',
        subtitle: 'Plus Jakarta Sans · Progressive Wipe · Midnight Horizon',
        autoEffectStyle: 'contemporary-clean',
        typography: {
          fontFamily: 'Plus Jakarta Sans',
          fontSize: 60,
          fontWeight: 700,
          color: '#F8FAFC',
          highlightColor: '#38BDF8',
          letterSpacing: -0.5,
          backgroundOpacity: 0,
        },
        background: {
          type: 'template',
          templateId: 'midnight-velvet',
          dimOverlay: 0.24,
        },
      },
      {
        id: 'pre_edit_lower_third',
        name: 'Broadcast Lower-Third Caption',
        subtitle: 'IBM Plex Sans · Backing Box · High Legibility',
        autoEffectStyle: 'minimal-editorial',
        typography: {
          fontFamily: 'IBM Plex Sans',
          fontSize: 48,
          fontWeight: 600,
          color: '#FFFFFF',
          highlightColor: '#60A5FA',
          positionX: 0.5,
          positionY: 0.8,
          backgroundColor: '#0B0D10',
          backgroundOpacity: 0.72,
          backgroundPadding: 18,
        },
      },
      {
        id: 'pre_edit_bold_stage',
        name: 'Arena Stage Bold',
        subtitle: 'Oswald · Crisp Outline · High Contrast Karaoke',
        autoEffectStyle: 'dynamic-stage',
        typography: {
          fontFamily: 'Oswald',
          fontSize: 74,
          fontWeight: 600,
          color: '#FFFFFF',
          highlightColor: '#F59E0B',
          letterSpacing: 1.5,
          outlineWidth: 2,
          outlineColor: '#090A0C',
          backgroundOpacity: 0,
          positionY: 0.5,
        },
      },
    ],
  },
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '48mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/library/manifest', (_req, res) => {
    res.json(LIBRARY_MANIFEST);
  });

  app.get('/api/library/pack/:packId', (req, res) => {
    const pack = LIBRARY_PACKS[req.params.packId];
    if (!pack) {
      return res.status(404).json({ error: 'Library pack not found' });
    }
    return res.json(pack);
  });

const modelCooldownUntil = new Map<string, number>();

function isModelReady(modelId: string): boolean {
  const until = modelCooldownUntil.get(modelId) ?? 0;
  return Date.now() >= until;
}

function markModelFailure(modelId: string, err: unknown): void {
  if (isQuotaOrRateLimitError(err)) {
    modelCooldownUntil.set(modelId, Date.now() + 20_000);
  }
}

function createAttemptSignal(
  timeoutMs: number,
  isClientClosed: () => boolean,
  onClientCloseRegister: (cb: () => void) => () => void
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Model call timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const unregister = onClientCloseRegister(() => {
    controller.abort(new Error('Client disconnected'));
  });
  if (isClientClosed()) {
    controller.abort(new Error('Client disconnected'));
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      unregister();
    },
  };
}

  app.post('/api/sync-lyrics', async (req, res) => {
    req.setTimeout(5 * 60_000);
    res.setTimeout(5 * 60_000);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(200).json({
        available: false,
        errorCode: 'MISSING_API_KEY',
        reason: 'Server vocal alignment key is not configured; using local acoustic alignment.',
      });
    }

    let clientClosed = false;
    const closeListeners = new Set<() => void>();
    res.on('close', () => {
      if (!res.writableFinished) {
        clientClosed = true;
        closeListeners.forEach((cb) => cb());
      }
    });
    const onClientClose = (cb: () => void) => {
      closeListeners.add(cb);
      return () => closeListeners.delete(cb);
    };

    try {
      const { audioBase64, mimeType, duration, lines, isWindowedClip, clipStartSec, language } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        duration?: number;
        lines?: Array<{ index: number; text: string }>;
        isWindowedClip?: boolean;
        clipStartSec?: number;
        language?: string;
      };

      if (!audioBase64 || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({
          available: false,
          reason: 'Missing audio payload or lyric lines.',
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: 120_000,
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const normalizedMime = normalizeAudioMimeType(mimeType);
      const safeDuration = Number.isFinite(duration) && (duration ?? 0) > 0 ? (duration as number) : 30;
      const totalClock = formatClockTime(safeDuration);
      const lineList = lines.map((l) => `${l.index}: ${l.text}`).join('\n');
      const languageDirective = buildLanguageDirective(language);
      const clipOffsetLabel =
        isWindowedClip && Number.isFinite(clipStartSec)
          ? ` (clip starting at track position ${formatClockTime(clipStartSec as number)})`
          : '';
      const syncSystemInstruction = isWindowedClip
        ? `You are a precision multilingual vocal-to-lyric forced alignment engine. You are given a specific audio clip from a longer track and candidate numbered lyric lines (which may be in Swahili, Shona, English, French, or any world/mixed language, and may include Lead, Backing, Choir, or Ad-lib cues). Align ONLY the numbered candidate lines that are actually sung inside THIS audio clip using clip-relative timestamps from 00:00.00 to the clip end. Anchor startTime at the very first audible consonant, breath pickup, or vowel onset, and hold endTime through the COMPLETE vocal decay of held notes and sustained vowels (Eeeeeh, Ooooooh, Ahhhhh)—NEVER end early while the singer is still sustaining a note.\n${languageDirective}`
        : `You are a precision multilingual vocal-to-lyric forced alignment engine for sung worship and studio music in any language (including Swahili, Shona, English, French, African, European, Arabic, Asian, and mixed-language songs, up to 10 minutes). Align every provided line index (0-based) to exact hundredth-of-a-second clock timestamps (MM:SS.cc and decimal seconds). Anchor startTime right at the very first audible consonant, breath pickup, or vowel onset, and hold endTime until the singer completely finishes pronouncing the final syllable or sustained vowel note (Eeeeeh, Ooooooh, Ahhhhh)—NEVER cut off early while singing continues. Allow simultaneous overlapping lead and backing/choir lines to share overlapping timestamps when sung together.\n${languageDirective}`;
      const promptText = isWindowedClip
        ? `Clip duration: ${safeDuration.toFixed(2)} seconds (${totalClock})${clipOffsetLabel}.
${languageDirective}
Listen carefully to every sung vocal line, consonant, backing echo, and sustained vowel inside THIS clip from 00:00.00 to ${totalClock}.
Some candidate lines below may occur before or after this clip window — align ONLY the candidate line indices you actually hear sung in THIS clip, using timestamps relative to the start of THIS clip (0.00 to ${safeDuration.toFixed(2)}). Omit lines not sung in this clip.
If a backing vocal line overlaps a lead vocal line, give each line its own true start and end times even when they overlap.
Provide BOTH:
- "startTime" and "endTime" in "MM:SS.cc" format relative to clip start (e.g. "00:14.28")
- "start" and "end" in decimal seconds relative to clip start (0.00 to ${safeDuration.toFixed(2)})
Also provide accurate word-level start/end times in clip-relative seconds, holding each word until the singer finishes pronouncing or sustaining it, and keep each word's "text" faithful to the candidate line spelling/script.
Only set "vocalsDetected" to false if this clip has zero sung lyrics matching any candidate line.

Candidate lyric lines (keep exact 0-based lineIndex):
${lineList}`
        : `Audio duration: ${safeDuration.toFixed(2)} seconds (${totalClock}).
${languageDirective}
Listen carefully to lead vocals, backing vocals, choir harmonies, ad-libs, and sustained vowel notes ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm") across the entire duration from 00:00 to ${totalClock}.
Align EVERY numbered lyric line below (${lines.length} lines, indices 0 to ${lines.length - 1}) to the exact instant the first sound of that line begins AND hold endTime until the complete vocal pronunciation or held vowel fades out (never cut off held notes early). Preserve overlapping timestamps when lead and backing/choir vocals overlap.
Provide BOTH:
- "startTime" and "endTime" in "MM:SS.cc" format (e.g. "00:14.28", hundredths of a second)
- "start" and "end" in decimal seconds (e.g. 14.28)
Also provide word-level start/end times in seconds matching each candidate line's words/script, keeping each word active throughout its full sung duration.
Only set "vocalsDetected" to false if the audio has zero vocals matching these lyrics.

Lyric lines (0-based index):
${lineList}`;

      const candidates = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].filter(isModelReady);
      const modelOrder = candidates.length > 0 ? candidates : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

      let responseText = '';
      let lastErrorMsg: string | null = null;
      let sawQuotaError = false;

      for (const modelId of modelOrder) {
        if (clientClosed) break;
        const attempt = createAttemptSignal(85_000, () => clientClosed, onClientClose);
        try {
          const response = await ai.models.generateContent({
            model: modelId,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: normalizedMime,
                    data: audioBase64,
                  },
                },
                { text: promptText },
              ],
            },
            config: {
              abortSignal: attempt.signal,
              systemInstruction: syncSystemInstruction,
              thinkingConfig: {
                thinkingLevel: modelId === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
              },
              maxOutputTokens: 16384,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  vocalsDetected: { type: Type.BOOLEAN },
                  notes: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  segments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        lineIndex: { type: Type.INTEGER },
                        startTime: { type: Type.STRING },
                        endTime: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        words: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              text: { type: Type.STRING },
                              start: { type: Type.NUMBER },
                              end: { type: Type.NUMBER },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          });
          responseText = response.text ?? '{}';
          lastErrorMsg = null;
          sawQuotaError = false;
          break;
        } catch (err) {
          if (clientClosed) break;
          markModelFailure(modelId, err);
          if (isQuotaOrRateLimitError(err)) sawQuotaError = true;
          lastErrorMsg = formatGeminiError(err);
          console.warn(`[sync-lyrics] ${modelId} alignment fallback:`, lastErrorMsg);
        } finally {
          attempt.cleanup();
        }
      }

      if (clientClosed) return;

      if (lastErrorMsg !== null) {
        console.warn('[sync-lyrics] All alignment models failed:', lastErrorMsg);
        return res.status(200).json({
          available: false,
          errorCode: sawQuotaError ? 'QUOTA_EXHAUSTED' : 'MODEL_ERROR',
          reason: `Online alignment unavailable (${lastErrorMsg}); falling back to local acoustic analysis.`,
        });
      }

      interface RawSyncSeg {
        lineIndex?: number;
        startTime?: unknown;
        endTime?: unknown;
        start?: unknown;
        end?: unknown;
        words?: Array<{ text?: string; start?: unknown; end?: unknown }>;
      }

      const parsed = safeParseJson<{
        vocalsDetected?: boolean;
        notes?: string[];
        segments?: RawSyncSeg[];
      }>(responseText) ?? {};

      const rawSegs = Array.isArray(parsed.segments) ? parsed.segments : [];
      const cleanSegments = rawSegs
        .filter((s) => typeof s.lineIndex === 'number')
        .map((s) => {
          const idx = s.lineIndex as number;
          const fallbackStart = (idx / Math.max(1, lines.length)) * safeDuration;
          const { start, end } = resolveSegmentTiming(
            s,
            fallbackStart,
            fallbackStart + 2.0,
            safeDuration
          );
          const cleanWords = Array.isArray(s.words)
            ? s.words
                .filter((w) => typeof w.text === 'string' && w.text.trim().length > 0)
                .map((w) => {
                  const ws = parseFlexibleTimestamp(w.start) ?? start;
                  const we = parseFlexibleTimestamp(w.end) ?? Math.min(end, ws + 0.35);
                  return {
                    text: (w.text as string).trim(),
                    start: Number(Math.max(start, Math.min(end - 0.04, ws)).toFixed(3)),
                    end: Number(Math.max(start + 0.04, Math.min(end, we)).toFixed(3)),
                  };
                })
            : undefined;
          return {
            lineIndex: idx,
            start,
            end,
            ...(cleanWords && cleanWords.length > 0 ? { words: cleanWords } : {}),
          };
        });

      return res.json({
        available: true,
        vocalsDetected: Boolean(parsed.vocalsDetected),
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        segments: cleanSegments,
      });
    } catch (err) {
      const message = formatGeminiError(err);
      console.warn('[sync-lyrics] Gemini alignment error:', message);
      return res.status(200).json({
        available: false,
        reason: `Online alignment unavailable (${message}); falling back to local acoustic analysis.`,
      });
    }
  });

  app.post('/api/transcribe-lyrics', async (req, res) => {
    req.setTimeout(5 * 60_000);
    res.setTimeout(5 * 60_000);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(200).json({
        available: false,
        errorCode: 'MISSING_API_KEY',
        reason: 'Auto Transcribe requires GEMINI_API_KEY in Settings > Secrets, or paste/import lyrics manually.',
      });
    }

    let clientClosed = false;
    const closeListeners = new Set<() => void>();
    res.on('close', () => {
      if (!res.writableFinished) {
        clientClosed = true;
        closeListeners.forEach((cb) => cb());
      }
    });
    const onClientClose = (cb: () => void) => {
      closeListeners.add(cb);
      return () => closeListeners.delete(cb);
    };

    try {
      const { audioBase64, mimeType, duration, language } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        duration?: number;
        language?: string;
      };
      const languageDirective = buildLanguageDirective(language);

      if (!audioBase64) {
        return res.status(400).json({
          available: false,
          reason: 'Missing audio payload.',
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          timeout: 120_000,
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const normalizedMime = normalizeAudioMimeType(mimeType);
      const audioPart = {
        inlineData: {
          mimeType: normalizedMime,
          data: audioBase64,
        },
      };

      const safeDuration = Number.isFinite(duration) && (duration ?? 0) > 0 ? (duration as number) : 30;
      const isPromptEcho = (text: string) =>
        /^(listen carefully|audio duration:|transcribed lyrics:|no_vocals\b|total duration:|you are an expert)/i.test(
          text.trim()
        );

      interface StructuredWord {
        text?: string;
        startTime?: unknown;
        endTime?: unknown;
        start?: unknown;
        end?: unknown;
        confidence?: number;
        uncertain?: boolean;
      }

      interface StructuredSegment {
        lineIndex?: number;
        text?: string;
        section?: string;
        vocalRole?: VocalRole | string;
        startTime?: unknown;
        endTime?: unknown;
        start?: unknown;
        end?: unknown;
        confidence?: number;
        uncertain?: boolean;
        uncertainWords?: string[];
        words?: StructuredWord[];
      }

      interface StructuredTranscriptionResult {
        vocalsDetected?: boolean;
        segments?: StructuredSegment[];
      }

      const totalClock = formatClockTime(safeDuration);

      const singlePassSystemInstruction =
        'You are a precision multilingual verbatim vocal transcriber, vocal-role separator, and word-level lyric aligner specializing in Swahili, Shona, English, French, Gospel/African & contemporary worship, and world studio music.\n' +
        `LANGUAGE & ORTHOGRAPHY RULE:\n${languageDirective}\n` +
        'CRITICAL ACCURACY RULES:\n' +
        '1. Preserve Gospel & worship names accurately: Jireh, Jehovah, Yahweh, Hallelujah (or Swahili "Haleluya" when sung as Haleluya), Hosanna, Elohim, Adonai — NEVER substitute unrelated sound-alike English words for Swahili, Shona, French, or other non-English vocals.\n' +
        '2. NEVER skip short pickup words in ANY language ("I", "you", "the", "a", "and", "na", "wa", "ya", "kwa", "ne", "ku", "et", "le", "la", "de", "un"), repeated choruses, or sustained vowel vocalizations ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm", "Woooh").\n' +
        '3. IGNORE BRIEF 1–2 WORD LEADER INTERJECTIONS OVER BACKING/CHOIR VOCALS: When backing vocals or the choir are singing a phrase and the lead singer cuts in with a short 1- or 2-word interjection, hype call, or spoken filler (e.g. "Come on", "Sing", "Yes Lord", "Amen", "Yeah", "Haya", "Piga makofi", "Allez", "Chantez"), DO NOT write or emit that 1–2 word interjection—keep ONLY the backing/choir sung lyrics.\n' +
        '4. NO SECONDARY SMALL BACKING ECHO LINES UNDERNEATH: Do NOT emit separate "backing" vocal echo segments underneath main lead or choir lyrics (e.g. do not output an extra backing line "(Jireh)" / "Jireh" below "Your Jireh"). Only output primary sung phrases with vocalRole "lead" or "choir". When choir/backing carries the main sung verse or chorus on their own, tag that main phrase as "choir" (or "lead") so it displays cleanly.\n' +
        '5. NEVER SPLIT OR DUPLICATE PARTIAL WORDS / FALSE STARTS BEFORE A SENTENCE: When a singer articulates or sustains the opening word of a phrase (especially Swahili/Shona/Bantu agglutinative words like "Ametenda amani", "Nakushukuru", "Umeinuliwa", "Ndinotenda", "Ngakudzweni"), NEVER output a broken half-word or near-duplicate cue right before the full sentence (e.g. NEVER emit "amtenda" as one segment and then "ametenda amani" as a second segment). Output ONE complete, clean segment "Ametenda amani" spanning the entire vocal onset through its full release.\n' +
        '6. NEVER silently discard low-confidence or quiet main words—transcribe your best phonetic reading in the sung language and mark confidence (< 0.72) plus uncertain: true / uncertainWords.\n' +
        '7. SENTENCE & PHRASE BOUNDARY INTEGRITY: Group words ONLY by complete sung sentences, natural musical clauses, or vocal breaths (ideally 3 to 9 words so each cue fits in 1–2 lines on screen). NEVER split a spoken/sung clause mid-sentence or move the last word(s) of one sung sentence into the start of the next segment, and NEVER pull the opening word of the next sentence onto the end of the previous segment. Every word in "words" must belong strictly to the phrase actually sung between [start, end].\n' +
        '8. FULL PRONUNCIATION HOLD: Anchor start at the first audible consonant/vowel onset and hold segment "end"/"endTime" and the final word\'s "end" +0.15s–0.25s AFTER the singer finishes pronouncing the trailing syllable, final consonant, or sustained vowel note (NEVER cut off mid-word).\n' +
        '9. NEVER put parentheses (...) or square brackets [...] anywhere inside "text" (no "(Jireh)", no inline "(yeah)", no "[Intro]", no "[Chorus]")—put section labels only in "section" and vocal role in "vocalRole". Return valid JSON matching the schema.';

      const isLongSong = safeDuration > 240;
      const longSongInstructions = isLongSong
        ? `\nCRITICAL WARNING FOR LONG SONGS (${safeDuration.toFixed(1)}s / ${totalClock}): This is an extended live worship / song track with extended vamps, choir swells, and repeated choruses up to ${totalClock}. DO NOT stop early. Continue transcribing every main lead phrase, main choir line, and sustained vowel all the way until ${totalClock} (still omitting 1–2 word leader interjections over choir/backing vocals and omitting secondary backing echoes underneath main lines).`
        : '';

      const singlePassPrompt = `Total audio duration: ${safeDuration.toFixed(2)} seconds (${totalClock}).
${languageDirective}
Listen phonetically across the entire audio clip from 00:00.00 to ${totalClock}.
Transcribe audible main lead lyrics, main choir sections, repeated phrases, Gospel/worship names (Jireh, Jehovah, Yahweh, Hallelujah/Haleluya, Hosanna, Elohim, Adonai), and sustained vocalizations ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm") in the authentic language(s) sung (preserving French accents & apostrophes, Swahili, Shona, English, etc.).
DO NOT translate lyrics to English or distort Swahili/Shona/French words into English words.
DO NOT split a single sung word or sentence into a clipped fragment followed by the full sentence (e.g. NEVER emit "amtenda" separately before "ametenda amani" — keep ONLY one complete cue "ametenda amani" covering the whole start-to-finish duration).
DO NOT transcribe brief 1–2 word lead interjections or hype calls when the leader cuts into backing/choir singing (e.g. "Come on", "Sing", "Amen", "Yes Lord", "Yeah", "Haya", "Allez")—keep the main choir/backing phrase instead.
DO NOT emit separate lower/secondary backing-vocal echo lines underneath main lyrics; keep primary sung lyrics cleanly in "lead" or "choir".
NEVER omit quiet main words—include them and set "confidence" below 0.7 and "uncertain": true (and list unclear words in "uncertainWords").
Keep each segment aligned to a complete sung clause/breath (1–2 readable lines max); NEVER push trailing words from one sung sentence into the next segment.
For each segment provide:
- "text": actual sung words cleanly in the authentic language/script with ZERO parentheses (...) or brackets [...]
- "section": one of "intro", "verse", "pre-chorus", "chorus", "bridge", "outro"
- "vocalRole": primarily "lead" or "choir"
- "confidence": number 0.0 to 1.0 reflecting transcription certainty
- "uncertain": boolean (true if any word in this line is unclear/quiet/ambiguous)
- "uncertainWords": array of specific unclear words in "text" (empty array if clear)
- "startTime": exact start clock time "MM:SS.cc" at first audible vocal onset
- "endTime": exact end clock time "MM:SS.cc" ~0.2s AFTER complete decay of final consonant or held note
- "start": numeric start in seconds (0.00 to ${safeDuration.toFixed(2)})
- "end": numeric end in seconds (holding ~0.2s past complete vocal pronunciation release, up to ${safeDuration.toFixed(2)})
- "words": array matching "text" tokens in exact order, each { "text": string, "start": number, "end": number, "confidence": number, "uncertain": boolean }
Only set "vocalsDetected" to false with empty "segments" if the entire recording is purely instrumental.${longSongInstructions}`;

      const singlePassModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].filter(isModelReady);
      const modelOrder = singlePassModels.length > 0 ? singlePassModels : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

      let segments: StructuredSegment[] = [];
      let timingSource: 'aligned' | 'estimated' = 'aligned';
      let confirmedInstrumental = false;
      let blockedReason: string | null = null;
      let lastErrMsg: string | null = null;
      let sawQuotaError = false;
      let sawTimeoutError = false;

      const segmentSchemaProperties = {
        text: { type: Type.STRING },
        section: { type: Type.STRING },
        vocalRole: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        uncertain: { type: Type.BOOLEAN },
        uncertainWords: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        startTime: { type: Type.STRING },
        endTime: { type: Type.STRING },
        start: { type: Type.NUMBER },
        end: { type: Type.NUMBER },
        words: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              start: { type: Type.NUMBER },
              end: { type: Type.NUMBER },
              confidence: { type: Type.NUMBER },
              uncertain: { type: Type.BOOLEAN },
            },
          },
        },
      };

      const runSinglePassAttempt = async (modelId: string) => {
        const attempt = createAttemptSignal(80_000, () => clientClosed, onClientClose);
        try {
          const response = await ai.models.generateContent({
            model: modelId,
            contents: {
              parts: [audioPart, { text: singlePassPrompt }],
            },
            config: {
              abortSignal: attempt.signal,
              systemInstruction: singlePassSystemInstruction,
              thinkingConfig: {
                thinkingLevel: modelId === 'gemini-4-hydrogen' ? ThinkingLevel.MEDIUM : ThinkingLevel.MINIMAL,
              },
              maxOutputTokens: 16384,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  vocalsDetected: { type: Type.BOOLEAN },
                  segments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: segmentSchemaProperties,
                    },
                  },
                },
              },
            },
          });

          const finishReason = String(response.candidates?.[0]?.finishReason || '');
          const rawJson = (response.text ?? '').trim();

          if (!rawJson && (finishReason === 'RECITATION' || finishReason === 'SAFETY')) {
            blockedReason =
              finishReason === 'RECITATION'
                ? 'Audio transcription was blocked by content recitation policy for this commercial track. Paste or import lyrics manually, then click Sync.'
                : 'Audio transcription was blocked by safety policy on this recording. Paste or import lyrics manually.';
            return false;
          }

          const parsed = safeParseJson<StructuredTranscriptionResult>(rawJson);
          let candidateSegs: StructuredSegment[] = Array.isArray(parsed?.segments)
            ? parsed.segments
            : [];

          if (candidateSegs.length === 0 && rawJson) {
            candidateSegs = recoverSegmentsFromPartialJson(rawJson);
          }

          segments = candidateSegs
            .map((s): StructuredSegment | null => {
              if (typeof s.text !== 'string') return null;
              const { text: cleanedText, detectedSection } = cleanLyricSegmentText(s.text);
              if (!cleanedText || isPromptEcho(cleanedText) || isNoVocalsTranscript(cleanedText)) {
                return null;
              }
              const role = inferVocalRoleFromText(cleanedText, s.vocalRole);
              const formattedText = formatLyricForVocalRole(cleanedText, role);
              return {
                ...s,
                text: formattedText,
                vocalRole: role,
                section:
                  typeof s.section === 'string' && s.section.trim()
                    ? s.section
                    : detectedSection || 'verse',
              };
            })
            .filter((s): s is StructuredSegment => s !== null);

          if (segments.length > 0) {
            lastErrMsg = null;
            blockedReason = null;
            sawQuotaError = false;
            sawTimeoutError = false;
            timingSource = 'aligned';
            return true;
          }

          if (parsed?.vocalsDetected === false && rawJson.length > 0) {
            confirmedInstrumental = true;
            lastErrMsg = null;
            return true;
          }
          return false;
        } finally {
          attempt.cleanup();
        }
      };

      for (const modelId of modelOrder) {
        if (clientClosed) break;
        try {
          const done = await runSinglePassAttempt(modelId);
          if (done) break;
        } catch (err) {
          if (clientClosed) break;
          markModelFailure(modelId, err);
          if (isQuotaOrRateLimitError(err)) sawQuotaError = true;
          if (isAbortOrTimeoutError(err)) sawTimeoutError = true;
          lastErrMsg = formatGeminiError(err);
          console.warn(`[transcribe-lyrics] Single-pass (${modelId}) fallback:`, lastErrMsg);
        }
      }

      // Check if long song was truncated early (e.g. song is 9 mins like Jireh but lyrics stopped at 3 mins)
      if (segments.length > 0 && safeDuration > 300) {
        const lastSeg = segments[segments.length - 1];
        const lastEnd = Number(lastSeg.end ?? 0);
        if (lastEnd < safeDuration - 120 && !clientClosed) {
          const continuePrompt = `The previous transcription ended at ${formatClockTime(lastEnd)} (${lastEnd.toFixed(1)}s), but this is an extended live worship song of duration ${safeDuration.toFixed(2)}s (${totalClock}, like 9-minute Jireh). Continue transcribing EVERY remaining sung word, chorus, vamp, spontaneous worship, and vocalization from ${formatClockTime(lastEnd)} to ${totalClock} verbatim in chronological order. Return valid JSON matching the same schema with segments starting after ${lastEnd}.`;

          for (const modelId of modelOrder) {
            if (clientClosed) break;
            const attempt = createAttemptSignal(60_000, () => clientClosed, onClientClose);
            try {
              const contRes = await ai.models.generateContent({
                model: modelId,
                contents: {
                  parts: [audioPart, { text: continuePrompt }],
                },
                config: {
                  abortSignal: attempt.signal,
                  systemInstruction: singlePassSystemInstruction,
                  maxOutputTokens: 16384,
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      vocalsDetected: { type: Type.BOOLEAN },
                      segments: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: segmentSchemaProperties,
                        },
                      },
                    },
                  },
                },
              });
              const contJson = (contRes.text ?? '').trim();
              const contParsed = safeParseJson<StructuredTranscriptionResult>(contJson);
              const contRawSegs = Array.isArray(contParsed?.segments) ? contParsed.segments : [];
              const cleanContSegs = contRawSegs
                .map((s): StructuredSegment | null => {
                  if (typeof s.text !== 'string') return null;
                  const { text: cleanedText, detectedSection } = cleanLyricSegmentText(s.text);
                  if (!cleanedText || isPromptEcho(cleanedText) || isNoVocalsTranscript(cleanedText)) {
                    return null;
                  }
                  const role = inferVocalRoleFromText(cleanedText, s.vocalRole);
                  const formattedText = formatLyricForVocalRole(cleanedText, role);
                  return {
                    ...s,
                    text: formattedText,
                    vocalRole: role,
                    section: typeof s.section === 'string' && s.section.trim() ? s.section : detectedSection || 'chorus',
                  };
                })
                .filter((s): s is StructuredSegment => s !== null);

              if (cleanContSegs.length > 0) {
                segments = [...segments, ...cleanContSegs];
                break;
              }
            } catch (err) {
              console.warn('[transcribe-lyrics] Continuation pass error:', err);
            } finally {
              attempt.cleanup();
            }
          }
        }
      }

      // Rescue fallback using LRC formatting and dedicated gemini-3.5-transcribe model
      let rawText = '';
      if (segments.length === 0 && !confirmedInstrumental && !clientClosed && !sawQuotaError) {
        const rescuePrompt = `Listen to the entire ${safeDuration.toFixed(1)}s (${totalClock}) audio recording. ${languageDirective} Transcribe main sung words in the exact language(s) sung (Swahili, Shona, English, French, or any world/mixed language — never translate), Gospel/worship names (Jireh, Jehovah, Yahweh, Hallelujah/Haleluya, Hosanna, Elohim, Adonai), sustained vowels ("Eeeeeh", "Ooooooh", "Ahhhhh", "Mmmmm"), and repeated choruses in chronological order using LRC timestamps like [00:14.28] Lyric line text. Break lines strictly at natural spoken/sung sentence boundaries (1–2 short lines per cue, never moving words across sentences, and NEVER emitting a broken/misspelled prefix word like "amtenda" right before "ametenda amani"). Do NOT write brief 1–2 word lead interjections ("Come on", "Sing", "Amen", "Yeah", "Haya", "Allez") when the leader cuts in over backing/choir vocals, and do NOT emit separate lower backing-vocal echoes underneath main lyrics. NEVER include parentheses (...) or brackets [...] anywhere in lyric text. Do NOT output [Intro], [Verse], [Chorus], or [Instrumental] lines as lyrics. Reply NO_VOCALS only if the track is purely instrumental.`;
        const plainTranscribePrompt = `${languageDirective} Transcribe main sung lyrics verbatim in the exact sung language(s) and script (Swahili, Shona, English, French, etc. — never translate), preserving worship names (Jireh, Jehovah, Yahweh, Hallelujah/Haleluya, Hosanna, Elohim, Adonai) and sustained vowels ("Eeeeeh", "Ooooooh", "Ahhhhh") line-by-line in chronological order, breaking ONLY at natural sentence boundaries with ZERO parentheses or brackets anywhere. NEVER split one sung word or phrase into a duplicate fragment + full sentence (e.g. never emit "amtenda" separately before "ametenda amani"). Do NOT write brief 1–2 word lead interjections over backing/choir singing and do NOT write secondary backing echo lines underneath main lyrics. Reply NO_VOCALS only if purely instrumental.`;
        const rescueModels = ['gemini-3.5-transcribe', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'].filter(isModelReady);
        const rescueOrder = rescueModels.length > 0 ? rescueModels : ['gemini-3.5-transcribe', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

        for (const modelId of rescueOrder) {
          if (clientClosed) break;
          const attempt = createAttemptSignal(60_000, () => clientClosed, onClientClose);
          try {
            const isSpecializedTranscribe = modelId === 'gemini-3.5-transcribe';
            const textRes = await ai.models.generateContent({
              model: modelId,
              contents: {
                parts: [
                  audioPart,
                  { text: isSpecializedTranscribe ? plainTranscribePrompt : rescuePrompt },
                ],
              },
              config: isSpecializedTranscribe
                ? {
                    abortSignal: attempt.signal,
                    maxOutputTokens: 8192,
                  }
                : {
                    abortSignal: attempt.signal,
                    thinkingConfig: {
                      thinkingLevel: modelId === 'gemini-4-hydrogen' ? ThinkingLevel.MEDIUM : ThinkingLevel.MINIMAL,
                    },
                    maxOutputTokens: 8192,
                  },
            });
            const finishReason = String(textRes.candidates?.[0]?.finishReason || '');
            const candidateText = (textRes.text ?? '').trim();
            if (!candidateText && finishReason === 'RECITATION') {
              blockedReason =
                'Audio transcription was blocked by content recitation policy for this commercial track. Paste or import lyrics manually, then click Sync.';
              continue;
            }
            if (isNoVocalsTranscript(candidateText)) {
              confirmedInstrumental = true;
              lastErrMsg = null;
              break;
            }
            const parsedLines = parseTranscriptToSegments(candidateText, safeDuration).filter(
              (s) => !isPromptEcho(s.text)
            );
            if (parsedLines.length > 0) {
              rawText = candidateText;
              segments = parsedLines;
              const hasLrcTags = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(candidateText);
              timingSource = hasLrcTags ? 'aligned' : 'estimated';
              lastErrMsg = null;
              blockedReason = null;
              sawQuotaError = false;
              sawTimeoutError = false;
              break;
            }
          } catch (err) {
            if (clientClosed) break;
            markModelFailure(modelId, err);
            if (isQuotaOrRateLimitError(err)) sawQuotaError = true;
            if (isAbortOrTimeoutError(err)) sawTimeoutError = true;
            lastErrMsg = formatGeminiError(err);
            console.warn(`[transcribe-lyrics] Rescue (${modelId}) fallback:`, lastErrMsg);
          } finally {
            attempt.cleanup();
          }
        }
      }

      if (clientClosed) return;

      if (segments.length > 0) {
        const normalizedSegments = segments
          .map((seg, idx) => {
            const { text: cleanedText, detectedSection } = cleanLyricSegmentText(
              String(seg.text ?? '')
            );
            if (!cleanedText) return null;
            const role = inferVocalRoleFromText(cleanedText, seg.vocalRole);
            const formattedText = formatLyricForVocalRole(cleanedText, role);
            const fallbackSlot = safeDuration / segments.length;
            const fallbackStart = idx * fallbackSlot;
            const fallbackEnd = fallbackStart + Math.max(1.2, fallbackSlot - 0.1);
            const { start, end } = resolveSegmentTiming(
              seg,
              fallbackStart,
              fallbackEnd,
              safeDuration
            );
            const uncertainWords = Array.isArray(seg.uncertainWords)
              ? seg.uncertainWords.filter((w): w is string => typeof w === 'string')
              : undefined;
            const alignedWords = alignWordsToCleanText(
              formattedText,
              seg.words,
              start,
              end,
              uncertainWords
            );
            const conf =
              typeof seg.confidence === 'number' && Number.isFinite(seg.confidence)
                ? Number(Math.max(0, Math.min(1, seg.confidence)).toFixed(2))
                : undefined;
            const isUncertain =
              Boolean(seg.uncertain) ||
              (conf !== undefined && conf < 0.72) ||
              Boolean(alignedWords?.some((w) => w.uncertain));
            return {
              lineIndex: idx,
              text: formattedText,
              section:
                typeof seg.section === 'string' && seg.section.trim()
                  ? seg.section.trim()
                  : detectedSection || 'verse',
              vocalRole: role,
              start,
              end,
              ...(conf !== undefined ? { confidence: conf } : {}),
              ...(isUncertain ? { uncertain: true } : {}),
              ...(uncertainWords && uncertainWords.length > 0 ? { uncertainWords } : {}),
              ...(alignedWords && alignedWords.length > 0 ? { words: alignedWords } : {}),
            };
          })
          .filter((seg): seg is NonNullable<typeof seg> => seg !== null);

        const cleanSegments = filterVocalSegmentsForCleanPresentation(normalizedSegments)
          .sort((a, b) => a.start - b.start)
          .map((seg, idx) => ({ ...seg, lineIndex: idx }));

        return res.json({
          available: true,
          vocalsDetected: true,
          timingSource,
          rawText: rawText || cleanSegments.map((s) => s.text).join('\n'),
          segments: cleanSegments,
        });
      }

      if (blockedReason) {
        return res.status(200).json({
          available: false,
          errorCode: 'POLICY_BLOCKED',
          reason: blockedReason,
        });
      }

      if (lastErrMsg && !confirmedInstrumental) {
        console.warn('[transcribe-lyrics] Transcription unavailable:', lastErrMsg);
        return res.status(200).json({
          available: false,
          errorCode: sawQuotaError ? 'QUOTA_EXHAUSTED' : sawTimeoutError ? 'TIMEOUT' : 'MODEL_ERROR',
          reason: lastErrMsg,
        });
      }

      return res.json({
        available: true,
        vocalsDetected: false,
        timingSource: 'aligned',
        rawText: '',
        segments: [],
      });
    } catch (err) {
      if (clientClosed) return;
      const message = formatGeminiError(err);
      console.warn('[transcribe-lyrics] Unexpected error:', message);
      return res.status(200).json({
        available: false,
        errorCode: isQuotaOrRateLimitError(err) ? 'QUOTA_EXHAUSTED' : 'MODEL_ERROR',
        reason: message,
      });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shululu Studio listening on http://0.0.0.0:${PORT}`);
  });
  server.requestTimeout = 10 * 60_000;
  server.headersTimeout = 10 * 60_000 + 5_000;
  server.keepAliveTimeout = 65_000;
}

startServer();
