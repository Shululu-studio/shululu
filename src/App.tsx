import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BACKGROUND_TEMPLATES,
  createNewProject,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_VOCAL_LAYERS,
  DEFAULT_WATERMARK,
} from './data/presets';
import {
  AlbumStylePreset,
  AspectRatio,
  AutoEffectStyle,
  BackgroundConfig,
  EffectType,
  LyricLine,
  PreviewQuality,
  ProjectData,
  ProjectSummary,
  SectionType,
  TypographyStyle,
  VocalLayersConfig,
  VocalLayersPatch,
  VocalRole,
  WatermarkConfig,
} from './types/editor';
import {
  alignLinesToWindow,
  alignLyricsToAudio,
  AudioAnalysisResult,
  computeAudioAnalysis,
  distributeLyricsProportionally,
  encodeFloat32ToWavBlob,
  fillRemainingSongCuesWithAnalysis,
  refineSegmentsWithAcousticAnalysis,
  refineWithAiTimestamps,
  resolveLineOverlaps,
  shiftLyricsTiming,
  snapWordTimingsToOnsets,
} from './utils/audioSync';
import { assignAutoEffects } from './utils/autoEffects';
import { MediaAssetCache } from './utils/lyricRenderer';
import {
  buildWordTimings,
  parseLyricsText,
  redistributeWordTimings,
} from './utils/lyricsParser';
import { extractId3LyricsFromBlob } from './utils/id3Lyrics';
import {
  alignWordsToCleanText,
  cleanLyricSegmentText,
  filterVocalSegmentsForCleanPresentation,
  formatLyricForVocalRole,
  inferVocalRoleFromText,
  normalizeAudioMimeType,
  parseTranscriptToSegments,
  resolveChunkOverlapSegment,
} from './utils/transcriptionParser';
import {
  deleteProjectFromDb,
  duplicateProjectInDb,
  listProjectsFromDb,
  loadProjectFromDb,
  loadRecoveryState,
  saveProjectToDb,
  saveRecoveryState,
} from './utils/projectStorage';
import { TopBar } from './components/TopBar';
import { LyricsTab } from './components/LyricsTab';
import { TypographyTab } from './components/TypographyTab';
import { EffectsTab } from './components/EffectsTab';
import { BackgroundTab } from './components/BackgroundTab';
import { PreviewMonitor } from './components/PreviewMonitor';
import { TimelinePanel } from './components/TimelinePanel';
import { ProjectsModal } from './components/ProjectsModal';
import { ExportModal } from './components/ExportModal';
import { TapSyncModal } from './components/TapSyncModal';
import { ShortcutsModal } from './components/ShortcutsModal';

function mixDownToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const mono = new Float32Array(len);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      mono[i] += ch[i] / channels;
    }
  }
  return mono;
}

function downsampleMono(
  samples: Float32Array,
  srcRate: number,
  targetRate = 16000
): Float32Array {
  if (srcRate <= targetRate) return samples;
  const ratio = srcRate / targetRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += samples[j] ?? 0;
    }
    out[i] = sum / (end - start);
  }
  return out;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const LEGACY_DEMO_NAMES = new Set([
  'Morning Light — Sample Project',
  'Untitled Lyrics Video',
]);

function isLegacyDemoProject(p: { name: string; audioFileName: string | null }): boolean {
  return (
    p.name === 'Morning Light — Sample Project' ||
    p.audioFileName === 'Demo_Sanctuary_Track.wav'
  );
}

