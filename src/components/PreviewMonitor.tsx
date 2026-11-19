import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  ClipboardPaste,
  Eye,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Square,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { BACKGROUND_TEMPLATES } from '../data/presets';
import { PreviewQuality, ProjectData } from '../types/editor';
import {
  MediaAssetCache,
  renderVideoFrame,
} from '../utils/lyricRenderer';
import { clamp, formatTimecode } from '../utils/timeFormat';

interface PreviewMonitorProps {
  project: ProjectData;
  currentTime: number;
  isPlaying: boolean;
  quality: PreviewQuality;
  mediaCache: MediaAssetCache;
  hasAudio: boolean;
  waveformPeaks?: number[];
  audioBuffer: AudioBuffer | null;
  volume: number;
  selectedLineStart: number | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onPreviewLine: () => void;
  onSeek: (time: number) => void;
  onChangeVolume: (volume: number) => void;
  onToggleMute: () => void;
  onChangeQuality: (q: PreviewQuality) => void;
  onChangeTextPosition: (x: number, y: number) => void;
  onRenameProject: (name: string) => void;
  onOpenLyricsEntry: () => void;
  onAutoCreateLyrics: () => void;
  renderFrameNowRef?: React.MutableRefObject<((liveTime: number) => void) | null>;
}

const METER_SEGMENTS = 8;

function computeStereoLevels(
  audioBuffer: AudioBuffer | null,
  currentTime: number,
  isPlaying: boolean,
  volume: number
): { left: number; right: number } {
  if (!audioBuffer || !isPlaying || volume <= 0) return { left: 0, right: 0 };
  const sr = audioBuffer.sampleRate || 44100;
  const center = Math.floor(currentTime * sr);
  const windowSize = Math.min(1024, Math.floor(sr * 0.03));
  const start = Math.max(0, center - Math.floor(windowSize / 2));
  const end = Math.min(audioBuffer.length, start + windowSize);
  if (end <= start) return { left: 0, right: 0 };

  const calcChannel = (chIdx: number) => {
    const ch = audioBuffer.getChannelData(Math.min(chIdx, audioBuffer.numberOfChannels - 1));
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = ch[i] ?? 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / (end - start)) * clamp(volume, 0, 2);
    if (rms <= 1e-5) return 0;
    // Map -48dB..0dB cleanly to 0..1
    const db = 20 * Math.log10(rms);
    return clamp((db + 48) / 48, 0, 1);
  };

  return {
    left: calcChannel(0),
    right: audioBuffer.numberOfChannels > 1 ? calcChannel(1) : calcChannel(0),
  };
}

