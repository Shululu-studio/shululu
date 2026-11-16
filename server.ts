import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  cleanLyricSegmentText,
  isNoVocalsTranscript,
  normalizeAudioMimeType,
  parseFlexibleTimestamp,
  parseTranscriptToSegments,
  recoverSegmentsFromPartialJson,
  resolveSegmentTiming,
  safeParseJson,
} from './src/utils/transcriptionParser';

function formatClockTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
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
      const { audioBase64, mimeType, duration, lines } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        duration?: number;
        lines?: Array<{ index: number; text: string }>;
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
      const syncSystemInstruction =
        'You are a precision vocal-to-lyric forced alignment engine for sung music. Align every provided line index (0-based) to exact hundredth-of-a-second clock timestamps (MM:SS.cc and decimal seconds). Set startTime right at the very first audible consonant, breath pickup, or vowel onset (never late or mid-syllable). Never skip lines, never round to whole seconds, and never invent vocals on pure instrumental tracks.';
      const promptText = `Audio duration: ${safeDuration.toFixed(2)} seconds (${totalClock}).
Listen carefully to the vocal melody, consonants, and vocalizations (including "ooooh", "woooh", short pickups, and backing echoes) in the attached audio.
Align EVERY numbered lyric line below (${lines.length} lines, indices 0 to ${lines.length - 1}) to the exact instant the very first sound of that line begins (consonant, vowel attack, or vocalization onset—do NOT start late) and the last word ends.
Provide BOTH:
- "startTime" and "endTime" in "MM:SS.cc" format (e.g. "00:14.28", hundredths of a second)
- "start" and "end" in decimal seconds (e.g. 14.28)
Also provide word-level start/end times in seconds when clear.
Keep chronological order strictly within [0, ${safeDuration.toFixed(2)}].
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
              maxOutputTokens: 8192,
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
        reason: 'Auto-Create requires GEMINI_API_KEY in Settings > Secrets, or paste/import lyrics manually.',
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
      const { audioBase64, mimeType, duration } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        duration?: number;
      };

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

      interface StructuredSegment {
        lineIndex?: number;
        text?: string;
        section?: string;
        startTime?: unknown;
        endTime?: unknown;
        start?: unknown;
        end?: unknown;
      }

      interface StructuredTranscriptionResult {
        vocalsDetected?: boolean;
        segments?: StructuredSegment[];
      }

      const totalClock = formatClockTime(safeDuration);

      const singlePassSystemInstruction =
        'You are a precision verbatim vocal transcriber and lyric timing aligner. Transcribe 100% of sung and spoken words verbatim in chronological order—including non-lexical melodic vocalizations and ad-libs (such as "ooooh", "woooh", "oh", "ahhh", "mmmm", "yeah", "hey", "la la", "amen", "hallelujah"), soft pickup words, backing vocals, choir echoes, and every repeated chorus. Spell sung vocalizations naturally as heard (e.g. "Ooooh", "Woooh"). NEVER drop words, NEVER skip short 1-3 word phrases, and NEVER merge distinct breath phrases into longer blocks. NEVER put structural tags like [Intro], [Verse], [Chorus], (Chorus), [Bridge], [Outro], or [Instrumental] inside "text" — put section labels only in "section". Anchor startTime at the very first audible consonant or vowel onset (exact attack instant, never delayed mid-word) and endTime at vocal release using MM:SS.cc and decimal seconds. Return valid JSON matching the schema.';

      const singlePassPrompt = `Total audio duration: ${safeDuration.toFixed(2)} seconds (${totalClock}).
