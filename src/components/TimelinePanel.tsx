import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Square, ZoomIn, ZoomOut } from 'lucide-react';
import { EFFECT_OPTIONS, SECTION_COLORS } from '../data/presets';
import { LyricLine } from '../types/editor';
import { clamp, formatDurationShort, formatTimecode } from '../utils/timeFormat';

interface TimelinePanelProps {
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  waveformPeaks: number[];
  vocalEnvelope?: number[];
  lyrics: LyricLine[];
  selectedLineId: string | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onSelectLine: (id: string) => void;
  onUpdateLineTiming: (id: string, start: number, end: number) => void;
}

type DragMode =
  | { type: 'scrub' }
  | {
      type: 'move' | 'resize-left' | 'resize-right';
      lineId: string;
      initialStart: number;
      initialEnd: number;
      startClientX: number;
    };

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  duration,
  currentTime,
  isPlaying,
  waveformPeaks,
  vocalEnvelope = [],
  lyrics,
  selectedLineId,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onSelectLine,
  onUpdateLineTiming,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const trackGridRef = useRef<HTMLDivElement>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const vocalCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pxPerSec, setPxPerSec] = useState(46);
  const [fitToViewport, setFitToViewport] = useState(false);
  const [dragState, setDragState] = useState<DragMode | null>(null);

  const isEmptyTimeline =
    duration <= 0 && lyrics.length === 0 && waveformPeaks.length === 0;
  const safeDuration = Math.max(10, duration);
  const trackWidth = Math.max(400, Math.ceil(safeDuration * pxPerSec));

  const selectedLine = useMemo(
    () => lyrics.find((l) => l.id === selectedLineId) ?? null,
    [lyrics, selectedLineId]
  );

  // Dynamically fit timeline when Fit mode is active or when container resizes
  useEffect(() => {
    if (isEmptyTimeline || !fitToViewport) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const applyFit = () => {
      const containerW = container.clientWidth;
      if (containerW <= 40) return;
      const fitted = clamp((containerW - 24) / safeDuration, 2, 140);
      setPxPerSec(Number(fitted.toFixed(2)));
    };

    applyFit();
    const ro = new ResizeObserver(applyFit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitToViewport, isEmptyTimeline, safeDuration]);

  // Keep the playhead visible inside the active timeline viewport at all times
  useEffect(() => {
    if (isEmptyTimeline) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const viewWidth = container.clientWidth;
    if (viewWidth <= 0) return;

    const playheadX = currentTime * pxPerSec;
    const scrollLeft = container.scrollLeft;
    const edgeMargin = Math.min(72, Math.max(20, viewWidth * 0.14));

    if (dragState?.type === 'scrub') {
      if (playheadX < scrollLeft + 16) {
        container.scrollLeft = Math.max(0, playheadX - 16);
      } else if (playheadX > scrollLeft + viewWidth - 16) {
        container.scrollLeft = Math.max(0, playheadX - viewWidth + 16);
      }
      return;
    }

    if (isPlaying) {
      if (playheadX > scrollLeft + viewWidth - edgeMargin) {
        container.scrollLeft = Math.max(0, playheadX - viewWidth * 0.22);
      } else if (playheadX < scrollLeft + 16) {
        container.scrollLeft = Math.max(0, playheadX - 32);
      }
    } else if (
      playheadX < scrollLeft + 24 ||
      playheadX > scrollLeft + viewWidth - 24
    ) {
      container.scrollLeft = Math.max(0, playheadX - viewWidth * 0.35);
    }
  }, [currentTime, pxPerSec, isPlaying, isEmptyTimeline, dragState]);

  const tickStepSec =
    pxPerSec >= 80 ? 1 : pxPerSec >= 35 ? 2 : pxPerSec >= 15 ? 5 : pxPerSec >= 7 ? 10 : 20;

  // Compute crisp 1px-resolution studio DAW Peak + separate local RMS core
  const buildStudioPeakAndRms = (
    peaks: number[],
    width: number,
    boost = 1,
    floor = 0,
    rmsSource?: number[]
  ): { peak: Float32Array; rms: Float32Array } => {
    const colCount = Math.max(1, Math.floor(width));
    const peak = new Float32Array(colCount);
    const rms = new Float32Array(colCount);
    if (peaks.length === 0) return { peak, rms };

    for (let x = 0; x < colCount; x++) {
      const startIdx = (x / colCount) * peaks.length;
      const endIdx = ((x + 1) / colCount) * peaks.length;
      const lo = Math.floor(startIdx);
      const hi = Math.min(peaks.length - 1, Math.floor(endIdx));

      let p = 0;
      if (hi <= lo) {
        const frac = startIdx - lo;
        const nxt = Math.min(peaks.length - 1, lo + 1);
        p = (peaks[lo] ?? 0) * (1 - frac) + (peaks[nxt] ?? 0) * frac;
      } else {
        for (let k = lo; k <= hi; k++) {
          const v = peaks[k] ?? 0;
          if (v > p) p = v;
        }
      }
      peak[x] = Math.min(1, Math.max(0, p * boost + floor));
    }

    if (rmsSource && rmsSource.length > 0) {
      for (let x = 0; x < colCount; x++) {
        const idx = (x / colCount) * (rmsSource.length - 1);
        const lo = Math.floor(idx);
        const hi = Math.min(rmsSource.length - 1, lo + 1);
        const frac = idx - lo;
        const val = (rmsSource[lo] ?? 0) * (1 - frac) + (rmsSource[hi] ?? 0) * frac;
        rms[x] = Math.min(peak[x], Math.max(0, val * 0.85 * boost + floor * 0.5));
      }
    } else {
      const radius = 5;
      for (let x = 0; x < colCount; x++) {
        let sumSq = 0;
        let count = 0;
        const a = Math.max(0, x - radius);
        const b = Math.min(colCount - 1, x + radius);
        for (let j = a; j <= b; j++) {
          const v = peak[j];
          sumSq += v * v;
          count++;
        }
        const localRms = count > 0 ? Math.sqrt(sumSq / count) : 0;
        rms[x] = Math.min(peak[x], localRms * 0.72);
      }
    }

    return { peak, rms };
  };

  const drawStudioWaveform = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    peak: Float32Array,
    rms: Float32Array,
    playheadX: number,
    beatStepPx: number,
    colors: {
      bg: string;
      grid: string;
      subGrid: string;
      axis: string;
      playedOuterTop: string;
      playedOuterMid: string;
      playedCore: string;
      playedEdge: string;
      unplayedOuterTop: string;
      unplayedOuterMid: string;
      unplayedCore: string;
      unplayedEdge: string;
    }
  ) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);

    const midY = height / 2;

    // Vertical DAW time/beat gridlines
    if (beatStepPx >= 12) {
      ctx.strokeStyle = colors.subGrid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const halfStep = beatStepPx / 2;
      for (let gx = halfStep; gx < width; gx += beatStepPx) {
        const px = Math.round(gx) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      ctx.stroke();

      ctx.strokeStyle = colors.grid;
      ctx.beginPath();
      for (let gx = 0; gx < width; gx += beatStepPx) {
        const px = Math.round(gx) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
      }
      ctx.stroke();
    }

    // Horizontal DAW dB reference rails (+50% / 0dB / -50%)
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(height * 0.25) + 0.5);
    ctx.lineTo(width, Math.round(height * 0.25) + 0.5);
    ctx.moveTo(0, Math.round(height * 0.75) + 0.5);
    ctx.lineTo(width, Math.round(height * 0.75) + 0.5);
    ctx.stroke();

    ctx.strokeStyle = colors.axis;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(midY) + 0.5);
    ctx.lineTo(width, Math.round(midY) + 0.5);
    ctx.stroke();

    const colCount = peak.length;
    if (colCount < 2) return;
    const maxAmp = height * 0.45;

    const renderStudioPass = (
      outerTop: string,
      outerMid: string,
      coreColor: string,
      edgeColor: string
    ) => {
      // 1. Solid 1px-contiguous peak envelope (zero comb-tooth gaps, crisp vertical gradient)
      const peakGrad = ctx.createLinearGradient(0, 0, 0, height);
      peakGrad.addColorStop(0, outerTop);
      peakGrad.addColorStop(0.5, outerMid);
      peakGrad.addColorStop(1, outerTop);
      ctx.fillStyle = peakGrad;

      for (let x = 0; x < colCount; x++) {
        const h = Math.max(0.75, peak[x] * maxAmp);
        ctx.fillRect(x, midY - h, 1, h * 2);
      }

      // 2. Dense inner RMS energy core (true studio loudness body inside transient spikes)
      ctx.fillStyle = coreColor;
      for (let x = 0; x < colCount; x++) {
        const h = Math.max(0.5, rms[x] * maxAmp);
        ctx.fillRect(x, midY - h, 1, h * 2);
      }

      // 3. Razor-sharp 1px top & bottom peak silhouette contour
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY - Math.max(0.75, peak[0] * maxAmp));
      for (let x = 1; x < colCount; x++) {
        ctx.lineTo(x, midY - Math.max(0.75, peak[x] * maxAmp));
      }
      ctx.moveTo(0, midY + Math.max(0.75, peak[0] * maxAmp));
      for (let x = 1; x < colCount; x++) {
        ctx.lineTo(x, midY + Math.max(0.75, peak[x] * maxAmp));
      }
      ctx.stroke();
    };

    // Unplayed waveform region
    ctx.save();
    renderStudioPass(
      colors.unplayedOuterTop,
      colors.unplayedOuterMid,
      colors.unplayedCore,
      colors.unplayedEdge
    );
    ctx.restore();

    // Played waveform region clipped cleanly to playhead
    if (playheadX > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.min(width, playheadX), height);
      ctx.clip();
      renderStudioPass(
        colors.playedOuterTop,
        colors.playedOuterMid,
        colors.playedCore,
        colors.playedEdge
      );
      ctx.restore();
    }
  };

  // Draw studio DAW audio waveform (1px Peak + local RMS core)
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const height = 52;
    const renderWidth = Math.min(trackWidth, 16000);
    const scaleFactor = renderWidth / Math.max(1, trackWidth);
    if (canvas.width !== renderWidth || canvas.height !== height) {
      canvas.width = renderWidth;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { peak, rms } = buildStudioPeakAndRms(waveformPeaks, renderWidth, 1, 0);
    drawStudioWaveform(
      ctx,
      renderWidth,
      height,
      peak,
      rms,
      currentTime * pxPerSec * scaleFactor,
      tickStepSec * pxPerSec * scaleFactor,
      {
        bg: '#0B1016',
        grid: 'rgba(255, 255, 255, 0.045)',
        subGrid: 'rgba(255, 255, 255, 0.02)',
        axis: 'rgba(45, 212, 191, 0.25)',
        playedOuterTop: 'rgba(45, 212, 191, 0.58)',
        playedOuterMid: 'rgba(20, 184, 166, 0.36)',
        playedCore: 'rgba(94, 234, 212, 0.78)',
        playedEdge: '#5EEAD4',
        unplayedOuterTop: 'rgba(20, 120, 118, 0.42)',
        unplayedOuterMid: 'rgba(15, 86, 86, 0.24)',
        unplayedCore: 'rgba(36, 175, 165, 0.48)',
        unplayedEdge: 'rgba(45, 212, 191, 0.56)',
      }
    );
  }, [trackWidth, waveformPeaks, currentTime, pxPerSec, tickStepSec]);

  // Draw studio DAW vocal waveform (Vocal bandpass RMS core + transient peaks)
  useEffect(() => {
    const canvas = vocalCanvasRef.current;
    if (!canvas) return;
    const height = 32;
    const renderWidth = Math.min(trackWidth, 16000);
    const scaleFactor = renderWidth / Math.max(1, trackWidth);
    if (canvas.width !== renderWidth || canvas.height !== height) {
      canvas.width = renderWidth;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { peak, rms } = buildStudioPeakAndRms(
      waveformPeaks,
      renderWidth,
      1.04,
      0.015,
      vocalEnvelope.length > 0 ? vocalEnvelope : undefined
    );
    drawStudioWaveform(
      ctx,
      renderWidth,
      height,
      peak,
      rms,
      currentTime * pxPerSec * scaleFactor,
      tickStepSec * pxPerSec * scaleFactor,
      {
        bg: '#08130B',
        grid: 'rgba(255, 255, 255, 0.04)',
        subGrid: 'rgba(255, 255, 255, 0.018)',
        axis: 'rgba(74, 222, 128, 0.24)',
        playedOuterTop: 'rgba(74, 222, 128, 0.55)',
        playedOuterMid: 'rgba(34, 197, 94, 0.34)',
        playedCore: 'rgba(134, 239, 172, 0.8)',
        playedEdge: '#86EFAC',
        unplayedOuterTop: 'rgba(22, 120, 62, 0.42)',
        unplayedOuterMid: 'rgba(16, 84, 44, 0.24)',
        unplayedCore: 'rgba(46, 196, 110, 0.48)',
        unplayedEdge: 'rgba(74, 222, 128, 0.56)',
      }
    );
  }, [trackWidth, waveformPeaks, vocalEnvelope, currentTime, pxPerSec, tickStepSec]);

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (e: PointerEvent) => {
      if (dragState.type === 'scrub') {
        const gridEl = trackGridRef.current;
        const container = scrollContainerRef.current;
        const rect = gridEl?.getBoundingClientRect() ?? container?.getBoundingClientRect();
        if (!rect) return;
        const x = gridEl
          ? e.clientX - rect.left
          : e.clientX - rect.left + (container?.scrollLeft ?? 0);
        onSeek(clamp(x / pxPerSec, 0, safeDuration));
        return;
      }

      const snapThresholdSec = Math.min(0.12, 12 / pxPerSec);
      const getSnappedTime = (t: number, excludeLineId?: string): number => {
        const candidates: number[] = [0, safeDuration, currentTime];
        for (const l of lyrics) {
          if (l.id === excludeLineId) continue;
          candidates.push(l.start, l.end);
        }
        for (let s = 0; s <= safeDuration; s += tickStepSec) {
          candidates.push(s);
        }
        let best = t;
        let minD = snapThresholdSec;
        for (const c of candidates) {
          const d = Math.abs(c - t);
          if (d < minD) {
            minD = d;
            best = c;
          }
        }
        return best;
      };

      const deltaSec = (e.clientX - dragState.startClientX) / pxPerSec;
      const minDur = 0.35;

      if (dragState.type === 'move') {
        const len = dragState.initialEnd - dragState.initialStart;
        const rawNextStart = clamp(dragState.initialStart + deltaSec, 0, safeDuration - len);
        const nextStart = getSnappedTime(rawNextStart, dragState.lineId);
        onUpdateLineTiming(
          dragState.lineId,
          Number(nextStart.toFixed(2)),
          Number((nextStart + len).toFixed(2))
        );
      } else if (dragState.type === 'resize-left') {
        const rawNextStart = clamp(
          dragState.initialStart + deltaSec,
          0,
          dragState.initialEnd - minDur
        );
        const nextStart = getSnappedTime(rawNextStart, dragState.lineId);
        onUpdateLineTiming(
          dragState.lineId,
          Number(nextStart.toFixed(2)),
          dragState.initialEnd
        );
      } else if (dragState.type === 'resize-right') {
        const rawNextEnd = clamp(
          dragState.initialEnd + deltaSec,
          dragState.initialStart + minDur,
          safeDuration
        );
        const nextEnd = getSnappedTime(rawNextEnd, dragState.lineId);
        onUpdateLineTiming(
          dragState.lineId,
          dragState.initialStart,
          Number(nextEnd.toFixed(2))
        );
      }
    };

    const handleUp = () => setDragState(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragState, pxPerSec, safeDuration, onSeek, onUpdateLineTiming]);

  const ticks: number[] = [];
  if (!isEmptyTimeline) {
    for (let s = 0; s <= safeDuration; s += tickStepSec) {
      ticks.push(s);
    }
  }

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEmptyTimeline) return;
    const gridEl = trackGridRef.current;
    const container = scrollContainerRef.current;
    const rect = gridEl?.getBoundingClientRect() ?? container?.getBoundingClientRect();
    if (!rect) return;
    const x = gridEl
      ? e.clientX - rect.left
      : e.clientX - rect.left + (container?.scrollLeft ?? 0);
    onSeek(clamp(x / pxPerSec, 0, safeDuration));
    setDragState({ type: 'scrub' });
  };

  return (
    <section
      aria-label="Timeline"
      className="h-52 sm:h-56 shrink-0 flex flex-col bg-[#121922] border-t border-[#273545] select-none"
    >
      {/* Timeline Broadcast Toolbar */}
      <div className="min-h-9 sm:h-9 px-2.5 sm:px-3 py-1.5 sm:py-0 border-b border-[#273545] bg-[#19232E] flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-between gap-2 sm:gap-4 shrink-0">
        <div className="flex items-center justify-center sm:justify-start gap-2 sm:gap-3 text-[11px] text-[#8696A8] min-w-0">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={duration <= 0}
              aria-label="Timeline play"
              onClick={onPlay}
              className={`p-1 cursor-pointer ${isPlaying ? 'v-btn-teal' : 'v-btn'}`}
            >
              <Play className="w-3 h-3 fill-current" />
            </button>
            <button
              type="button"
              disabled={duration <= 0}
              aria-label="Timeline pause"
              onClick={onPause}
              className={`p-1 cursor-pointer ${
                !isPlaying && currentTime > 0 ? 'v-btn-amber' : 'v-btn'
              }`}
            >
              <Pause className="w-3 h-3 fill-current" />
            </button>
            <button
              type="button"
              disabled={duration <= 0}
              aria-label="Timeline stop"
              onClick={onStop}
              className="v-btn p-1 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          </div>

          <span className="font-semibold uppercase tracking-wider text-[#EEF3F8] whitespace-nowrap">
            Timeline
          </span>

          {selectedLine ? (
            <span className="hidden sm:inline truncate">
              <span className="text-[#EEF3F8]">{selectedLine.text.trim() || 'Lyric cue'}</span> ·{' '}
              <span className="font-mono-tabular text-[#F87171]">
                {formatTimecode(selectedLine.start)}–{formatTimecode(selectedLine.end)}
              </span>{' '}
              ·{' '}
              <span>
                {EFFECT_OPTIONS.find((o) => o.value === selectedLine.effect)?.label ??
                  selectedLine.effect}
              </span>
            </span>
          ) : isEmptyTimeline ? (
            <span className="hidden sm:inline truncate text-[#8696A8]">
              Load audio or add lyrics
            </span>
          ) : (
            <span className="hidden sm:inline truncate text-[#8696A8]">
              Drag cue segments or edges to adjust timing
            </span>
          )}
        </div>

        <div className="flex items-center justify-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            disabled={isEmptyTimeline}
            onClick={() => {
              const containerW = scrollContainerRef.current?.clientWidth ?? 900;
              const fitted = clamp((containerW - 24) / safeDuration, 2, 140);
              setFitToViewport(true);
              setPxPerSec(Number(fitted.toFixed(2)));
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollLeft = 0;
              }
            }}
            className={`px-2 sm:px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
              fitToViewport ? 'v-btn-teal' : 'v-btn'
            }`}
          >
            Fit
          </button>
          <button
            type="button"
            disabled={isEmptyTimeline}
            aria-label="Zoom out timeline"
            onClick={() => {
              setFitToViewport(false);
              setPxPerSec((z) => Math.max(2, Number((z * 0.78).toFixed(2))));
            }}
            className="v-btn-knob p-1.5 cursor-pointer"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <input
            type="range"
            disabled={isEmptyTimeline}
            aria-label="Timeline zoom"
            min={2}
            max={140}
            step={1}
            value={Math.round(pxPerSec)}
            onChange={(e) => {
              setFitToViewport(false);
              setPxPerSec(Number(e.target.value));
            }}
            className="w-14 sm:w-20 studio-slider disabled:opacity-30"
          />
          <button
            type="button"
            disabled={isEmptyTimeline}
            aria-label="Zoom in timeline"
            onClick={() => {
              setFitToViewport(false);
              setPxPerSec((z) => Math.min(140, Number((z * 1.28 + 2).toFixed(2))));
            }}
            className="v-btn-knob p-1.5 cursor-pointer"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Scrollable Tracks */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Track Labels Column */}
        <div className="w-20 sm:w-28 shrink-0 border-r border-[#273545] bg-[#151E28] flex flex-col text-[10px] font-semibold uppercase tracking-wider text-[#8696A8]">
          <div className="h-6 border-b border-[#273545] px-2 sm:px-2.5 flex items-center font-mono-tabular">
            Time
          </div>
          <div className="h-12 border-b border-[#273545] px-2.5 flex items-center text-[#EEF3F8]">
            Lyrics
          </div>
          <div className="h-8 border-b border-[#273545] px-2.5 flex items-center text-[#2EC46E]">
            Vocal Wave
          </div>
          <div className="flex-1 px-2.5 flex items-center text-[#24C4B4]">Waveform</div>
        </div>

        {/* Scrollable Track Grid */}
        <div
          ref={scrollContainerRef}
          data-testid="timeline-scroll"
          className="flex-1 overflow-x-auto overflow-y-hidden relative bg-[#0C1117] px-2.5"
        >
          {isEmptyTimeline ? (
            <div className="h-full w-full flex flex-col items-center justify-center text-center px-4">
              <p className="text-xs text-[#8696A8]">
                Load an audio track or enter lyrics to populate the timeline.
              </p>
            </div>
          ) : (
            <div ref={trackGridRef} className="relative h-full" style={{ width: `${trackWidth}px` }}>
              {/* Time Ruler */}
              <div
                onPointerDown={handleRulerPointerDown}
                className="h-6 border-b border-[#273545] bg-[#151E28] relative cursor-ew-resize"
              >
                {ticks.map((sec) => (
                  <div
                    key={sec}
                    className="absolute top-0 bottom-0 border-l border-[#273545] pl-1 text-[10px] font-mono-tabular text-[#8696A8] flex items-center pointer-events-none"
                    style={{ left: `${sec * pxPerSec}px` }}
                  >
                    {formatDurationShort(sec)}
                  </div>
                ))}
              </div>

              {/* Lyrics Segments Track (Flat 2D Cyan clips) */}
              <div className="h-12 border-b border-[#273545] relative bg-[#0B141A]">
                {lyrics.map((line) => {
                  const left = line.start * pxPerSec;
                  const width = Math.max(20, (line.end - line.start) * pxPerSec);
                  const isSelected = line.id === selectedLineId;
                  const accent = SECTION_COLORS[line.section];

                  return (
                    <div
                      key={line.id}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelectLine(line.id);
                        setDragState({
                          type: 'move',
                          lineId: line.id,
                          initialStart: line.start,
                          initialEnd: line.end,
                          startClientX: e.clientX,
                        });
                      }}
                      className={`absolute top-1.5 bottom-1.5 rounded-[3px] overflow-hidden flex items-center cursor-grab active:cursor-grabbing border transition-colors ${
                        isSelected
                          ? 'border-[#67E8F9] bg-[#0891B2]'
                          : 'border-[#06B6D4]/75 bg-[#0E7490] hover:border-[#22D3EE] hover:bg-[#0891B2]/90'
                      }`}
                      style={{ left: `${left}px`, width: `${width}px` }}
                    >
                      <div
                        className="absolute top-0 left-0 right-0 h-[2px]"
                        style={{ backgroundColor: accent }}
                      />
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectLine(line.id);
                          setDragState({
                            type: 'resize-left',
                            lineId: line.id,
                            initialStart: line.start,
                            initialEnd: line.end,
                            startClientX: e.clientX,
                          });
                        }}
                        title="Drag to adjust start time"
                        className="w-2.5 h-full shrink-0 cursor-ew-resize bg-[#083344]/35 border-r border-[#22D3EE]/30 hover:bg-[#22D3EE]/25 flex items-center justify-center"
                      >
                        <span className="w-[1px] h-3 bg-[#67E8F9]/60" />
                      </div>
                      <span className="px-1.5 text-[11px] font-medium text-[#ECFEFF] truncate flex-1 pointer-events-none">
                        {line.text.trim() || 'Lyric cue'}
                      </span>
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectLine(line.id);
                          setDragState({
                            type: 'resize-right',
                            lineId: line.id,
                            initialStart: line.start,
                            initialEnd: line.end,
                            startClientX: e.clientX,
                          });
                        }}
                        title="Drag to adjust end time"
                        className="w-2.5 h-full shrink-0 cursor-ew-resize bg-[#083344]/35 border-l border-[#22D3EE]/30 hover:bg-[#22D3EE]/25 flex items-center justify-center"
                      >
                        <span className="w-[1px] h-3 bg-[#67E8F9]/60" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Vocal Waveform Sub-Track (smooth green wave envelope) */}
              <div
                onPointerDown={handleRulerPointerDown}
                className="h-8 border-b border-[#273545] relative bg-[#09150C] cursor-ew-resize"
              >
                <canvas
                  ref={vocalCanvasRef}
                  className="block"
                  style={{ width: `${trackWidth}px`, height: '32px' }}
                />
              </div>

              {/* Waveform Track */}
              <div onPointerDown={handleRulerPointerDown} className="relative cursor-ew-resize">
                <canvas
                  ref={waveformCanvasRef}
                  className="block"
                  style={{ width: `${trackWidth}px`, height: '52px' }}
                />
              </div>

              {/* Timeline Playhead (#F2C230) */}
              <div
                data-testid="timeline-playhead"
                className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-[#F2C230] shadow-[0_0_6px_rgba(242,194,48,0.65)] z-20"
                style={{ left: `${clamp(currentTime * pxPerSec, 0, trackWidth - 2)}px` }}
              >
                <div className="w-2.5 h-2.5 -ml-[4px] bg-[#F2C230] border border-[#0C1117] rounded-b-[2px]" />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