export const PreviewMonitor: React.FC<PreviewMonitorProps> = ({
  project,
  currentTime,
  isPlaying,
  quality,
  mediaCache,
  hasAudio,
  waveformPeaks,
  audioBuffer,
  volume,
  selectedLineStart,
  onPlay,
  onPause,
  onStop,
  onPreviewLine,
  onSeek,
  onChangeVolume,
  onToggleMute,
  onChangeQuality,
  onChangeTextPosition,
  onRenameProject,
  onOpenLyricsEntry,
  onAutoCreateLyrics,
  renderFrameNowRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  const activeTemplateBg = useMemo(
    () =>
      project.background.type === 'template'
        ? BACKGROUND_TEMPLATES.find((t) => t.id === project.background.templateId) ??
          BACKGROUND_TEMPLATES[0]
        : null,
    [project.background.type, project.background.templateId]
  );

  const activeVideoUrl =
    project.background.type === 'video' ? project.background.mediaUrl || null : null;
  const activeVideoPosterUrl = undefined;

  const hasDomBgVideo = Boolean(activeVideoUrl);
  const latestRenderRef = useRef({
    project,
    quality,
    mediaCache,
    hasDomBgVideo,
    hasAudio,
    waveformPeaks,
    isPlaying,
  });
  latestRenderRef.current = {
    project,
    quality,
    mediaCache,
    hasDomBgVideo,
    hasAudio,
    waveformPeaks,
    isPlaying,
  };
  const lastPaintedRef = useRef<{
    time: number;
    project: ProjectData;
    quality: PreviewQuality;
    mediaCache: MediaAssetCache;
    hasDomBgVideo: boolean;
    hasAudio: boolean;
    waveformPeaks?: number[];
  } | null>(null);

  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isExpandedPreview, setIsExpandedPreview] = useState(false);
  const isFullscreen = isNativeFullscreen || isExpandedPreview;
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(project.name);

  useEffect(() => {
    setTitleDraft(project.name);
  }, [project.name]);

  useEffect(() => {
    const getFsElement = () =>
      document.fullscreenElement ||
      (document as unknown as { webkitFullscreenElement?: Element | null })
        .webkitFullscreenElement ||
      null;
    const onFsChange = () => {
      const active = Boolean(getFsElement());
      setIsNativeFullscreen(active);
    };
    const onFsError = () => {
      setIsNativeFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('fullscreenerror', onFsError);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('fullscreenerror', onFsError);
    };
  }, []);

  useEffect(() => {
    if (!isExpandedPreview && !isNativeFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpandedPreview(false);
        setIsNativeFullscreen(false);
        const doc = document as unknown as {
          fullscreenElement?: Element | null;
          webkitFullscreenElement?: Element | null;
          exitFullscreen?: () => Promise<void>;
          webkitExitFullscreen?: () => Promise<void> | void;
        };
        const fsEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
        try {
          if (fsEl && doc.exitFullscreen) {
            void doc.exitFullscreen().catch(() => {});
          } else if (fsEl && doc.webkitExitFullscreen) {
            void Promise.resolve(doc.webkitExitFullscreen()).catch(() => {});
          }
        } catch {
          // Ignore fullscreen exit errors
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpandedPreview, isNativeFullscreen]);

  // Synchronize native composited background <video> playback & scrubs with zero canvas pixel copy
  useEffect(() => {
    const vid = bgVideoRef.current;
    if (!vid || !activeVideoUrl) return;
    if (isPlaying) {
      if (vid.readyState >= 2 && vid.duration > 0) {
        const expected = currentTimeRef.current % vid.duration;
        if (Math.abs(vid.currentTime - expected) > 0.3) {
          vid.currentTime = expected;
        }
      }
      void vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [isPlaying, activeVideoUrl]);

  useEffect(() => {
    const vid = bgVideoRef.current;
    if (!vid || !activeVideoUrl || !vid.duration || vid.duration <= 0) return;
    const expected = currentTime % vid.duration;
    const diff = Math.abs(vid.currentTime - expected);
    if (!isPlaying) {
      if (diff > 0.04 && vid.readyState >= 1) {
        vid.currentTime = expected;
      }
    } else if (diff > 0.45 && vid.readyState >= 2) {
      vid.currentTime = expected;
    }
  }, [currentTime, isPlaying, activeVideoUrl]);

  const paintCanvasFrame = useCallback((liveTime: number, watermarkTimeOverride?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const {
      project: latestProject,
      quality: latestQuality,
      mediaCache: latestMediaCache,
      hasDomBgVideo: useTransparentBg,
      hasAudio: latestHasAudio,
      waveformPeaks: latestWaveformPeaks,
      isPlaying: latestIsPlaying,
    } = latestRenderRef.current;

    const targetW =
      latestProject.aspectRatio === '16:9'
        ? latestQuality === 'draft'
          ? 960
          : 1920
        : latestQuality === 'draft'
          ? 540
          : 1080;
    const targetH =
      latestProject.aspectRatio === '16:9'
        ? latestQuality === 'draft'
          ? 540
          : 1080
        : latestProject.aspectRatio === '9:16'
          ? latestQuality === 'draft'
            ? 960
            : 1920
          : latestQuality === 'draft'
            ? 540
            : 1080;

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const resolvedWatermarkTime =
      watermarkTimeOverride ?? (latestIsPlaying ? liveTime : performance.now() / 1000);

    renderVideoFrame(ctx, targetW, targetH, liveTime, latestProject, latestMediaCache, {
      transparentVideoBg: useTransparentBg,
      hasAudio: latestHasAudio,
      waveformPeaks: latestWaveformPeaks,
      watermarkTime: resolvedWatermarkTime,
      reducedMotion,
    });
    lastPaintedRef.current = {
      time: liveTime,
      project: latestProject,
      quality: latestQuality,
      mediaCache: latestMediaCache,
      hasDomBgVideo: useTransparentBg,
      hasAudio: latestHasAudio,
      waveformPeaks: latestWaveformPeaks,
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    let active = true;
    const lyricFamily = project.typography.fontFamily;
    const lyricWeight = project.typography.fontWeight;
    const secondaryWeight = lyricWeight >= 600 ? 500 : lyricWeight;
    const watermarkFamily = project.watermark?.fontFamily || 'Caveat';
    void Promise.all([
      document.fonts.load('700 48px "Caveat"'),
      document.fonts.load(`700 48px "${watermarkFamily}"`),
      document.fonts.load(`${lyricWeight} 48px "${lyricFamily}"`),
      document.fonts.load(`italic ${secondaryWeight} 36px "${lyricFamily}"`),
      document.fonts.load(`${secondaryWeight} 36px "${lyricFamily}"`),
    ])
      .then(() => {
        if (active) paintCanvasFrame(currentTimeRef.current);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [paintCanvasFrame, project.typography.fontFamily, project.typography.fontWeight, project.watermark?.fontFamily]);

  useEffect(() => {
    if (isPlaying) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    let rafId = 0;
    let lastDrawMs = 0;
    const tickIdleShake = (now: number) => {
      if (now - lastDrawMs >= 33) {
        lastDrawMs = now;
        paintCanvasFrame(currentTimeRef.current, now / 1000);
      }
      rafId = requestAnimationFrame(tickIdleShake);
    };
    rafId = requestAnimationFrame(tickIdleShake);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, paintCanvasFrame]);

  useEffect(() => {
    if (!renderFrameNowRef) return;
    renderFrameNowRef.current = paintCanvasFrame;
    return () => {
      renderFrameNowRef.current = null;
    };
  }, [renderFrameNowRef, paintCanvasFrame]);

  useEffect(() => {
    const last = lastPaintedRef.current;
    if (
      last &&
      last.time === currentTime &&
      last.project === project &&
      last.quality === quality &&
      last.mediaCache === mediaCache &&
      last.hasDomBgVideo === hasDomBgVideo &&
      last.hasAudio === hasAudio &&
      last.waveformPeaks === waveformPeaks
    ) {
      return;
    }
    paintCanvasFrame(currentTime);
  }, [project, currentTime, quality, mediaCache, hasDomBgVideo, hasAudio, waveformPeaks, paintCanvasFrame]);

  const meterLevels = useMemo(
    () => computeStereoLevels(audioBuffer, currentTime, isPlaying, volume),
    [audioBuffer, currentTime, isPlaying, volume]
  );

  const volumePercent = Math.round(clamp(volume, 0, 2) * 100);
  const isMuted = volume <= 0;

  const handleToggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    const doc = document as unknown as {
      fullscreenElement?: Element | null;
      webkitFullscreenElement?: Element | null;
      exitFullscreen?: () => Promise<void>;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const fsElement = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

    if (isFullscreen || fsElement) {
      setIsExpandedPreview(false);
      setIsNativeFullscreen(false);
      try {
        if (fsElement && doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (fsElement && doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      } catch {
        // Ensure UI exits expanded/fullscreen state even if browser rejects exitFullscreen
      }
      return;
    }

    const reqEl = el as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
      if (document.fullscreenEnabled && reqEl.requestFullscreen) {
        await reqEl.requestFullscreen();
        if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
          setIsNativeFullscreen(true);
          return;
        }
      } else if (reqEl.webkitRequestFullscreen) {
        await reqEl.webkitRequestFullscreen();
        if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
          setIsNativeFullscreen(true);
          return;
        }
      }
    } catch {
      // Restricted iframe or browser denied native fullscreen — fall back cleanly below
    }
    setIsExpandedPreview(true);
  };

  const handlePointerDownCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    setIsDraggingText(true);
    updatePositionFromPointer(e);
  };

  const handlePointerMoveCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingText) return;
    updatePositionFromPointer(e);
  };

  const handlePointerUpCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingText) return;
    setIsDraggingText(false);
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const updatePositionFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const normX = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0.15, 0.85);
    const normY = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0.15, 0.88);
    onChangeTextPosition(Number(normX.toFixed(2)), Number(normY.toFixed(2)));
  };

  const aspectClass =
    project.aspectRatio === '16:9'
      ? 'aspect-video max-h-full w-auto max-w-full'
      : project.aspectRatio === '9:16'
        ? 'aspect-[9/16] h-full max-h-full w-auto'
        : 'aspect-square h-full max-h-full w-auto';

  const canPlay = project.duration > 0;
  const isPausedMidway = !isPlaying && currentTime > 0;

  return (
    <div
      ref={containerRef}
      className={
        isExpandedPreview
          ? 'fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#121922] select-none'
          : 'flex flex-col h-full min-h-0 bg-[#121922] select-none'
      }
    >
      {/* Program Header Strip */}
      <div className="min-h-9 sm:h-9 px-3 py-1.5 sm:py-0 border-b border-[#273545] bg-[#19232E] flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-1.5 sm:gap-3 shrink-0">
        <div className="flex items-center justify-center sm:justify-start gap-2 sm:gap-2.5 min-w-0 max-w-full">
          <span
            className={`v-led shrink-0 ${isPlaying ? 'v-led-active' : ''}`}
            aria-hidden="true"
          />
          {editingTitle ? (
            <input
              type="text"
              aria-label="Project name"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                if (titleDraft.trim()) onRenameProject(titleDraft.trim());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditingTitle(false);
                  if (titleDraft.trim()) onRenameProject(titleDraft.trim());
                }
              }}
              className="v-inset px-2 py-0.5 text-xs font-medium text-[#EEF3F8] focus:outline-none focus:border-[#EF4444]"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              title="Click to rename project"
              className="text-xs font-semibold text-[#EEF3F8] hover:text-[#F87171] truncate max-w-[180px] sm:max-w-[240px] cursor-pointer"
            >
              {project.name}
            </button>
          )}
          <span className="text-[11px] text-[#8696A8] font-mono-tabular whitespace-nowrap shrink-0">
            {project.aspectRatio} · {project.lyrics.length} lines
          </span>
        </div>

        <div className="flex items-center justify-center sm:justify-end gap-1.5 shrink-0">
          <div role="group" aria-label="Preview quality" className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChangeQuality('draft')}
              className={`px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                quality === 'draft' ? 'v-btn-teal' : 'v-btn'
              }`}
            >
              Draft
            </button>
            <button
              type="button"
              onClick={() => onChangeQuality('high')}
              className={`px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                quality === 'high' ? 'v-btn-teal' : 'v-btn'
              }`}
            >
              Full HD
            </button>
          </div>

          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen preview' : 'Enter fullscreen preview'}
            title={isFullscreen ? 'Minimize preview (Esc)' : 'Maximize preview'}
            className="v-btn p-1.5 cursor-pointer"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 text-[#E4E4E7]" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Central 16:9 Program Output Stage */}
      <div className="flex-1 min-h-0 p-2.5 sm:p-4 flex items-center justify-center relative overflow-hidden bg-[#121922]">
        <div
          className={`relative flex items-center justify-center border border-[#273545] bg-[#0C1117] shadow-[0_8px_28px_rgba(0,0,0,0.6)] overflow-hidden ${aspectClass}`}
          style={{
            width: project.aspectRatio === '16:9' ? '100%' : undefined,
            height: project.aspectRatio !== '16:9' ? '100%' : undefined,
          }}
        >
          {activeVideoUrl && (
            <video
              ref={bgVideoRef}
              key={activeVideoUrl}
              src={activeVideoUrl}
              poster={activeVideoPosterUrl}
              crossOrigin="anonymous"
              muted
              loop
              playsInline
              preload="auto"
              onLoadedData={(e) => {
                const vid = e.currentTarget;
                if (vid.duration > 0) {
                  vid.currentTime = currentTimeRef.current % vid.duration;
                }
                if (isPlaying) {
                  void vid.play().catch(() => {});
                }
              }}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              style={{
                transform: `translate(${project.background.offsetX * 100}%, ${project.background.offsetY * 100}%) scale(${project.background.scale})`,
                filter:
                  project.background.blur > 0
                    ? `blur(${Math.max(0.5, project.background.blur * 0.5)}px)`
                    : undefined,
              }}
            />
          )}

          <canvas
            ref={canvasRef}
            data-testid="preview-canvas"
            onPointerDown={handlePointerDownCanvas}
            onPointerMove={handlePointerMoveCanvas}
            onPointerUp={handlePointerUpCanvas}
            className="relative z-[1] w-full h-full object-contain cursor-move"
          />

          {isDraggingText && (
            <div className="pointer-events-none absolute inset-0 z-[2] border border-[#EF4444]/70">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#EF4444]/45" />
              <div className="absolute top-1/2 left-0 right-0 h-px bg-[#EF4444]/45" />
            </div>
          )}

          {/* Clean Empty Workspace State (centered, transparent so bottom-left watermark stays visible) */}
          {!hasAudio && project.lyrics.length === 0 && project.background.type === 'solid' && (
            <div className="absolute inset-0 z-[2] bg-transparent flex flex-col items-center justify-center p-4 sm:p-6 text-center pointer-events-none">
              <p className="text-sm font-semibold text-[#EEF3F8] mb-1">
                Start Lyrics Video Project
              </p>
              <p className="text-xs text-[#8696A8] max-w-md">
                Load an audio track and add lyrics to preview, synchronise timing, and export video.
              </p>
            </div>
          )}

          {/* Audio Loaded, No Lyrics Yet State (hidden while playing or scrubbed so watermark and lyrics display cleanly) */}
          {hasAudio && project.lyrics.length === 0 && !isPlaying && currentTime === 0 && (
            <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center p-4 sm:p-6 text-center pointer-events-none">
              {project.background.type === 'solid' && (
                <>
                  <p className="text-sm font-semibold text-[#EEF3F8] mb-1">
                    Audio Track Ready
                  </p>
                  <p className="text-xs text-[#8696A8] max-w-md mb-4">
                    Auto-create timed lyrics from the audio track or enter lyrics manually.
                  </p>
                </>
              )}
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={onAutoCreateLyrics}
                  className="v-btn-teal inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs uppercase tracking-wider whitespace-nowrap cursor-pointer shadow-lg"
                >
                  <AudioLines className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Auto-Create Lyrics</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenLyricsEntry}
                  className="v-btn inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer shadow-lg"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-[#D4D4D8]" aria-hidden="true" />
                  <span>Enter Lyrics</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Broadcast Transport Switcher & Stereo Audio Meter */}
      <div className="px-3 pt-1.5 pb-2 border-t border-[#273545] bg-[#19232E] flex flex-col gap-1.5 shrink-0">
        {/* Timecode & Playback Scrub Rail */}
        <div className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2.5">
          <div className="v-inset px-1.5 py-0.5 font-mono-tabular text-[11px] flex items-center gap-1 shrink-0">
            <span
              className={`v-led ${isPlaying ? 'v-led-active' : ''}`}
              aria-hidden="true"
            />
            <span className="text-[#F2C230]">{formatTimecode(currentTime)}</span>
            <span className="text-[#8696A8]">/ {formatTimecode(project.duration)}</span>
          </div>

          <input
            type="range"
            disabled={!canPlay}
            aria-label="Playback position"
            min={0}
            max={Math.max(1, project.duration)}
            step={0.05}
            value={Math.min(currentTime, Math.max(0, project.duration))}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="w-full studio-slider disabled:opacity-30"
          />
        </div>

        {/* Centered Transport Controls with Vertical Upward Sound Pulse Between Pause and Stop */}
        <div className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5 w-full">
          <button
            type="button"
            disabled={!canPlay}
            aria-label="Skip backward 5 seconds"
            onClick={() => onSeek(Math.max(0, currentTime - 5))}
            className="v-btn-knob p-1 sm:p-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!canPlay}
            aria-label="Play preview"
            onClick={onPlay}
            className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 text-[10px] uppercase tracking-wider cursor-pointer ${
              isPlaying ? 'v-btn-amber' : 'v-btn-amber-idle'
            }`}
          >
            <Play className="w-3 h-3 fill-current" aria-hidden="true" />
            <span>Play</span>
          </button>

          <button
            type="button"
            disabled={!canPlay}
            aria-label="Pause preview"
            onClick={onPause}
            className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 text-[10px] uppercase tracking-wider cursor-pointer ${
              isPausedMidway ? 'v-btn-amber' : 'v-btn-amber-idle'
            }`}
          >
            <Pause className="w-3 h-3 fill-current" aria-hidden="true" />
            <span>Pause</span>
          </button>

          {/* Vertical Upward Stereo Audio Level Meter (Sound Pulse) */}
          <div
            className="flex items-end gap-[3px] v-inset px-1.5 py-[3px] shrink-0"
            aria-label="Audio output level meter"
            title="Stereo Audio Output Level (L / R)"
          >
            {[
              { label: 'L', level: meterLevels.left },
              { label: 'R', level: meterLevels.right },
            ].map((ch) => {
              const litCount = Math.round(ch.level * METER_SEGMENTS);
              return (
                <div
                  key={ch.label}
                  className="flex flex-col-reverse items-center gap-[1.5px]"
                  aria-label={`${ch.label} channel level`}
                >
                  {Array.from({ length: METER_SEGMENTS }, (_, idx) => {
                    const lit = idx < litCount;
                    const isPeak = idx >= METER_SEGMENTS - 2;
                    return (
                      <span
                        key={idx}
                        className={`w-1.5 h-[2px] rounded-[0.5px] ${
                          lit
                            ? isPeak
                              ? 'bg-[#E05252] shadow-[0_0_4px_#E05252]'
                              : 'bg-[#2EC46E]'
                            : 'bg-[#1B2634]'
                        }`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={!canPlay}
            aria-label="Stop preview"
            onClick={onStop}
            className="v-btn inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 text-[10px] font-semibold uppercase tracking-wider cursor-pointer"
          >
            <Square className="w-3 h-3 fill-current" aria-hidden="true" />
            <span>Stop</span>
          </button>

          <button
            type="button"
            disabled={!canPlay}
            aria-label="Skip forward 5 seconds"
            onClick={() => onSeek(Math.min(project.duration, currentTime + 5))}
            className="v-btn-knob p-1 sm:p-1.5 cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!canPlay && selectedLineStart === null}
            onClick={onPreviewLine}
            className="v-btn inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            <Eye className="w-3 h-3 text-[#D4D4D8]" aria-hidden="true" />
            <span>Preview</span>
          </button>
        </div>

        {/* Center-Aligned Master Volume Controller Below Transport */}
        <div className="flex items-center justify-center w-full">
          <div
            role="group"
            aria-label="Master audio volume"
            className="v-inset px-2 py-0.5 flex items-center gap-1.5 shrink-0"
          >
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              title={isMuted ? 'Unmute audio' : 'Mute audio'}
              className={`p-0.5 rounded-[3px] transition-colors cursor-pointer ${
                isMuted
                  ? 'text-[#E05252] hover:bg-[#1E2A36]'
                  : 'text-[#F87171] hover:bg-[#1E2A36]'
              }`}
            >
              {isMuted ? (
                <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
              ) : volume < 0.55 ? (
                <Volume1 className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              disabled={volume <= 0}
              onClick={() => onChangeVolume(Math.max(0, Number((volume - 0.1).toFixed(2))))}
              aria-label="Reduce volume"
              title="Reduce volume (-10%)"
              className="v-btn-knob w-6 h-6 flex items-center justify-center cursor-pointer"
            >
              <Minus className="w-2.5 h-2.5" aria-hidden="true" />
            </button>

            <input
              type="range"
              aria-label="Audio volume"
              min={0}
              max={2}
              step={0.01}
              value={clamp(volume, 0, 2)}
              onChange={(e) => onChangeVolume(Number(e.target.value))}
              className="w-20 sm:w-24 studio-slider cursor-pointer"
            />

            <button
              type="button"
              disabled={volume >= 2}
              onClick={() => onChangeVolume(Math.min(2, Number((volume + 0.1).toFixed(2))))}
              aria-label="Add volume"
              title="Add volume (+10%)"
              className="v-btn-knob w-6 h-6 flex items-center justify-center cursor-pointer"
            >
              <Plus className="w-2.5 h-2.5" aria-hidden="true" />
            </button>

            <span
              data-testid="volume-readout"
              className={`font-mono-tabular text-[10px] w-8 text-right select-none ${
                isMuted
                  ? 'text-[#E05252]'
                  : volumePercent > 100
                    ? 'text-[#F2C230]'
                    : 'text-[#DCE5EE]'
              }`}
            >
              {volumePercent}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