Listen carefully from 00:00.00 to ${totalClock} across lead vocals, soft phrases, backing harmonies, fast lyrics, and sustained melodic vocalizations.
Transcribe EVERY SINGLE SUNG WORD AND VOCALIZATION verbatim in chronological order—do NOT skip short pickup words ("and/the/oh/for/I"), repeated choruses, choir responses, or vocalizations like "Ooooh", "Woooh", "Ahhh", "Oh", "Yeah", or "Mmmm".
Break into natural singable cues of 1 to 10 words per cue—emit standalone vocalizations or short hooks (e.g. "Ooooh", "Woooh", "Hallelujah") as their own timed cues whenever sung as a phrase.
For each line provide:
- "text": ONLY the actual sung words or vocalizations (NEVER include [Intro], [Verse], [Chorus], (Chorus), [Bridge], [Outro], or [Instrumental] tags in "text")
- "section": one of "intro", "verse", "pre-chorus", "chorus", "bridge", "outro"
- "startTime": exact start clock time in "MM:SS.cc" format right at the first audible consonant or vowel onset (e.g. "00:14.28", zero delay)
- "endTime": exact end clock time in "MM:SS.cc" format when the last syllable or vocalization decays (e.g. "00:17.92")
- "start": numeric start in seconds (0.00 to ${safeDuration.toFixed(2)}, hundredth-of-a-second precision)
- "end": numeric end in seconds (strictly greater than start, up to ${safeDuration.toFixed(2)})
Only set "vocalsDetected" to false with empty "segments" if the entire recording is purely instrumental with zero singing, vocalizations, or speech.`;

      const singlePassModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].filter(isModelReady);
      const modelOrder = singlePassModels.length > 0 ? singlePassModels : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

      let segments: StructuredSegment[] = [];
      let timingSource: 'aligned' | 'estimated' = 'aligned';
      let confirmedInstrumental = false;
      let blockedReason: string | null = null;
      let lastErrMsg: string | null = null;
      let sawQuotaError = false;
      let sawTimeoutError = false;

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
                thinkingLevel: modelId === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
              },
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  vocalsDetected: { type: Type.BOOLEAN },
                  segments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        section: { type: Type.STRING },
                        startTime: { type: Type.STRING },
                        endTime: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                      },
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
              return {
                ...s,
                text: cleanedText,
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

      // Rescue fallback using LRC formatting across supported multimodal models (only if not quota-blocked and client still connected)
      let rawText = '';
      if (segments.length === 0 && !confirmedInstrumental && !clientClosed && !sawQuotaError) {
        const rescuePrompt = `Listen to the entire ${safeDuration.toFixed(1)}s (${totalClock}) audio recording and transcribe EVERY sung or spoken lyric line and vocalization verbatim (including "ooooh", "woooh", "oh", "ahhh", backing echoes, and repeated lines) in chronological order using LRC timestamps like [00:14.28] Lyric line text. Do NOT output [Intro], [Verse], [Chorus], (Chorus), or [Instrumental] lines as lyrics. Reply NO_VOCALS only if the track is purely instrumental.`;
        const rescueModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].filter(isModelReady);
        const rescueOrder = rescueModels.length > 0 ? rescueModels : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

        for (const modelId of rescueOrder) {
          if (clientClosed) break;
          const attempt = createAttemptSignal(60_000, () => clientClosed, onClientClose);
          try {
            const textRes = await ai.models.generateContent({
              model: modelId,
              contents: { parts: [audioPart, { text: rescuePrompt }] },
              config: {
                abortSignal: attempt.signal,
                thinkingConfig: {
                  thinkingLevel: modelId === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
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
        const cleanSegments = segments
          .map((seg, idx) => {
            const { text: cleanedText, detectedSection } = cleanLyricSegmentText(
              String(seg.text ?? '')
            );
            if (!cleanedText) return null;
            const fallbackSlot = safeDuration / segments.length;
            const fallbackStart = idx * fallbackSlot;
            const fallbackEnd = fallbackStart + Math.max(1.2, fallbackSlot - 0.1);
            const { start, end } = resolveSegmentTiming(
              seg,
              fallbackStart,
              fallbackEnd,
              safeDuration
            );
            return {
              lineIndex: idx,
              text: cleanedText,
              section:
                typeof seg.section === 'string' && seg.section.trim()
                  ? seg.section.trim()
                  : detectedSection || 'verse',
              start,
              end,
            };
          })
          .filter((seg): seg is NonNullable<typeof seg> => seg !== null)
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