export default function App() {
  const [project, setProject] = useState<ProjectData>(() => createNewProject());
  const [rightTab, setRightTab] = useState<'typography' | 'effects' | 'background'>('typography');
  const [mobilePane, setMobilePane] = useState<'lyrics' | 'monitor' | 'console'>('monitor');
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [pasteDrawerOpen, setPasteDrawerOpen] = useState(false);

  // Playback & Media State
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [quality, setQuality] = useState<PreviewQuality>('draft');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysisResult | null>(null);
  const [bgMediaBlob, setBgMediaBlob] = useState<Blob | null>(null);

  // Sync & Auto-Create Status
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [autoReviewActive, setAutoReviewActive] = useState(false);

  // Modals State
  const [projectsModalOpen, setProjectsModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [tapSyncOpen, setTapSyncOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [savedProjects, setSavedProjects] = useState<ProjectSummary[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [mediaRenderTick, setMediaRenderTick] = useState(0);

  const [savedAlbumPresets, setSavedAlbumPresets] = useState<AlbumStylePreset[]>(() => {
    try {
      const raw = localStorage.getItem('shululu_album_presets');
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  const handleSaveAlbumPreset = useCallback((presetName: string) => {
    if (!presetName.trim()) return;
    const newPreset: AlbumStylePreset = {
      id: 'preset_' + Date.now(),
      name: presetName.trim(),
      updatedAt: Date.now(),
      typography: { ...project.typography },
      background: { ...project.background },
      autoEffectStyle: project.autoEffectStyle,
    };
    setSavedAlbumPresets((prev) => {
      const updated = [newPreset, ...prev];
      try {
        localStorage.setItem('shululu_album_presets', JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setToastMessage(`Album preset "${newPreset.name}" saved successfully`);
  }, [project.typography, project.background, project.autoEffectStyle]);

  const handleApplyAlbumPreset = useCallback((preset: AlbumStylePreset) => {
    setProject((prev) => ({
      ...prev,
      typography: { ...preset.typography },
      background: { ...preset.background },
      autoEffectStyle: preset.autoEffectStyle,
    }));
    setToastMessage(`Applied album preset "${preset.name}"`);
  }, []);

  const handleDeleteAlbumPreset = useCallback((id: string) => {
    setSavedAlbumPresets((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      try {
        localStorage.setItem('shululu_album_presets', JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setToastMessage('Album preset deleted');
  }, []);

  // Refs for sample-accurate audio playback & worker
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const playbackAudioCtxRef = useRef<AudioContext | null>(null);
  const playbackSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackSessionIdRef = useRef<number>(0);
  const playbackClockRef = useRef<{
    ctxStartTime: number;
    trackOffset: number;
    active: boolean;
  }>({ ctxStartTime: 0, trackOffset: 0, active: false });
  const currentTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const lastNonZeroVolumeRef = useRef<number>(1);
  const currentVolumeRef = useRef<number>(1);
  const hasRestoredRecoveryRef = useRef<boolean>(false);
  const audioObjectUrlRef = useRef<string | null>(null);
  const bgObjectUrlRef = useRef<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const rafRef = useRef<number | null>(null);
  const previewRenderRef = useRef<((liveTime: number) => void) | null>(null);
  const mediaCacheRef = useRef<MediaAssetCache>({
    images: new Map(),
    videos: new Map(),
    videoElement: null,
  });

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const stopWebAudio = useCallback((invalidateSession = true) => {
    if (invalidateSession) {
      playbackSessionIdRef.current += 1;
    }
    playbackClockRef.current.active = false;
    const node = playbackSourceNodeRef.current;
    if (node) {
      playbackSourceNodeRef.current = null;
      node.onended = null;
      try {
        node.stop();
      } catch {}
      try {
        node.disconnect();
      } catch {}
    }
  }, []);

  const ensurePlaybackAudioCtx = useCallback((): {
    ctx: AudioContext;
    gain: GainNode;
  } | null => {
    try {
      if (!playbackAudioCtxRef.current || playbackAudioCtxRef.current.state === 'closed') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, Math.min(2, currentVolumeRef.current));
        gain.connect(ctx.destination);
        playbackAudioCtxRef.current = ctx;
        playbackGainRef.current = gain;
      }
      if (!playbackGainRef.current && playbackAudioCtxRef.current) {
        const gain = playbackAudioCtxRef.current.createGain();
        gain.gain.value = Math.max(0, Math.min(2, currentVolumeRef.current));
        gain.connect(playbackAudioCtxRef.current.destination);
        playbackGainRef.current = gain;
      }
      if (playbackAudioCtxRef.current && playbackGainRef.current) {
        return { ctx: playbackAudioCtxRef.current, gain: playbackGainRef.current };
      }
    } catch {
      return null;
    }
    return null;
  }, []);

  const applyPlaybackVolume = useCallback((rawVolume: number) => {
    const safeVol = Math.max(0, Math.min(2, rawVolume));
    if (playbackGainRef.current && playbackAudioCtxRef.current) {
      playbackGainRef.current.gain.setValueAtTime(
        safeVol,
        playbackAudioCtxRef.current.currentTime
      );
    }
    if (audioElRef.current) {
      audioElRef.current.volume = Math.min(1, safeVol);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopWebAudio();
      if (playbackAudioCtxRef.current) {
        void playbackAudioCtxRef.current.close().catch(() => {});
      }
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
        audioObjectUrlRef.current = null;
      }
      if (bgObjectUrlRef.current) {
        URL.revokeObjectURL(bgObjectUrlRef.current);
        bgObjectUrlRef.current = null;
      }
    };
  }, [stopWebAudio]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Preload template background thumbnails for synchronous Canvas 2D rendering
  useEffect(() => {
    for (const tpl of BACKGROUND_TEMPLATES) {
      if (!mediaCacheRef.current.images.has(tpl.imageUrl)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => setMediaRenderTick((n) => n + 1);
        img.src = tpl.imageUrl;
        mediaCacheRef.current.images.set(tpl.imageUrl, img);
      }
    }
  }, []);

  // Analyze AudioBuffer via Web Worker (with direct fallback & timeout guard)
  const analyzeAudioBuffer = useCallback(
    (buffer: AudioBuffer): Promise<AudioAnalysisResult> => {
      const mono = mixDownToMono(buffer);
      return new Promise((resolve) => {
        let settled = false;
        const finish = (res: AudioAnalysisResult) => {
          if (settled) return;
          settled = true;
          resolve(res);
        };

        try {
          if (!workerRef.current) {
            workerRef.current = new Worker(
              new URL('./workers/audioAnalysis.worker.ts', import.meta.url),
              { type: 'module' }
            );
          }
          const worker = workerRef.current;
          const reqId = `ana_${Date.now()}_${Math.random()}`;
          const timeoutId = window.setTimeout(() => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            finish(computeAudioAnalysis(mono, buffer.sampleRate, 10, 2400));
          }, 10000);

          const onMessage = (
            ev: MessageEvent<{ id: string; ok: boolean; analysis?: AudioAnalysisResult }>
          ) => {
            if (ev.data.id !== reqId) return;
            window.clearTimeout(timeoutId);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            if (ev.data.ok && ev.data.analysis) {
              finish(ev.data.analysis);
            } else {
              finish(computeAudioAnalysis(mono, buffer.sampleRate, 10, 2400));
            }
          };

          const onError = () => {
            window.clearTimeout(timeoutId);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            worker.terminate();
            if (workerRef.current === worker) {
              workerRef.current = null;
            }
            finish(computeAudioAnalysis(mono, buffer.sampleRate, 10, 2400));
          };

          worker.addEventListener('message', onMessage);
          worker.addEventListener('error', onError);
          worker.postMessage({ id: reqId, samples: mono, sampleRate: buffer.sampleRate });
        } catch {
          finish(computeAudioAnalysis(mono, buffer.sampleRate, 10, 2400));
        }
      });
    },
    []
  );

  // Load audio blob into <audio>, decode AudioBuffer, and compute waveform
  const attachAudioBlob = useCallback(
    async (
      blob: Blob,
      fileName: string,
      updateDuration = true,
      initialVolume?: number,
      clearPreviousLyrics = false
    ) => {
      setAudioBlob(blob);
      setSyncError(null);
      if (updateDuration) {
        setAudioBuffer(null);
        setAudioAnalysis(null);
      }

      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      audioObjectUrlRef.current = url;

      if (!audioElRef.current) {
        audioElRef.current = new Audio();
      }
      stopWebAudio();
      const el = audioElRef.current;
      el.pause();
      el.src = url;
      el.load();
      applyPlaybackVolume(initialVolume ?? currentVolumeRef.current);
      setIsPlaying(false);
      currentTimeRef.current = 0;
      setCurrentTime(0);

      if (updateDuration) {
        setProject((prev) => {
          const shouldClearLyrics = clearPreviousLyrics || Boolean(prev.audioFileName);
          return {
            ...prev,
            audioFileName: fileName,
            audioMimeType: blob.type || 'audio/mpeg',
            ...(shouldClearLyrics ? { lyrics: [], syncReport: null } : {}),
          };
        });
      }

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        await ctx.close();

        setAudioBuffer(decoded);
        if (updateDuration) {
          setProject((prev) => ({
            ...prev,
            duration: Number(decoded.duration.toFixed(2)),
            audioFileName: fileName,
            audioMimeType: blob.type || 'audio/mpeg',
          }));
        }

        const analysis = await analyzeAudioBuffer(decoded);
        setAudioAnalysis(analysis);
      } catch (err) {
        if (updateDuration && Number.isFinite(el.duration) && el.duration > 0) {
          setProject((prev) => ({
            ...prev,
            duration: Number(el.duration.toFixed(2)),
          }));
        }
        showToast(
          err instanceof Error
            ? `Could not decode audio: ${err.message}`
            : 'Could not decode audio file.'
        );
      }
    },
    [analyzeAudioBuffer, applyPlaybackVolume, showToast, stopWebAudio]
  );

  const attachBackgroundMediaBlob = useCallback(
    (blob: Blob, fileName: string, mediaType: 'image' | 'video') => {
      setBgMediaBlob(blob);
      if (bgObjectUrlRef.current) {
        URL.revokeObjectURL(bgObjectUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      bgObjectUrlRef.current = url;

      if (mediaType === 'image') {
        const img = new Image();
        img.onload = () => setMediaRenderTick((n) => n + 1);
        img.src = url;
        mediaCacheRef.current.images.set(url, img);
        mediaCacheRef.current.videoElement = null;
      } else {
        mediaCacheRef.current.videoElement = null;
      }

      setProject((prev) => ({
        ...prev,
        background: {
          ...prev.background,
          type: mediaType,
          mediaUrl: url,
          mediaName: fileName,
        },
      }));
    },
    []
  );

  // Startup: clean out any legacy demo items and restore real user projects/recovery (mount only)
  useEffect(() => {
    if (hasRestoredRecoveryRef.current) return;
    hasRestoredRecoveryRef.current = true;
    let active = true;
    (async () => {
      try {
        const [projects, recovery] = await Promise.all([
          listProjectsFromDb(),
          loadRecoveryState(),
        ]);
        if (!active) return;

        // Purge any legacy demo project from IndexedDB
        const realProjects: ProjectSummary[] = [];
        for (const p of projects) {
          if (isLegacyDemoProject(p)) {
            await deleteProjectFromDb(p.id);
          } else {
            realProjects.push(p);
          }
        }
        setSavedProjects(realProjects);

        // Restore recovery only if it is real user work (not an empty placeholder or legacy demo)
        if (
          recovery &&
          recovery.project &&
          !isLegacyDemoProject(recovery.project) &&
          !LEGACY_DEMO_NAMES.has(recovery.project.name) &&
          (recovery.project.lyrics.length > 0 || Boolean(recovery.project.audioFileName))
        ) {
          const restoredVol = recovery.project.audioVolume ?? 1;
          currentVolumeRef.current = restoredVol;
          setProject(recovery.project);
          if (recovery.project.lyrics[0]) {
            setSelectedLineId(recovery.project.lyrics[0].id);
          }
          if (recovery.audioBlob && recovery.project.audioFileName) {
            await attachAudioBlob(
              recovery.audioBlob,
              recovery.project.audioFileName,
              false,
              restoredVol
            );
          }
          if (recovery.bgMediaBlob && recovery.project.background.mediaName) {
            const bgType =
              recovery.project.background.type === 'video' ? 'video' : 'image';
            attachBackgroundMediaBlob(
              recovery.bgMediaBlob,
              recovery.project.background.mediaName,
              bgType
            );
          }
        }
      } catch {
        // IndexedDB unavailable; continue in memory
      }
    })();
    return () => {
      active = false;
    };
  }, [attachAudioBlob, attachBackgroundMediaBlob]);

  // Auto-save recovery snapshot after edits
  useEffect(() => {
    const timer = setTimeout(() => {
      saveRecoveryState(project, audioBlob, bgMediaBlob).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, [project, audioBlob, bgMediaBlob]);

  const startWebAudioAt = useCallback(
    async (offsetSec: number) => {
      if (!audioBuffer) return;
      stopWebAudio(true);
      const sessionId = playbackSessionIdRef.current;
      const engine = ensurePlaybackAudioCtx();
      if (!engine) return;
      const { ctx, gain } = engine;

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          return;
        }
      }
      if (playbackSessionIdRef.current !== sessionId || !isPlayingRef.current) {
        return;
      }

      const clampedOffset = Math.max(0, Math.min(audioBuffer.duration - 0.01, offsetSec));
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      gain.gain.setValueAtTime(
        Math.max(0, Math.min(2, currentVolumeRef.current)),
        ctx.currentTime
      );
      src.connect(gain);

      const startCtxTime = ctx.currentTime;
      src.start(0, clampedOffset);
      playbackSourceNodeRef.current = src;
      playbackClockRef.current = {
        ctxStartTime: startCtxTime,
        trackOffset: clampedOffset,
        active: true,
      };

      src.onended = () => {
        if (playbackSessionIdRef.current !== sessionId) return;
        playbackClockRef.current.active = false;
        playbackSourceNodeRef.current = null;
        if (isPlayingRef.current) {
          currentTimeRef.current = project.duration;
          setCurrentTime(project.duration);
          setIsPlaying(false);
        }
      };
    },
    [audioBuffer, ensurePlaybackAudioCtx, project.duration, stopWebAudio]
  );

  // Playback animation loop locked to decoded AudioContext clock (or HTMLAudio fallback)
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopWebAudio(true);
      audioElRef.current?.pause();
      return;
    }

    const audio = audioElRef.current;
    let lastPerf = performance.now();
    let lastReactSyncMs = 0;

    if (audioBuffer) {
      audio?.pause();
      void startWebAudioAt(currentTimeRef.current);
    } else if (audio && audio.src) {
      audio.currentTime = currentTimeRef.current;
      void audio.play().catch(() => {});
    }

    const syncUiTime = (nextT: number, now: number) => {
      currentTimeRef.current = nextT;
      previewRenderRef.current?.(nextT);
      if (now - lastReactSyncMs >= 55) {
        lastReactSyncMs = now;
        setCurrentTime(nextT);
      }
    };

    const tick = (now: number) => {
      const dt = (now - lastPerf) / 1000;
      lastPerf = now;

      if (audioBuffer) {
        const clock = playbackClockRef.current;
        const ctx = playbackAudioCtxRef.current;
        if (clock.active && ctx) {
          const rawHwLatency = Math.min(
            0.15,
            Math.max(0, ctx.outputLatency || ctx.baseLatency || 0)
          );
          const hwLatency = Math.max(0, rawHwLatency - 0.016);
          const rawElapsed = Math.max(0, ctx.currentTime - clock.ctxStartTime);
          let nextT = clock.trackOffset + Math.max(0, rawElapsed - hwLatency);

          if (typeof ctx.getOutputTimestamp === 'function') {
            const ts = ctx.getOutputTimestamp();
            if (
              ts &&
              typeof ts.contextTime === 'number' &&
              typeof ts.performanceTime === 'number' &&
              ts.contextTime > 0 &&
              ts.performanceTime > 0
            ) {
              const perfDelta = (now - ts.performanceTime) / 1000;
              const outputElapsed = ts.contextTime + perfDelta + 0.016 - clock.ctxStartTime;
              if (outputElapsed >= 0 && Math.abs(outputElapsed - (rawElapsed - hwLatency)) < 0.25) {
                nextT = clock.trackOffset + outputElapsed;
              }
            }
          }

          if (rawElapsed > hwLatency && nextT >= project.duration) {
            currentTimeRef.current = project.duration;
            previewRenderRef.current?.(project.duration);
            setCurrentTime(project.duration);
            setIsPlaying(false);
            return;
          }
          syncUiTime(nextT, now);
        }
      } else if (audio && audio.src) {
        // Wait for audio pipeline to actually play rather than free-wheeling lyrics ahead of buffering audio
        if (!audio.paused && audio.readyState >= 2) {
          const nextT = audio.currentTime;
          if (nextT >= project.duration || audio.ended) {
            currentTimeRef.current = project.duration;
            previewRenderRef.current?.(project.duration);
            setCurrentTime(project.duration);
            setIsPlaying(false);
            return;
          }
          syncUiTime(nextT, now);
        }
      } else {
        const next = currentTimeRef.current + dt;
        if (next >= project.duration) {
          currentTimeRef.current = project.duration;
          previewRenderRef.current?.(project.duration);
          setCurrentTime(project.duration);
          setIsPlaying(false);
          return;
        }
        syncUiTime(next, now);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopWebAudio(true);
    };
  }, [isPlaying, audioBuffer, project.duration, startWebAudioAt, stopWebAudio]);

  const handleSeek = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(project.duration, time));
      currentTimeRef.current = clamped;
      previewRenderRef.current?.(clamped);
      setCurrentTime(clamped);
      if (audioBuffer) {
        if (isPlayingRef.current) {
          void startWebAudioAt(clamped);
        }
      } else if (audioElRef.current && audioElRef.current.src) {
        audioElRef.current.currentTime = clamped;
      }
    },
    [audioBuffer, project.duration, startWebAudioAt]
  );

  const handlePlay = useCallback(() => {
    if (project.duration <= 0) return;
    const engine = ensurePlaybackAudioCtx();
    if (engine?.ctx.state === 'suspended') {
      void engine.ctx.resume().catch(() => {});
    }
    if (currentTimeRef.current >= project.duration - 0.05) {
      handleSeek(0);
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, [ensurePlaybackAudioCtx, project.duration, handleSeek]);

  const handlePause = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  const handleStop = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    handleSeek(0);
  }, [handleSeek]);

  const handleTogglePlay = useCallback(() => {
    if (project.duration <= 0) return;
    if (isPlaying) {
      handlePause();
    } else {
      handlePlay();
    }
  }, [isPlaying, project.duration, handlePause, handlePlay]);

  const currentVolume = project.audioVolume ?? 1;

  useEffect(() => {
    currentVolumeRef.current = currentVolume;
    if (currentVolume > 0) {
      lastNonZeroVolumeRef.current = currentVolume;
    }
    applyPlaybackVolume(currentVolume);
  }, [currentVolume, applyPlaybackVolume]);

  const handleChangeVolume = useCallback(
    (nextVolume: number) => {
      const clamped = Number(Math.max(0, Math.min(2, nextVolume)).toFixed(2));
      currentVolumeRef.current = clamped;
      if (clamped > 0) {
        lastNonZeroVolumeRef.current = clamped;
      }
      applyPlaybackVolume(clamped);
      setProject((prev) => ({
        ...prev,
        audioVolume: clamped,
      }));
    },
    [applyPlaybackVolume]
  );

  const handleToggleMute = useCallback(() => {
    const activeVol = project.audioVolume ?? 1;
    if (activeVol > 0) {
      lastNonZeroVolumeRef.current = activeVol;
      handleChangeVolume(0);
    } else {
      const restore =
        lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 1;
      handleChangeVolume(restore);
    }
  }, [project.audioVolume, handleChangeVolume]);

  // Upload audio track handler
  const handleUploadAudio = useCallback(
    async (file: File) => {
      const hadPreviousAudio = Boolean(audioBlob || project.audioFileName);
      if (hadPreviousAudio) {
        setSelectedLineId(null);
        setAutoReviewActive(false);
        setPasteDrawerOpen(false);
      }
      await attachAudioBlob(file, file.name, true, undefined, hadPreviousAudio);
      showToast(
        hadPreviousAudio
          ? `Loaded new audio "${file.name}" and cleared previous lyrics.`
          : `Loaded audio "${file.name}".`
      );
    },
    [attachAudioBlob, audioBlob, project.audioFileName, showToast]
  );

  // Import or paste lyrics
  const handleImportLyricsText = useCallback(
    (rawText: string) => {
      setSyncError(null);
      const targetDuration = project.duration > 0 ? project.duration : 30;
      const parsed = parseLyricsText(rawText, targetDuration);
      const withEffects = project.autoEffectsEnabled
        ? assignAutoEffects(parsed.lines, project.autoEffectStyle, false)
        : parsed.lines;

      const maxLineEnd = withEffects.reduce((m, l) => Math.max(m, l.end), 0);

      setProject((prev) => ({
        ...prev,
        duration: prev.duration > 0 ? prev.duration : Math.max(10, Math.ceil(maxLineEnd + 1)),
        lyrics: withEffects,
        syncReport: parsed.hasLrcTimestamps
          ? {
              method: 'lrc-import',
              confidence: 0.95,
              matchedPhrases: withEffects.length,
              totalLines: withEffects.length,
              warnings: [],
              timestamp: Date.now(),
            }
          : null,
      }));
      if (withEffects[0]) setSelectedLineId(withEffects[0].id);
      showToast(`Added ${withEffects.length} lyric lines.`);
    },
    [project.duration, project.autoEffectsEnabled, project.autoEffectStyle, showToast]
  );

  // Optional helper: explicitly create timed blank cue slots for instrumental or manual entry
  const handleCreateBlankCueSlots = useCallback(async () => {
    const trackDuration = audioBuffer
      ? audioBuffer.duration
      : project.duration > 0
        ? project.duration
        : 30;
    const analysis = audioBuffer
      ? audioAnalysis ?? (await analyzeAudioBuffer(audioBuffer))
      : null;
    if (analysis && !audioAnalysis) {
      setAudioAnalysis(analysis);
    }

    const stamp = Date.now();
    const usablePhrases =
      analysis &&
      analysis.phrases.length >= 2 &&
      analysis.phrases.reduce((s, p) => s + (p.end - p.start), 0) >= trackDuration * 0.18
        ? analysis.phrases
        : null;

    let blankSlots: LyricLine[];
    if (usablePhrases) {
      blankSlots = usablePhrases.map((p, idx) => {
        const id = `line_${stamp}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
        const start = Number(Math.max(0, p.start).toFixed(2));
        const end = Number(Math.min(trackDuration, Math.max(p.start + 0.5, p.end)).toFixed(2));
        const label = `Vocal cue ${String(idx + 1).padStart(2, '0')}`;
        return {
          id,
          text: label,
          section: 'verse' as SectionType,
          start,
          end,
          effect: 'fade' as EffectType,
          effectOverride: false,
          words: buildWordTimings(label, start, end, id),
        };
      });
    } else {
      const slotCount = Math.max(4, Math.min(16, Math.round(trackDuration / 3.5)));
      const placeholders: LyricLine[] = Array.from({ length: slotCount }, (_, idx) => ({
        id: `line_${stamp}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
        text: `Vocal cue ${String(idx + 1).padStart(2, '0')}`,
        section: 'verse' as SectionType,
        start: 0,
        end: 1,
        effect: 'fade' as EffectType,
        effectOverride: false,
        words: [],
      }));
      blankSlots = distributeLyricsProportionally(
        placeholders,
        trackDuration,
        analysis?.onsets ?? []
      ).lines;
    }

    const finalLines = project.autoEffectsEnabled
      ? assignAutoEffects(blankSlots, project.autoEffectStyle, false)
      : blankSlots;

    setSyncError(null);
    setProject((prev) => ({
      ...prev,
      duration: prev.duration > 0 ? prev.duration : Number(trackDuration.toFixed(2)),
      lyrics: finalLines,
      syncReport: null,
    }));
    setAutoReviewActive(true);
    setMobilePane('lyrics');
    if (finalLines[0]) {
      setSelectedLineId(finalLines[0].id);
      const previewPoint =
        finalLines[0].start +
        Math.min(0.45, Math.max(0.08, (finalLines[0].end - finalLines[0].start) * 0.4));
      handleSeek(Math.min(trackDuration, previewPoint));
    }
    showToast('Created timed cue slots from audio. Edit any cue text inline.');
  }, [
    analyzeAudioBuffer,
    audioAnalysis,
    audioBuffer,
    handleSeek,
    project.autoEffectStyle,
    project.autoEffectsEnabled,
    project.duration,
    showToast,
  ]);

  // Automatic Lyrics Creation from Audio + Preview-to-Edit Review
  const handleAutoCreateLyrics = useCallback(async () => {
    if (!audioBuffer && !audioBlob && !project.audioFileName) return;
    setSyncError(null);
    setIsSyncing(true);
    setSyncStatusText('Listening to vocals & transcribing lyrics...');

    const normalizeSection = (raw?: string): SectionType => {
      const s = (raw || '').toLowerCase();
      if (s.includes('pre')) return 'pre-chorus';
      if (s.includes('chorus') || s.includes('hook')) return 'chorus';
      if (s.includes('bridge')) return 'bridge';
      if (s.includes('intro')) return 'intro';
      if (s.includes('outro') || s.includes('end')) return 'outro';
      return 'verse';
    };

    type ServerSegment = {
      text: string;
      section?: string;
      vocalRole?: VocalRole | string;
      start?: number;
      end?: number;
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
    };

    type TranscribeApiResponse = {
      available: boolean;
      errorCode?: string;
      reason?: string;
      vocalsDetected?: boolean;
      timingSource?: 'aligned' | 'estimated';
      rawText?: string;
      segments?: ServerSegment[];
    };

    const convertSegmentsToLines = (
      rawSegs: ServerSegment[],
      trackDuration: number,
      deferAcousticWords = false
    ): LyricLine[] => {
      const stamp = Date.now();
      const cleanedSegs = rawSegs
        .map((seg) => {
          if (typeof seg.text !== 'string') return null;
          const { text: cleanText, detectedSection } = cleanLyricSegmentText(seg.text);
          if (!cleanText) return null;
          const role = inferVocalRoleFromText(cleanText, seg.vocalRole);
          const formattedText = formatLyricForVocalRole(cleanText, role);
          return {
            ...seg,
            cleanText: formattedText,
            resolvedRole: role,
            resolvedSection:
              seg.section && seg.section.trim()
                ? seg.section
                : detectedSection || 'verse',
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      const lines: LyricLine[] = cleanedSegs.map((seg, idx) => {
        const id = `line_${stamp}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
        const fallbackSlot = trackDuration / Math.max(1, cleanedSegs.length);
        const rawStart = Number.isFinite(seg.start)
          ? (seg.start as number)
          : idx * fallbackSlot;
        const rawEnd = Number.isFinite(seg.end)
          ? (seg.end as number)
          : rawStart + Math.max(1.2, fallbackSlot - 0.15);

        const start = Number(
          Math.max(0, Math.min(trackDuration - 0.35, rawStart)).toFixed(2)
        );
        const end = Number(
          Math.max(start + 0.35, Math.min(trackDuration, rawEnd)).toFixed(2)
        );
        const text = seg.cleanText;
        const section = normalizeSection(seg.resolvedSection);

        const alignedWords = alignWordsToCleanText(
          text,
          seg.words,
          start,
          end,
          seg.uncertainWords
        );
        const validWords = alignedWords
          ? alignedWords.map((w, wIdx) => ({
              id: `${id}_w${wIdx}_${Math.random().toString(36).slice(2, 6)}`,
              text: w.text,
              start: w.start,
              end: w.end,
              ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
              ...(w.uncertain ? { uncertain: true } : {}),
            }))
          : [];

        const lineUncertain =
          Boolean(seg.uncertain) ||
          (typeof seg.confidence === 'number' && seg.confidence < 0.72) ||
          validWords.some((w) => w.uncertain);

        return {
          id,
          text,
          section,
          vocalRole: seg.resolvedRole,
          start,
          end,
          effect: 'fade' as EffectType,
          effectOverride: false,
          ...(typeof seg.confidence === 'number' ? { confidence: seg.confidence } : {}),
          ...(lineUncertain ? { uncertain: true } : {}),
          words:
            validWords.length > 0
              ? validWords
              : deferAcousticWords
                ? []
                : buildWordTimings(text, start, end, id),
        };
      });

      const filteredLines = filterVocalSegmentsForCleanPresentation(lines);
      return resolveLineOverlaps(filteredLines, trackDuration);
    };

    const callTranscribeEndpoint = async (
      payloadBlob: Blob,
      mimeType: string,
      clipDuration: number,
      timeoutMs = 240_000
    ): Promise<TranscribeApiResponse> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const base64 = await blobToBase64(payloadBlob);
        const res = await fetch('/api/transcribe-lyrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            audioBase64: base64,
            mimeType,
            duration: clipDuration,
            language: project.language || 'auto',
          }),
        });
        if (!res.ok) {
          return {
            available: false,
            reason: `Transcription service returned status ${res.status}.`,
          };
        }
        return (await res.json()) as TranscribeApiResponse;
      } finally {
        window.clearTimeout(timer);
      }
    };

    try {
      const analysis = audioBuffer
        ? audioAnalysis ?? (await analyzeAudioBuffer(audioBuffer))
        : null;
      if (analysis && !audioAnalysis) {
        setAudioAnalysis(analysis);
      }

      const trackDuration = audioBuffer
        ? audioBuffer.duration
        : project.duration > 0
          ? project.duration
          : 30;

      let createdLines: LyricLine[] = [];
      let sourceMethod: 'ai' | 'id3' | null = null;
      let noVocalsFound = false;
      let serverFailureReason: string | null = null;
      const chunkWarnings: string[] = [];

      const formatMmSs = (sec: number) => {
        const mins = Math.floor(sec / 60);
        const rem = Math.floor(sec % 60);
        return `${mins}:${String(rem).padStart(2, '0')}`;
      };

      const runChunkedTranscription = async (
        mono: Float32Array,
        sampleRate: number,
        startOffsetSec: number,
        trackDur: number,
        seedSegs: ServerSegment[] = []
      ): Promise<{
        segs: ServerSegment[];
        abortedByMissingKey: boolean;
        abortedByQuota: boolean;
        lastFailureReason: string | null;
      }> => {
        // Overlapping 55s chunks (5s overlap) at 22.05kHz preserve crisp consonants (s/t/f/k)
        // and keep per-chunk word-level JSON compact so short pickup words are never skipped.
        const windowSec = 55;
        const overlapSec = 5;
        const stepSec = windowSec - overlapSec;
        const targetRate = 22050;
        const remainingDur = Math.max(1, trackDur - startOffsetSec);
        const totalParts = Math.max(1, Math.ceil(Math.max(1, remainingDur - overlapSec) / stepSec));
        const allSegs: ServerSegment[] = [...seedSegs];
        let abortedByMissingKey = false;
        let abortedByQuota = false;
        let lastFailureReason: string | null = null;

        for (
          let offsetSec = startOffsetSec, partIdx = 1;
          offsetSec < trackDur - 0.5;
          offsetSec += stepSec, partIdx++
        ) {
          if (partIdx > 1) {
            await new Promise((r) => window.setTimeout(r, 1100));
          }
          setSyncStatusText(
            `Transcribing vocals (${Math.min(partIdx, totalParts)} of ${totalParts})...`
          );
          const startSample = Math.floor(offsetSec * sampleRate);
          const endSample = Math.min(
            mono.length,
            Math.floor((offsetSec + windowSec) * sampleRate)
          );
          const clipDur = Math.max(1, (endSample - startSample) / sampleRate);
          const slice = downsampleMono(
            mono.subarray(startSample, endSample),
            sampleRate,
            targetRate
          );
          const chunkWav = encodeFloat32ToWavBlob(slice, targetRate);

          let data: TranscribeApiResponse = { available: false };
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              data = await callTranscribeEndpoint(chunkWav, 'audio/wav', clipDur);
              if (
                data.available ||
                data.errorCode === 'MISSING_API_KEY' ||
                data.errorCode === 'POLICY_BLOCKED'
              ) {
                break;
              }
            } catch (chunkErr) {
              data = {
                available: false,
                reason:
                  chunkErr instanceof Error
                    ? chunkErr.message
                    : 'Chunk request timed out.',
              };
            }
            if (attempt < 3) {
              const backoffMs = data.errorCode === 'QUOTA_EXHAUSTED' ? 3500 * attempt : 1600 * attempt;
              await new Promise((r) => window.setTimeout(r, backoffMs));
            }
          }

          if (!data.available) {
            lastFailureReason =
              data.reason ?? 'Transcription service is currently unavailable.';
            if (data.errorCode === 'MISSING_API_KEY') {
              abortedByMissingKey = true;
              break;
            }
            if (data.errorCode === 'QUOTA_EXHAUSTED') {
              abortedByQuota = true;
              const winEnd = Math.min(trackDur, offsetSec + windowSec);
              chunkWarnings.push(
                `Stopped at ${formatMmSs(offsetSec)}–${formatMmSs(winEnd)} due to API quota limit.`
              );
              break;
            }
            const winEnd = Math.min(trackDur, offsetSec + windowSec);
            chunkWarnings.push(
              `Skipped ${formatMmSs(offsetSec)}–${formatMmSs(winEnd)} after retry failure.`
            );
            if (offsetSec + windowSec >= trackDur) break;
            continue;
          }

          let segs = Array.isArray(data.segments)
            ? data.segments.filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
            : [];
          let chunkNeedsAcousticAlign = data.timingSource === 'estimated';
          if (segs.length === 0 && data.rawText && data.rawText.trim().length > 0) {
            segs = parseTranscriptToSegments(data.rawText, clipDur);
            chunkNeedsAcousticAlign = true;
          }
          if (segs.length > 0 && segs.every((s) => !Number.isFinite(s.start))) {
            chunkNeedsAcousticAlign = true;
          }

          // When a chunk lacks precise timestamps, anchor its lines to real vocal phrases inside [offsetSec, offsetSec + clipDur]
          if (segs.length > 0 && chunkNeedsAcousticAlign && analysis) {
            const tempLines: LyricLine[] = segs.map((s, idx) => ({
              id: `chunk_${partIdx}_${idx}`,
              text: cleanLyricSegmentText(s.text).text || s.text,
              section: normalizeSection(s.section),
              start: offsetSec,
              end: offsetSec + clipDur,
              effect: 'fade',
              effectOverride: false,
              words: [],
            }));
            const alignedChunk = alignLinesToWindow(
              tempLines,
              offsetSec,
              Math.min(trackDur, offsetSec + clipDur),
              analysis
            );
            segs = alignedChunk.map((l) => ({
              text: l.text,
              section: l.section,
              start: Number((l.start - offsetSec).toFixed(2)),
              end: Number((l.end - offsetSec).toFixed(2)),
              words: l.words.map((w) => ({
                text: w.text,
                start: Number((w.start - offsetSec).toFixed(3)),
                end: Number((w.end - offsetSec).toFixed(3)),
              })),
            }));
          }

          for (let sIdx = 0; sIdx < segs.length; sIdx++) {
            const s = segs[sIdx];
            const { text: cleanText, detectedSection } = cleanLyricSegmentText(s.text);
            if (!cleanText) continue;

            const chunkFallbackSlot = clipDur / Math.max(1, segs.length);
            const relStart = Number.isFinite(s.start)
              ? Math.max(0, Math.min(clipDur - 0.35, s.start as number))
              : sIdx * chunkFallbackSlot;
            const relEnd = Number.isFinite(s.end)
              ? Math.max(relStart + 0.35, Math.min(clipDur, s.end as number))
              : Math.min(clipDur, relStart + Math.max(1.2, chunkFallbackSlot - 0.1));

            const absStart = Number((relStart + offsetSec).toFixed(2));
            const absEnd = Number(Math.min(trackDur, relEnd + offsetSec).toFixed(2));
            const resolvedRole = inferVocalRoleFromText(cleanText, s.vocalRole);
            const formattedText = formatLyricForVocalRole(cleanText, resolvedRole);
            const alignedRelWords = alignWordsToCleanText(
              formattedText,
              s.words,
              relStart,
              relEnd,
              s.uncertainWords
            );
            const absWords = alignedRelWords
              ? alignedRelWords.map((w) => ({
                  text: w.text,
                  start: Number((w.start + offsetSec).toFixed(3)),
                  end: Number(Math.min(trackDur, w.end + offsetSec).toFixed(3)),
                  ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
                  ...(w.uncertain ? { uncertain: true } : {}),
                }))
              : undefined;

            const nextSegment: ServerSegment = {
              ...s,
              text: formattedText,
              vocalRole: resolvedRole,
              section:
                s.section && s.section.trim()
                  ? s.section
                  : detectedSection || 'verse',
              start: absStart,
              end: absEnd,
              words: absWords,
            };

            if (offsetSec > startOffsetSec || startOffsetSec > 0) {
              const overlapCutoff =
                offsetSec > startOffsetSec ? offsetSec + overlapSec + 1.5 : startOffsetSec + 6;
              const decision = resolveChunkOverlapSegment(
                allSegs.map((seg) => ({
                  text: seg.text,
                  start: seg.start,
                  end: seg.end,
                  vocalRole: inferVocalRoleFromText(seg.text, seg.vocalRole),
                })),
                {
                  text: formattedText,
                  start: absStart,
                  end: absEnd,
                  vocalRole: resolvedRole,
                },
                overlapCutoff
              );
              if (decision.action === 'skip') {
                continue;
              }
              if (decision.action === 'replace' && decision.replaceIndex !== undefined) {
                allSegs[decision.replaceIndex] = nextSegment;
                continue;
              }
            }

            allSegs.push(nextSegment);
          }

          if (offsetSec + windowSec >= trackDur) break;
        }

        return { segs: allSegs, abortedByMissingKey, abortedByQuota, lastFailureReason };
      };

      if (navigator.onLine && (audioBuffer || audioBlob)) {
        try {
          const detectedMime = normalizeAudioMimeType(
            audioBlob?.type || project.audioMimeType || undefined,
            project.audioFileName ?? undefined
          );
          const supportedDirectMimes = new Set([
            'audio/mp3',
            'audio/mp4',
            'audio/aac',
            'audio/ogg',
            'audio/flac',
            'audio/webm',
            'audio/wav',
          ]);
          // Keep single-pass transcription under 55s and transcribe from decoded 22.05kHz PCM WAV whenever available
          // for crisp consonant word clarity and zero VBR container encoder delay.
          const SINGLE_PASS_MAX_SEC = 55;
          const directCompressedOk =
            !audioBuffer &&
            Boolean(audioBlob) &&
            (audioBlob?.size ?? 0) <= 12 * 1024 * 1024 &&
            trackDuration <= SINGLE_PASS_MAX_SEC &&
            supportedDirectMimes.has(detectedMime);

          const buildAlignedLinesFromResponse = (
            data: TranscribeApiResponse,
            clipDuration: number
          ): LyricLine[] => {
            let segs = Array.isArray(data.segments)
              ? data.segments.filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
              : [];
            let needsAcousticTiming = data.timingSource === 'estimated';
            if (segs.length === 0 && data.rawText && data.rawText.trim().length > 0) {
              segs = parseTranscriptToSegments(data.rawText, clipDuration);
              needsAcousticTiming = true;
            }
            if (segs.length === 0) return [];
            if (segs.every((s) => !Number.isFinite(s.start))) {
              needsAcousticTiming = true;
            }
            const lines = convertSegmentsToLines(segs, clipDuration, Boolean(analysis));
            if (lines.length === 0) return [];
            if (needsAcousticTiming && clipDuration === trackDuration) {
              return analysis
                ? alignLyricsToAudio(lines, analysis).lines
                : distributeLyricsProportionally(lines, clipDuration, []).lines;
            }
            return analysis
              ? refineSegmentsWithAcousticAnalysis(lines, analysis, clipDuration, {
                  preserveAiAnchors: true,
                })
              : lines;
          };

          const maybeExtendTruncatedTail = async (
            initialLines: LyricLine[]
          ): Promise<LyricLine[]> => {
            if (!audioBuffer || initialLines.length === 0) return initialLines;
            const lastEnd = initialLines[initialLines.length - 1].end;
            const truncatedEarly =
              trackDuration > 90 && lastEnd < trackDuration * 0.55 && trackDuration - lastEnd > 22;
            if (!truncatedEarly) return initialLines;

            const hasTailVocals =
              !analysis ||
              analysis.phrases.some((p) => p.end > lastEnd + 5);
            if (!hasTailVocals) return initialLines;

            const seedSegs: ServerSegment[] = initialLines.map((l) => ({
              text: l.text,
              section: l.section,
              start: l.start,
              end: l.end,
              words: l.words,
            }));
            const mono = mixDownToMono(audioBuffer);
            const resumeFrom = Math.max(0, lastEnd - 4);
            const tailRes = await runChunkedTranscription(
              mono,
              audioBuffer.sampleRate,
              resumeFrom,
              trackDuration,
              seedSegs
            );
            if (tailRes.segs.length <= seedSegs.length) return initialLines;
            const rawConverted = convertSegmentsToLines(tailRes.segs, trackDuration, Boolean(analysis));
            return analysis
              ? refineSegmentsWithAcousticAnalysis(rawConverted, analysis, trackDuration, {
                  preserveAiAnchors: true,
                })
              : rawConverted;
          };

          if (directCompressedOk && audioBlob) {
            const data = await callTranscribeEndpoint(
              audioBlob,
              detectedMime,
              trackDuration
            );
            if (!data.available) {
              serverFailureReason =
                data.reason ?? 'Transcription service is currently unavailable.';
            } else {
              const built = buildAlignedLinesFromResponse(data, trackDuration);
              if (built.length > 0) {
                createdLines = await maybeExtendTruncatedTail(built);
                sourceMethod = 'ai';
              } else if (data.vocalsDetected === false) {
                noVocalsFound = true;
              }
            }
          } else if (audioBuffer) {
            const mono = mixDownToMono(audioBuffer);
            if (trackDuration <= SINGLE_PASS_MAX_SEC) {
              const resampled = downsampleMono(mono, audioBuffer.sampleRate, 22050);
              const wavBlob = encodeFloat32ToWavBlob(resampled, 22050);
              const data = await callTranscribeEndpoint(
                wavBlob,
                'audio/wav',
                trackDuration
              );
              if (!data.available) {
                serverFailureReason =
                  data.reason ?? 'Transcription service is currently unavailable.';
              } else {
                const built = buildAlignedLinesFromResponse(data, trackDuration);
                if (built.length > 0) {
                  createdLines = await maybeExtendTruncatedTail(built);
                  sourceMethod = 'ai';
                } else if (data.vocalsDetected === false) {
                  noVocalsFound = true;
                }
              }
            } else {
              const chunked = await runChunkedTranscription(
                mono,
                audioBuffer.sampleRate,
                0,
                trackDuration
              );
              if (chunked.lastFailureReason) {
                serverFailureReason = chunked.lastFailureReason;
              }
              if (!chunked.abortedByMissingKey && chunked.segs.length > 0) {
                const rawConverted = convertSegmentsToLines(chunked.segs, trackDuration, Boolean(analysis));
                createdLines = analysis
                  ? refineSegmentsWithAcousticAnalysis(rawConverted, analysis, trackDuration, {
                      preserveAiAnchors: true,
                    })
                  : rawConverted;
                sourceMethod = 'ai';
              } else if (!serverFailureReason && chunked.segs.length === 0) {
                noVocalsFound = true;
              }
            }
          }
        } catch (err) {
          serverFailureReason =
            err instanceof Error && err.name === 'AbortError'
              ? 'Vocal transcription timed out; try again or paste lyrics manually.'
              : err instanceof Error
                ? err.message
                : 'Could not reach transcription service.';
        }
      }

      // Secondary local fallback: extract embedded ID3v2 USLT/TXXX lyrics if present in audio file
      if (createdLines.length === 0 && audioBlob) {
        const embeddedText = await extractId3LyricsFromBlob(audioBlob);
        if (embeddedText) {
          const parsedId3 = parseLyricsText(embeddedText, trackDuration);
          if (parsedId3.lines.length > 0) {
            if (parsedId3.hasLrcTimestamps) {
              createdLines = parsedId3.lines;
            } else if (analysis) {
              createdLines = alignLyricsToAudio(parsedId3.lines, analysis).lines;
            } else {
              createdLines = distributeLyricsProportionally(
                parsedId3.lines,
                trackDuration,
                []
              ).lines;
            }
            sourceMethod = 'id3';
          }
        }
      }

      if (createdLines.length > 0) {
        const finalLines = project.autoEffectsEnabled
          ? assignAutoEffects(createdLines, project.autoEffectStyle, false)
          : createdLines;

        setSyncError(null);
        setProject((prev) => ({
          ...prev,
          duration: prev.duration > 0 ? prev.duration : Number(trackDuration.toFixed(2)),
          lyrics: finalLines,
          syncReport: {
            method: sourceMethod === 'id3' ? 'lrc-import' : 'ai-acoustic',
            confidence: analysis && analysis.dynamicRange >= 0.12 ? 0.91 : 0.84,
            matchedPhrases: finalLines.length,
            totalLines: finalLines.length,
            warnings: chunkWarnings,
            timestamp: Date.now(),
          },
        }));

        setAutoReviewActive(true);
        setMobilePane('lyrics');
        if (finalLines[0]) {
          setSelectedLineId(finalLines[0].id);
          const previewPoint =
            finalLines[0].start +
            Math.min(0.45, Math.max(0.08, (finalLines[0].end - finalLines[0].start) * 0.4));
          handleSeek(Math.min(trackDuration, previewPoint));
        }

        showToast(
          chunkWarnings.length > 0
            ? `Lyrics created (${chunkWarnings.length} section${chunkWarnings.length > 1 ? 's' : ''} had incomplete audio and may need manual review).`
            : sourceMethod === 'id3'
              ? `Imported ${finalLines.length} embedded ID3 lyrics lines and synced to audio.`
              : 'Lyrics created. Review and edit any line while previewing.'
        );
      } else if (noVocalsFound && !serverFailureReason) {
        setSyncError(null);
        showToast('Instrumental track detected — [instrumental] will display automatically during playback & export.');
      } else {
        // Never overwrite cues with silent blank empty text boxes when no lyrics were extracted
        const errMsg = serverFailureReason
          ? serverFailureReason
          : !navigator.onLine
            ? 'Offline mode: connect to the internet for Auto Transcribe, or paste/import lyrics manually.'
            : 'Could not generate lyrics from this audio track. Paste lyrics, import a .txt/.lrc file, or create timed cue slots.';
        setSyncError(errMsg);
        setMobilePane('lyrics');
        showToast(errMsg);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not create lyrics automatically. Try pasting lyrics manually.';
      setSyncError(msg);
      showToast(msg);
    } finally {
      setIsSyncing(false);
      setSyncStatusText('');
    }
  }, [
    audioBlob,
    audioBuffer,
    audioAnalysis,
    analyzeAudioBuffer,
    handleSeek,
    project.audioFileName,
    project.audioMimeType,
    project.duration,
    project.language,
    project.autoEffectsEnabled,
    project.autoEffectStyle,
    showToast,
  ]);

  // Apply bulk edits from Review & Edit text box while preserving synced timings when line count matches
  const handleApplyBulkEditText = useCallback(
    (rawText: string) => {
      const targetDuration = project.duration > 0 ? project.duration : 30;
      const parsed = parseLyricsText(rawText, targetDuration);
      if (parsed.lines.length === 0) return;

      let nextLines: LyricLine[];
      if (
        !parsed.hasLrcTimestamps &&
        parsed.lines.length === project.lyrics.length &&
        project.lyrics.length > 0
      ) {
        nextLines = project.lyrics.map((existing, idx) => {
          const parsedLine = parsed.lines[idx];
          const nextRole = parsedLine.vocalRole ?? existing.vocalRole ?? 'lead';
          const merged: LyricLine = {
            ...existing,
            text: parsedLine.text,
            section: parsedLine.section,
            vocalRole: nextRole,
            uncertain: false,
          };
          return audioAnalysis
            ? {
                ...merged,
                words: snapWordTimingsToOnsets(
                  merged.text,
                  merged.start,
                  merged.end,
                  audioAnalysis.onsets,
                  merged.id,
                  audioAnalysis.envelope,
                  audioAnalysis.frameDurationSec
                ),
              }
            : redistributeWordTimings(merged);
        });
      } else if (audioAnalysis && !parsed.hasLrcTimestamps) {
        nextLines = alignLyricsToAudio(parsed.lines, audioAnalysis).lines;
      } else if (!parsed.hasLrcTimestamps && project.duration > 0) {
        nextLines = distributeLyricsProportionally(
          parsed.lines,
          project.duration,
          audioAnalysis?.onsets ?? []
        ).lines;
      } else {
        nextLines = parsed.lines;
      }

      const finalLines = project.autoEffectsEnabled
        ? assignAutoEffects(nextLines, project.autoEffectStyle, true)
        : nextLines;

      setProject((prev) => ({
        ...prev,
        lyrics: finalLines,
      }));
      if (finalLines[0]) {
        setSelectedLineId(finalLines[0].id);
        handleSeek(finalLines[0].start + 0.05);
      }
      showToast('Updated lyrics.');
    },
    [
      audioAnalysis,
      handleSeek,
      project.autoEffectStyle,
      project.autoEffectsEnabled,
      project.duration,
      project.lyrics,
      showToast,
    ]
  );

  // Automatic Lyrics Synchronization (hardened with proportional cadence fallback)
  const handleRunAutoSync = useCallback(async () => {
    if ((!audioBuffer && !project.audioFileName) || project.lyrics.length === 0) return;
    setSyncError(null);
    setIsSyncing(true);
    setSyncStatusText('Analysing vocal frequencies & onsets...');

    try {
      let syncedResult: ReturnType<typeof alignLyricsToAudio>;
      const fallbackDuration =
        project.duration > 0 ? project.duration : Math.max(project.lyrics.length * 2.5, 10);

      if (!audioBuffer) {
        const audioDur =
          audioElRef.current && Number.isFinite(audioElRef.current.duration) && audioElRef.current.duration > 0
            ? audioElRef.current.duration
            : fallbackDuration;
        syncedResult = distributeLyricsProportionally(
          project.lyrics,
          audioDur,
          [],
          'Applied proportional cadence distribution across the audio duration; fine-tune cues on the timeline if needed.',
          0.38
        );
      } else {
        const analysis = audioAnalysis ?? (await analyzeAudioBuffer(audioBuffer));
        if (!audioAnalysis) setAudioAnalysis(analysis);

        syncedResult = alignLyricsToAudio(project.lyrics, analysis);

        if (navigator.onLine) {
          setSyncStatusText('Aligning vocal phrases...');
          try {
            const mono = mixDownToMono(audioBuffer);
            const trackDur = audioBuffer.duration;
            const targetSyncRate = 16000;

            if (trackDur <= 135) {
              const controller = new AbortController();
              const fetchTimer = window.setTimeout(() => controller.abort(), 120_000);
              try {
                const downsampled = downsampleMono(mono, audioBuffer.sampleRate, targetSyncRate);
                const wavSync = encodeFloat32ToWavBlob(downsampled, targetSyncRate);
                if (wavSync.size <= 16 * 1024 * 1024) {
                  const base64 = await blobToBase64(wavSync);
                  const res = await fetch('/api/sync-lyrics', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                      audioBase64: base64,
                      mimeType: 'audio/wav',
                      duration: trackDur,
                      language: project.language || 'auto',
                      lines: project.lyrics.map((l, idx) => ({ index: idx, text: l.text })),
                    }),
                  });
                  if (res.ok) {
                    const aiData = (await res.json()) as {
                      available: boolean;
                      vocalsDetected?: boolean;
                      notes?: string[];
                      segments?: Array<{
                        lineIndex: number;
                        start: number;
                        end: number;
                        words?: Array<{ text: string; start: number; end: number }>;
                      }>;
                    };
                    if (
                      aiData.available &&
                      aiData.vocalsDetected &&
                      Array.isArray(aiData.segments) &&
                      aiData.segments.length > 0
                    ) {
                      syncedResult = refineWithAiTimestamps(
                        project.lyrics,
                        aiData.segments,
                        analysis.onsets,
                        trackDur,
                        aiData.notes ?? [],
                        analysis
                      );
                    } else if (aiData.available && aiData.vocalsDetected === false) {
                      syncedResult = {
                        ...syncedResult,
                        report: {
                          ...syncedResult.report,
                          confidence: Math.min(syncedResult.report.confidence, 0.48),
                          warnings: [
                            ...(aiData.notes ?? []),
                            ...syncedResult.report.warnings,
                          ].slice(0, 2),
                        },
                      };
                    }
                  }
                }
              } finally {
                window.clearTimeout(fetchTimer);
              }
            } else {
              // Windowed forced alignment for 2-10+ minute tracks prevents mid/late-song timing drift
              const winSec = 110;
              const overlapSec = 20;
              const stepSec = winSec - overlapSec;
              const totalParts = Math.max(1, Math.ceil(Math.max(1, trackDur - overlapSec) / stepSec));
              const seedEstimates = syncedResult.lines;
              const matchedBest = new Map<
                number,
                {
                  lineIndex: number;
                  start: number;
                  end: number;
                  centerDist: number;
                  words?: Array<{ text: string; start: number; end: number }>;
                }
              >();
              const notesCollected: string[] = [];

              for (
                let winStart = 0, partIdx = 1;
                winStart < trackDur - 0.5;
                winStart += stepSec, partIdx++
              ) {
                if (partIdx > 1) {
                  await new Promise((r) => window.setTimeout(r, 900));
                }
                setSyncStatusText(
                  `Aligning vocal phrases (${Math.min(partIdx, totalParts)} of ${totalParts})...`
                );

                const sSample = Math.floor(winStart * audioBuffer.sampleRate);
                const eSample = Math.min(
                  mono.length,
                  Math.floor((winStart + winSec) * audioBuffer.sampleRate)
                );
                const clipDur = Math.max(1, (eSample - sSample) / audioBuffer.sampleRate);
                const winEnd = winStart + clipDur;

                // Select candidate lines likely falling within [winStart - 45, winEnd + 45]
                let candidateIndices: number[] = [];
                seedEstimates.forEach((est, idx) => {
                  if (est.end >= winStart - 45 && est.start <= winEnd + 45) {
                    candidateIndices.push(idx);
                  }
                });
                if (candidateIndices.length === 0) {
                  const midProgress = (winStart + clipDur * 0.5) / Math.max(1, trackDur);
                  const approxCenterIdx = Math.round(midProgress * (project.lyrics.length - 1));
                  const lo = Math.max(0, approxCenterIdx - 8);
                  const hi = Math.min(project.lyrics.length - 1, approxCenterIdx + 8);
                  for (let k = lo; k <= hi; k++) candidateIndices.push(k);
                } else {
                  const first = Math.max(0, candidateIndices[0] - 2);
                  const last = Math.min(
                    project.lyrics.length - 1,
                    candidateIndices[candidateIndices.length - 1] + 2
                  );
                  candidateIndices = [];
                  for (let k = first; k <= last; k++) candidateIndices.push(k);
                }

                const slice = downsampleMono(
                  mono.subarray(sSample, eSample),
                  audioBuffer.sampleRate,
                  targetSyncRate
                );
                const wavChunk = encodeFloat32ToWavBlob(slice, targetSyncRate);
                const base64 = await blobToBase64(wavChunk);

                const controller = new AbortController();
                const fetchTimer = window.setTimeout(() => controller.abort(), 95_000);
                try {
                  const res = await fetch('/api/sync-lyrics', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                      audioBase64: base64,
                      mimeType: 'audio/wav',
                      duration: clipDur,
                      language: project.language || 'auto',
                      isWindowedClip: true,
                      clipStartSec: winStart,
                      lines: candidateIndices.map((idx) => ({
                        index: idx,
                        text: project.lyrics[idx].text,
                      })),
                    }),
                  });
                  if (res.ok) {
                    const aiData = (await res.json()) as {
                      available: boolean;
                      errorCode?: string;
                      vocalsDetected?: boolean;
                      notes?: string[];
                      segments?: Array<{
                        lineIndex: number;
                        start: number;
                        end: number;
                        words?: Array<{ text: string; start: number; end: number }>;
                      }>;
                    };
                    if (aiData.errorCode === 'MISSING_API_KEY') break;
                    if (Array.isArray(aiData.notes)) {
                      for (const n of aiData.notes) {
                        if (notesCollected.length < 3 && !notesCollected.includes(n)) {
                          notesCollected.push(n);
                        }
                      }
                    }
                    if (aiData.available && Array.isArray(aiData.segments)) {
                      const clipCenter = clipDur * 0.5;
                      for (const seg of aiData.segments) {
                        if (!Number.isInteger(seg.lineIndex)) continue;
                        if (seg.lineIndex < 0 || seg.lineIndex >= project.lyrics.length) continue;
                        const absStart = Number(Math.max(0, Math.min(trackDur - 0.35, seg.start + winStart)).toFixed(2));
                        const absEnd = Number(Math.max(absStart + 0.35, Math.min(trackDur, seg.end + winStart)).toFixed(2));
                        const centerDist = Math.abs((seg.start + seg.end) * 0.5 - clipCenter);
                        const existing = matchedBest.get(seg.lineIndex);
                        if (!existing || centerDist < existing.centerDist) {
                          matchedBest.set(seg.lineIndex, {
                            lineIndex: seg.lineIndex,
                            start: absStart,
                            end: absEnd,
                            centerDist,
                            words: Array.isArray(seg.words)
                              ? seg.words.map((w) => ({
                                  text: w.text,
                                  start: Number((Number(w.start) + winStart).toFixed(3)),
                                  end: Number((Number(w.end) + winStart).toFixed(3)),
                                }))
                              : undefined,
                          });
                        }
                      }
                    }
                  }
                } catch {
                  // Continue remaining windows even if one chunk failed
                } finally {
                  window.clearTimeout(fetchTimer);
                }
                if (winStart + winSec >= trackDur) break;
              }

              if (matchedBest.size > 0) {
                const orderedSegments = Array.from(matchedBest.values())
                  .sort((a, b) => a.lineIndex - b.lineIndex)
                  .map(({ lineIndex, start, end, words }) => ({ lineIndex, start, end, words }));

                // Drop any outlier segment that jumps backwards relative to an earlier matched line
                const monotonicSegments: typeof orderedSegments = [];
                for (const seg of orderedSegments) {
                  const prev = monotonicSegments[monotonicSegments.length - 1];
                  if (!prev || seg.start >= prev.start - 0.25) {
                    monotonicSegments.push(seg);
                  }
                }

                syncedResult = refineWithAiTimestamps(
                  project.lyrics,
                  monotonicSegments,
                  analysis.onsets,
                  trackDur,
                  notesCollected,
                  analysis
                );
              }
            }
          } catch {
            // Local acoustic or proportional alignment already computed safely
          }
        }
      }

      const finalLines = project.autoEffectsEnabled
        ? assignAutoEffects(syncedResult.lines, project.autoEffectStyle, true)
        : syncedResult.lines;

      setProject((prev) => ({
        ...prev,
        lyrics: finalLines,
        syncReport: syncedResult.report,
      }));
      showToast('Lyrics timing updated.');
    } catch {
      const safeDuration =
        project.duration > 0 ? project.duration : Math.max(project.lyrics.length * 2.5, 10);
      const fallback = distributeLyricsProportionally(
        project.lyrics,
        safeDuration,
        audioAnalysis?.onsets ?? [],
        'Applied proportional cadence distribution across the track duration.',
        0.36
      );
      const finalLines = project.autoEffectsEnabled
        ? assignAutoEffects(fallback.lines, project.autoEffectStyle, true)
        : fallback.lines;
      setProject((prev) => ({
        ...prev,
        lyrics: finalLines,
        syncReport: fallback.report,
      }));
      showToast('Applied proportional lyrics timing.');
    } finally {
      setIsSyncing(false);
      setSyncStatusText('');
    }
  }, [
    audioBuffer,
    audioAnalysis,
    analyzeAudioBuffer,
    project.audioFileName,
    project.duration,
    project.language,
    project.lyrics,
    project.autoEffectsEnabled,
    project.autoEffectStyle,
    showToast,
  ]);

  const handleChangeLanguage = useCallback((language: string) => {
    setProject((prev) => ({
      ...prev,
      language,
    }));
  }, []);

  // Line editing handlers
  const handleAddLine = useCallback(() => {
    const last = project.lyrics[project.lyrics.length - 1];
    const start = last ? Number((last.end + 0.2).toFixed(2)) : 0.5;
    const end = Number((start + 3.0).toFixed(2));
    const id = `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newLine: LyricLine = redistributeWordTimings({
      id,
      text: 'Lyric line',
      section: last?.section ?? 'verse',
      start,
      end,
      effect: project.autoEffectsEnabled ? 'fade' : 'none',
      effectOverride: false,
      words: [],
    });

    setProject((prev) => {
      const updated = [...prev.lyrics, newLine];
      return {
        ...prev,
        duration: Math.max(prev.duration, Math.ceil(end + 1)),
        lyrics: prev.autoEffectsEnabled
          ? assignAutoEffects(updated, prev.autoEffectStyle, true)
          : updated,
      };
    });
    setSelectedLineId(id);
  }, [project.lyrics, project.autoEffectsEnabled, project.autoEffectStyle]);

  const handleUpdateLine = useCallback(
    (id: string, patch: Partial<LyricLine>) => {
      setProject((prev) => ({
        ...prev,
        lyrics: prev.lyrics.map((l) => {
          if (l.id !== id) return l;
          const nextPatch: Partial<LyricLine> = { ...patch };
          // Keep lyrics clean without outer parentheses across vocal roles
          if (nextPatch.vocalRole !== undefined && nextPatch.text === undefined) {
            nextPatch.text = formatLyricForVocalRole(l.text, nextPatch.vocalRole);
          }
          if (nextPatch.text !== undefined && nextPatch.uncertain === undefined) {
            nextPatch.uncertain = false;
          }
          const merged = { ...l, ...nextPatch };
          if (
            nextPatch.text !== undefined ||
            nextPatch.start !== undefined ||
            nextPatch.end !== undefined
          ) {
            const rebuiltWords = audioAnalysis
              ? snapWordTimingsToOnsets(
                  merged.text,
                  merged.start,
                  merged.end,
                  audioAnalysis.onsets,
                  merged.id,
                  audioAnalysis.envelope,
                  audioAnalysis.frameDurationSec
                )
              : redistributeWordTimings(merged).words;
            const prevWords = l.words ?? [];
            const wordsWithMeta =
              nextPatch.text === undefined
                ? rebuiltWords.map((w, idx) => {
                    const prevW = prevWords[idx];
                    if (
                      prevW &&
                      (prevW.confidence !== undefined || prevW.uncertain)
                    ) {
                      return {
                        ...w,
                        ...(prevW.confidence !== undefined ? { confidence: prevW.confidence } : {}),
                        ...(prevW.uncertain ? { uncertain: true } : {}),
                      };
                    }
                    return w;
                  })
                : rebuiltWords;
            return {
              ...merged,
              words: wordsWithMeta,
            };
          }
          return merged;
        }),
      }));
    },
    [audioAnalysis]
  );

  const handleUpdateWordText = useCallback(
    (lineId: string, wordId: string, newText: string) => {
      setProject((prev) => ({
        ...prev,
        lyrics: prev.lyrics.map((l) => {
          if (l.id !== lineId) return l;
          const nextWords = l.words.map((w) =>
            w.id === wordId ? { ...w, text: newText, uncertain: false, confidence: 1 } : w
          );
          const nextLineText = nextWords.map((w) => w.text.trim()).filter(Boolean).join(' ');
          const stillUncertain = nextWords.some((w) => w.uncertain);
          return {
            ...l,
            words: nextWords,
            text: nextLineText,
            uncertain: stillUncertain,
          };
        }),
      }));
    },
    []
  );

  const handleMoveLine = useCallback((id: string, direction: -1 | 1) => {
    setProject((prev) => {
      const idx = prev.lyrics.findIndex((l) => l.id === id);
      if (idx === -1) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.lyrics.length) return prev;
      const next = [...prev.lyrics];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return { ...prev, lyrics: next };
    });
  }, []);

  const handleDeleteLine = useCallback(
    (id: string) => {
      setProject((prev) => ({
        ...prev,
        lyrics: prev.lyrics.filter((l) => l.id !== id),
      }));
      if (selectedLineId === id) setSelectedLineId(null);
    },
    [selectedLineId]
  );

  const handleUpdateLineTiming = useCallback(
    (id: string, start: number, end: number) => {
      handleUpdateLine(id, { start, end });
    },
    [handleUpdateLine]
  );

  const handleShiftAllLyricsTiming = useCallback(
    (deltaSec: number) => {
      if (project.lyrics.length === 0) return;
      const targetDur = project.duration > 0 ? project.duration : 300;
      setProject((prev) => ({
        ...prev,
        lyrics: shiftLyricsTiming(prev.lyrics, deltaSec, targetDur),
      }));
      const ms = Math.round(deltaSec * 1000);
      showToast(`Shifted all cues ${ms > 0 ? `+${ms}` : ms}ms.`);
    },
    [project.duration, project.lyrics.length, showToast]
  );

  // Typography, Vocal Layers & Background handlers
  const handleChangeTypography = useCallback((patch: Partial<TypographyStyle>) => {
    setProject((prev) => ({
      ...prev,
      typography: { ...prev.typography, ...patch },
    }));
  }, []);

  const handleChangeVocalLayers = useCallback(
    (patch: VocalLayersPatch) => {
      setProject((prev) => {
        const current = prev.vocalLayers ?? DEFAULT_VOCAL_LAYERS;
        return {
          ...prev,
          vocalLayers: {
            ...DEFAULT_VOCAL_LAYERS,
            ...current,
            ...patch,
            backing: {
              ...DEFAULT_VOCAL_LAYERS.backing,
              ...(current.backing ?? {}),
              ...(patch.backing ?? {}),
            },
          },
        };
      });
    },
    []
  );

  const handleChangeBackground = useCallback((patch: Partial<BackgroundConfig>) => {
    setProject((prev) => ({
      ...prev,
      background: { ...prev.background, ...patch },
    }));
  }, []);

  const handleChangeWatermark = useCallback((patch: Partial<WatermarkConfig>) => {
    setProject((prev) => ({
      ...prev,
      watermark: { ...DEFAULT_WATERMARK, ...(prev.watermark ?? {}), ...patch },
    }));
  }, []);

  const handleFillLongSongCues = useCallback(async () => {
    if (project.lyrics.length === 0) return;
    const trackDur = audioBuffer
      ? audioBuffer.duration
      : project.duration > 0
        ? project.duration
        : 300;
    if (trackDur <= 150) return;

    const analysis = audioBuffer
      ? audioAnalysis ?? (await analyzeAudioBuffer(audioBuffer))
      : audioAnalysis;
    if (analysis && !audioAnalysis) {
      setAudioAnalysis(analysis);
    }

    const filledLines = fillRemainingSongCuesWithAnalysis(project.lyrics, trackDur, analysis);
    const finalLines = project.autoEffectsEnabled
      ? assignAutoEffects(filledLines, project.autoEffectStyle, true)
      : filledLines;

    setProject((prev) => ({
      ...prev,
      lyrics: finalLines,
      updatedAt: Date.now(),
    }));
    showToast('Filled remaining song timeline aligned to vocal phrases.');
  }, [
    analyzeAudioBuffer,
    audioAnalysis,
    audioBuffer,
    project.autoEffectStyle,
    project.autoEffectsEnabled,
    project.duration,
    project.lyrics,
    showToast,
  ]);

  const handleCreateWorshipTemplate = useCallback(async () => {
    const trackDuration = audioBuffer
      ? audioBuffer.duration
      : project.duration > 0
        ? project.duration
        : 300;
    const analysis = audioBuffer
      ? audioAnalysis ?? (await analyzeAudioBuffer(audioBuffer))
      : audioAnalysis;
    if (analysis && !audioAnalysis) {
      setAudioAnalysis(analysis);
    }

    const stamp = Date.now();
    const templateTexts = [
      { text: "You are here, moving in our midst", section: "verse" },
      { text: "I worship You, I worship You", section: "verse" },
      { text: "You are here, working in this place", section: "verse" },
      { text: "I worship You, I worship You", section: "verse" },
      { text: "Jireh, You are enough", section: "chorus" },
      { text: "Jireh, You are enough", section: "chorus" },
      { text: "I will be content in every circumstance", section: "pre-chorus" },
      { text: "Jireh, You are enough", section: "chorus" },
      { text: "I'll never be more loved than I am right now", section: "bridge" },
      { text: "You're enough, yeah, you're enough", section: "bridge" },
      { text: "Greater love has no one than this", section: "bridge" },
      { text: "That You laid down Your life for us", section: "bridge" },
      { text: "Jireh, You are enough", section: "chorus" },
    ];

    const seedLines: LyricLine[] = templateTexts.map((item, idx) => {
      const id = `line_tmpl_${stamp}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      return {
        id,
        text: item.text,
        section: item.section as SectionType,
        start: idx * 4,
        end: idx * 4 + 3.5,
        effect: 'fade' as EffectType,
        effectOverride: false,
        words: [],
      };
    });

    const syncedLines = analysis
      ? alignLyricsToAudio(seedLines, analysis).lines
      : distributeLyricsProportionally(seedLines, trackDuration, []).lines;
    const finalLines = project.autoEffectsEnabled
      ? assignAutoEffects(syncedLines, project.autoEffectStyle, true)
      : syncedLines;

    setProject((prev) => ({
      ...prev,
      duration: Math.max(prev.duration, trackDuration),
      lyrics: resolveLineOverlaps(finalLines, trackDuration),
      updatedAt: Date.now(),
    }));
    setSyncError(null);
    showToast('Generated worship template lyrics aligned to audio.');
  }, [
    analyzeAudioBuffer,
    audioAnalysis,
    audioBuffer,
    project.autoEffectStyle,
    project.autoEffectsEnabled,
    project.duration,
    showToast,
  ]);

  const handleUploadBackgroundMedia = useCallback(
    (file: File) => {
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      attachBackgroundMediaBlob(file, file.name, mediaType);
      showToast(`Applied background ${mediaType} "${file.name}".`);
    },
    [attachBackgroundMediaBlob, showToast]
  );

  // Effects handlers
  const handleToggleAutoEffects = useCallback((enabled: boolean) => {
    setProject((prev) => ({
      ...prev,
      autoEffectsEnabled: enabled,
      lyrics: enabled
        ? assignAutoEffects(prev.lyrics, prev.autoEffectStyle, true)
        : prev.lyrics,
    }));
  }, []);

  const handleChangeAutoStyle = useCallback((style: AutoEffectStyle) => {
    setProject((prev) => ({
      ...prev,
      autoEffectStyle: style,
      lyrics: prev.autoEffectsEnabled
        ? assignAutoEffects(prev.lyrics, style, true)
        : prev.lyrics,
    }));
  }, []);

  const handleApplyAutoEffectsAll = useCallback(() => {
    setProject((prev) => ({
      ...prev,
      autoEffectsEnabled: true,
      lyrics: assignAutoEffects(
        prev.lyrics.map((l) => ({ ...l, effectOverride: false })),
        prev.autoEffectStyle,
        false
      ),
    }));
    showToast('Re-applied Auto Effects across all lyric lines.');
  }, [showToast]);

  const handleOverrideLineEffect = useCallback((lineId: string, effect: EffectType) => {
    setProject((prev) => ({
      ...prev,
      lyrics: prev.lyrics.map((l) =>
        l.id === lineId ? { ...l, effect, effectOverride: true } : l
      ),
    }));
  }, []);

  const handleResetLineOverride = useCallback((lineId: string) => {
    setProject((prev) => ({
      ...prev,
      lyrics: assignAutoEffects(
        prev.lyrics.map((l) =>
          l.id === lineId ? { ...l, effectOverride: false } : l
        ),
        prev.autoEffectStyle,
        true
      ),
    }));
  }, []);

  // Project Management Handlers
  const refreshProjectsList = useCallback(async () => {
    try {
      const list = await listProjectsFromDb();
      setSavedProjects(list.filter((p) => !isLegacyDemoProject(p)));
    } catch {
      showToast('Could not read saved projects from browser storage.');
    }
  }, [showToast]);

  const handleSaveCurrentProject = useCallback(async () => {
    try {
      await saveProjectToDb(project, audioBlob, bgMediaBlob);
      await refreshProjectsList();
      showToast(`Saved "${project.name}".`);
    } catch {
      showToast('Could not save project to browser storage.');
    }
  }, [project, audioBlob, bgMediaBlob, refreshProjectsList, showToast]);

  const handleResetToNewWorkspace = useCallback(
    (name = 'Untitled Project', saveImmediately = false) => {
      const fresh = createNewProject(name);
      setProject(fresh);
      setAudioBlob(null);
      setAudioBuffer(null);
      setAudioAnalysis(null);
      setBgMediaBlob(null);
      setSelectedLineId(null);
      setAutoReviewActive(false);
      setSyncError(null);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      isPlayingRef.current = false;
      setIsPlaying(false);
      stopWebAudio();
      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.removeAttribute('src');
      }
      mediaCacheRef.current.videoElement = null;
      if (saveImmediately) {
        void saveProjectToDb(fresh, null, null)
          .then(refreshProjectsList)
          .catch(() => {
            showToast('Could not persist new project to browser storage.');
          });
      }
      showToast(`Started new project "${fresh.name}".`);
    },
    [refreshProjectsList, showToast, stopWebAudio]
  );

  const handleCreateNewProject = useCallback(
    async (name: string) => {
      handleResetToNewWorkspace(name || 'Untitled Project', true);
    },
    [handleResetToNewWorkspace]
  );

  const handleOpenProject = useCallback(
    async (id: string) => {
      try {
        const loaded = await loadProjectFromDb(id);
        if (!loaded) {
          showToast('Project could not be found in storage.');
          return;
        }
        setProject(loaded.project);
        setSelectedLineId(loaded.project.lyrics[0]?.id ?? null);
        setAutoReviewActive(false);
        setSyncError(null);
        currentTimeRef.current = 0;
        setCurrentTime(0);
        isPlayingRef.current = false;
        setIsPlaying(false);
        stopWebAudio();

        if (loaded.audioBlob && loaded.project.audioFileName) {
          await attachAudioBlob(loaded.audioBlob, loaded.project.audioFileName, false);
        } else {
          setAudioBlob(null);
          setAudioBuffer(null);
          setAudioAnalysis(null);
          if (audioElRef.current) {
            audioElRef.current.pause();
            audioElRef.current.removeAttribute('src');
          }
        }

        if (loaded.bgMediaBlob && loaded.project.background.mediaName) {
          const bgType = loaded.project.background.type === 'video' ? 'video' : 'image';
          attachBackgroundMediaBlob(
            loaded.bgMediaBlob,
            loaded.project.background.mediaName,
            bgType
          );
        } else {
          setBgMediaBlob(null);
          mediaCacheRef.current.videoElement = null;
        }

        showToast(`Opened "${loaded.project.name}".`);
      } catch {
        showToast('Could not open project from browser storage.');
      }
    },
    [attachAudioBlob, attachBackgroundMediaBlob, showToast, stopWebAudio]
  );

  const handleDuplicateProject = useCallback(
    async (id: string) => {
      try {
        const copy = await duplicateProjectInDb(id);
        await refreshProjectsList();
        if (copy) showToast(`Duplicated as "${copy.name}".`);
      } catch {
        showToast('Could not duplicate project.');
      }
    },
    [refreshProjectsList, showToast]
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      try {
        await deleteProjectFromDb(id);
        await refreshProjectsList();
        showToast('Project deleted.');
      } catch {
        showToast('Could not delete project.');
      }
    },
    [refreshProjectsList, showToast]
  );

  const handleRenameProjectById = useCallback(
    async (id: string, name: string) => {
      try {
        if (id === project.id) {
          const updated = { ...project, name, updatedAt: Date.now() };
          setProject(updated);
          await saveProjectToDb(updated, audioBlob, bgMediaBlob);
        } else {
          const loaded = await loadProjectFromDb(id);
          if (loaded) {
            await saveProjectToDb(
              { ...loaded.project, name },
              loaded.audioBlob,
              loaded.bgMediaBlob
            );
          }
        }
        await refreshProjectsList();
      } catch {
        showToast('Could not rename project.');
      }
    },
    [project, audioBlob, bgMediaBlob, refreshProjectsList, showToast]
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditingText =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSaveCurrentProject();
        return;
      }

      if (isEditingText || tapSyncOpen) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleSeek(currentTime - (e.shiftKey ? 5 : 1));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        handleSeek(currentTime + (e.shiftKey ? 5 : 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleSaveCurrentProject,
    handleTogglePlay,
    handleSeek,
    currentTime,
    tapSyncOpen,
  ]);

  const selectedLine = useMemo(
    () => project.lyrics.find((l) => l.id === selectedLineId) ?? null,
    [project.lyrics, selectedLineId]
  );

  const handlePreviewLine = useCallback(() => {
    if (selectedLine) {
      handleSeek(selectedLine.start);
      isPlayingRef.current = true;
      setIsPlaying(true);
    } else if (project.lyrics[0]) {
      setSelectedLineId(project.lyrics[0].id);
      handleSeek(project.lyrics[0].start);
      isPlayingRef.current = true;
      setIsPlaying(true);
    } else if (project.duration > 0) {
      handlePlay();
    }
  }, [selectedLine, project.lyrics, project.duration, handleSeek, handlePlay]);

  const mediaCacheForRender = useMemo<MediaAssetCache>(
    () => ({
      images: mediaCacheRef.current.images,
      videos: mediaCacheRef.current.videos,
      videoElement: mediaCacheRef.current.videoElement,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaRenderTick, project.background]
  );

  return (
    <div className="h-[100dvh] sm:h-screen w-full flex flex-col overflow-hidden bg-[#121922] text-[#EEF3F8]">
      <TopBar
        onNewProject={() => handleResetToNewWorkspace('Untitled Project', false)}
        onOpenProjects={() => {
          void refreshProjectsList();
          setProjectsModalOpen(true);
        }}
        onOpenTapSync={() => setTapSyncOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenExport={() => setExportModalOpen(true)}
      />

      {/* Mobile Workspace Switcher (< lg) */}
      <div className="lg:hidden flex flex-col sm:flex-row flex-wrap items-center justify-center sm:justify-between px-2.5 py-2 sm:py-1.5 border-b border-[#273545] bg-[#19232E] shrink-0 gap-1.5">
        <div className="flex items-center justify-center gap-1.5 sm:gap-1">
          {(
            [
              { id: 'lyrics', label: 'Lyrics' },
              { id: 'monitor', label: 'Preview' },
              { id: 'console', label: 'Console' },
            ] as const
          ).map((pane) => (
            <button
              key={pane.id}
              type="button"
              onClick={() => setMobilePane(pane.id)}
              className={`px-2.5 sm:px-2 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0 cursor-pointer ${
                mobilePane === pane.id ? 'v-btn-teal' : 'v-btn'
              }`}
            >
              {pane.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center flex-wrap gap-1.5 sm:gap-1 text-[10px]">
          <button
            type="button"
            onClick={() => handleResetToNewWorkspace('Untitled Project', false)}
            className="v-btn px-2 py-1 font-semibold uppercase whitespace-nowrap shrink-0 cursor-pointer"
          >
            New
          </button>
          <button
            type="button"
            onClick={() => {
              void refreshProjectsList();
              setProjectsModalOpen(true);
            }}
            className="v-btn px-2 py-1 font-semibold uppercase whitespace-nowrap shrink-0 cursor-pointer"
          >
            Projects
          </button>
          <button
            type="button"
            onClick={() => setExportModalOpen(true)}
            className="sm:hidden v-btn-cobalt px-2 py-1 font-semibold uppercase whitespace-nowrap shrink-0 cursor-pointer"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => setTapSyncOpen(true)}
            className="v-btn px-2 py-1 font-semibold uppercase whitespace-nowrap shrink-0 cursor-pointer"
          >
            Tap Sync
          </button>
        </div>
      </div>

      {/* Main 3-Column Broadcast Production Workspace */}
      <main className="flex-1 flex min-h-0 overflow-hidden bg-[#121922]">
        {/* LEFT: Song Lyrics Manager */}
        <aside
          aria-label="Song lyrics manager"
          className={`${
            mobilePane === 'lyrics' ? 'flex w-full' : 'hidden'
          } lg:flex lg:w-[320px] xl:w-[345px] shrink-0 flex-col bg-[#121922] border-r border-[#273545] min-h-0`}
        >
          <div className="h-9 px-3 border-b border-[#273545] bg-[#19232E] flex items-center justify-center relative sm:justify-between shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#EEF3F8]">
              Lyrics Manager
            </span>
            <span className="v-led v-led-active absolute right-3 sm:static" aria-hidden="true" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <LyricsTab
              audioFileName={project.audioFileName}
              duration={project.duration}
              language={project.language ?? 'auto'}
              onChangeLanguage={handleChangeLanguage}
              lyrics={project.lyrics}
              selectedLineId={selectedLineId}
              isSyncing={isSyncing}
              syncStatusText={syncStatusText}
              syncError={syncError}
              autoReviewActive={autoReviewActive}
              pasteDrawerOpen={pasteDrawerOpen}
              onTogglePasteDrawer={setPasteDrawerOpen}
              onClearSyncError={() => setSyncError(null)}
              onCreateBlankCueSlots={() => void handleCreateBlankCueSlots()}
              onUploadAudio={handleUploadAudio}
              onImportLyricsText={handleImportLyricsText}
              onAutoCreateLyrics={handleAutoCreateLyrics}
              onRunAutoSync={handleRunAutoSync}
              onShiftAllTiming={handleShiftAllLyricsTiming}
              onApplyBulkEditText={handleApplyBulkEditText}
              onDismissAutoReview={() => setAutoReviewActive(false)}
              onSelectLine={(id) => {
                setSelectedLineId(id);
                const found = project.lyrics.find((l) => l.id === id);
                if (found) handleSeek(found.start + 0.05);
              }}
              onAddLine={handleAddLine}
              onUpdateLine={handleUpdateLine}
              onUpdateWordText={handleUpdateWordText}
              onMoveLine={handleMoveLine}
              onDeleteLine={handleDeleteLine}
              onFillLongSongCues={handleFillLongSongCues}
              onCreateWorshipTemplate={() => void handleCreateWorshipTemplate()}
            />
          </div>
        </aside>

        {/* CENTER: Large 16:9 Program Preview Monitor */}
        <section
          aria-label="Video preview monitor"
          className={`${
            mobilePane === 'monitor' ? 'flex' : 'hidden'
          } lg:flex flex-1 flex-col min-w-0 min-h-0`}
        >
          <PreviewMonitor
            project={project}
            currentTime={currentTime}
            isPlaying={isPlaying}
            quality={quality}
            mediaCache={mediaCacheForRender}
            hasAudio={Boolean(audioBlob || project.audioFileName)}
            waveformPeaks={audioAnalysis?.waveformPeaks}
            audioBuffer={audioBuffer}
            volume={currentVolume}
            selectedLineStart={selectedLine?.start ?? null}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onPreviewLine={handlePreviewLine}
            onSeek={handleSeek}
            onChangeVolume={handleChangeVolume}
            onToggleMute={handleToggleMute}
            onChangeQuality={setQuality}
            onChangeTextPosition={(x, y) =>
              handleChangeTypography({ positionX: x, positionY: y })
            }
            onRenameProject={(name) =>
              setProject((prev) => ({ ...prev, name }))
            }
            onOpenLyricsEntry={() => {
              setMobilePane('lyrics');
              setPasteDrawerOpen(true);
            }}
            onAutoCreateLyrics={() => {
              setMobilePane('lyrics');
              void handleAutoCreateLyrics();
            }}
            renderFrameNowRef={previewRenderRef}
          />
        </section>

        {/* RIGHT: Organized Lyric Appearance Console (Typography, Effects & Backdrop) */}
        <aside
          aria-label="Lyric appearance console"
          className={`${
            mobilePane === 'console' ? 'flex w-full' : 'hidden'
          } lg:flex lg:w-[310px] xl:w-[340px] shrink-0 flex-col bg-[#121922] border-l border-[#273545] min-h-0`}
        >
          <div className="h-9 px-3 border-b border-[#273545] bg-[#19232E] flex items-center justify-center relative sm:justify-between shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#EEF3F8]">
              Lyric Appearance
            </span>
            <span className="v-led v-led-active absolute right-3 sm:static" aria-hidden="true" />
          </div>

          <div
            role="tablist"
            aria-label="Console panels"
            className="px-2.5 py-2 border-b border-[#273545] bg-[#0C1117] grid grid-cols-3 gap-1.5 items-center shrink-0"
          >
            {(
              [
                { id: 'typography', label: 'Typography' },
                { id: 'effects', label: 'Effects' },
                { id: 'background', label: 'Backdrop' },
              ] as const
            ).map((tab) => {
              const active = rightTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setRightTab(tab.id)}
                  className={`py-1.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                    active ? 'v-btn-teal' : 'v-btn'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto bg-[#121922]">
            {rightTab === 'typography' && (
              <TypographyTab
                typography={project.typography}
                vocalLayers={project.vocalLayers ?? DEFAULT_VOCAL_LAYERS}
                onChange={handleChangeTypography}
                onChangeVocalLayers={handleChangeVocalLayers}
                onReset={() => {
                  handleChangeTypography(DEFAULT_TYPOGRAPHY);
                  handleChangeVocalLayers({
                    ...DEFAULT_VOCAL_LAYERS,
                    backing: { ...DEFAULT_VOCAL_LAYERS.backing },
                  });
                }}
                savedAlbumPresets={savedAlbumPresets}
                onSaveAlbumPreset={handleSaveAlbumPreset}
                onApplyAlbumPreset={handleApplyAlbumPreset}
                onDeleteAlbumPreset={handleDeleteAlbumPreset}
              />
            )}

            {rightTab === 'effects' && (
              <EffectsTab
                autoEffectsEnabled={project.autoEffectsEnabled}
                autoEffectStyle={project.autoEffectStyle}
                selectedLine={selectedLine}
                onToggleAutoEffects={handleToggleAutoEffects}
                onChangeAutoStyle={handleChangeAutoStyle}
                onApplyAutoEffectsAll={handleApplyAutoEffectsAll}
                onOverrideLineEffect={handleOverrideLineEffect}
                onResetLineOverride={handleResetLineOverride}
                onUpdateLine={handleUpdateLine}
              />
            )}

            {rightTab === 'background' && (
              <BackgroundTab
                aspectRatio={project.aspectRatio}
                background={project.background}
                watermark={project.watermark ?? DEFAULT_WATERMARK}
                onChangeAspectRatio={(ratio: AspectRatio) =>
                  setProject((prev) => ({ ...prev, aspectRatio: ratio }))
                }
                onChangeBackground={handleChangeBackground}
                onChangeWatermark={handleChangeWatermark}
                onUploadBackgroundMedia={handleUploadBackgroundMedia}
              />
            )}
          </div>
        </aside>
      </main>

      {/* BOTTOM: Professional Timeline */}
      <TimelinePanel
        duration={project.duration}
        currentTime={currentTime}
        isPlaying={isPlaying}
        waveformPeaks={audioAnalysis?.waveformPeaks ?? []}
        vocalEnvelope={audioAnalysis?.envelope ?? []}
        lyrics={project.lyrics}
        selectedLineId={selectedLineId}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onSeek={handleSeek}
        onSelectLine={setSelectedLineId}
        onUpdateLineTiming={handleUpdateLineTiming}
      />

      {/* Modals */}
      <ProjectsModal
        isOpen={projectsModalOpen}
        currentProjectId={project.id}
        projects={savedProjects}
        onClose={() => setProjectsModalOpen(false)}
        onSaveCurrent={handleSaveCurrentProject}
        onCreateNew={handleCreateNewProject}
        onOpenProject={handleOpenProject}
        onDuplicateProject={handleDuplicateProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProjectById}
      />

      <ExportModal
        isOpen={exportModalOpen}
        project={project}
        audioBuffer={audioBuffer}
        mediaCache={mediaCacheForRender}
        onClose={() => setExportModalOpen(false)}
      />

      <TapSyncModal
        isOpen={tapSyncOpen}
        lyrics={project.lyrics}
        duration={project.duration}
        currentTime={currentTime}
        isPlaying={isPlaying}
        hasAudio={Boolean(audioBlob || project.audioFileName)}
        onStartPlaybackFromZero={() => {
          handleSeek(0);
          isPlayingRef.current = true;
          setIsPlaying(true);
        }}
        onStopPlayback={() => {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }}
        onApplyTapTimings={(updatedLines) => {
          const snappedLines = audioAnalysis
            ? updatedLines.map((line) => ({
                ...line,
                words: snapWordTimingsToOnsets(
                  line.text,
                  line.start,
                  line.end,
                  audioAnalysis.onsets,
                  line.id,
                  audioAnalysis.envelope,
                  audioAnalysis.frameDurationSec
                ),
              }))
            : updatedLines;
          const maxLineEnd = snappedLines.reduce((m, l) => Math.max(m, l.end), 0);
          setProject((prev) => {
            const withEffects = prev.autoEffectsEnabled
              ? assignAutoEffects(snappedLines, prev.autoEffectStyle, true)
              : snappedLines;
            return {
              ...prev,
              duration:
                prev.duration > 0
                  ? Math.max(prev.duration, Math.ceil(maxLineEnd + 0.5))
                  : snappedLines.length > 0
                    ? Math.max(10, Math.ceil(maxLineEnd + 1))
                    : prev.duration,
              lyrics: withEffects,
              syncReport:
                withEffects.length > 0
                  ? {
                      method: 'manual-tap',
                      confidence: 0.96,
                      matchedPhrases: withEffects.length,
                      totalLines: withEffects.length,
                      warnings: [],
                      timestamp: Date.now(),
                    }
                  : null,
            };
          });
          setSelectedLineId((curr) =>
            curr && snappedLines.some((l) => l.id === curr)
              ? curr
              : (snappedLines[0]?.id ?? null)
          );
          showToast('Saved lyrics & Tap Sync timings.');
        }}
        onClose={() => setTapSyncOpen(false)}
      />

      <ShortcutsModal
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* Studio Toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-5 z-40 px-3.5 py-2 bg-[#19232E] border border-[#EF4444] rounded-[4px] text-xs text-[#EEF3F8] text-center sm:text-left max-w-[calc(100vw-2rem)] shadow-[0_4px_16px_rgba(0,0,0,0.65)] pointer-events-none"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
