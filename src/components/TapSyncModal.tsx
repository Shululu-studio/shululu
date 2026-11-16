import React, { useEffect, useState } from 'react';
import { Check, Hand, Play, RotateCcw, Square, X } from 'lucide-react';
import { LyricLine } from '../types/editor';
import { redistributeWordTimings } from '../utils/lyricsParser';
import { formatTimecode } from '../utils/timeFormat';

interface TapSyncModalProps {
  isOpen: boolean;
  lyrics: LyricLine[];
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  hasAudio: boolean;
  onStartPlaybackFromZero: () => void;
  onStopPlayback: () => void;
  onApplyTapTimings: (updatedLines: LyricLine[]) => void;
  onClose: () => void;
}

export const TapSyncModal: React.FC<TapSyncModalProps> = ({
  isOpen,
  lyrics,
  duration,
  currentTime,
  isPlaying,
  hasAudio,
  onStartPlaybackFromZero,
  onStopPlayback,
  onApplyTapTimings,
  onClose,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [stamps, setStamps] = useState<Array<{ start: number; end: number }>>([]);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      setStamps(lyrics.map((l) => ({ start: l.start, end: l.end })));
    }
  }, [isOpen, lyrics]);

  const handleTap = () => {
    if (activeIndex >= lyrics.length) return;
    const t = Number(currentTime.toFixed(2));
    setStamps((prev) => {
      const next = [...prev];
      if (activeIndex > 0 && next[activeIndex - 1]) {
        next[activeIndex - 1] = {
          ...next[activeIndex - 1],
          end: Math.max(next[activeIndex - 1].start + 0.35, Number((t - 0.08).toFixed(2))),
        };
      }
      next[activeIndex] = {
        start: t,
        end: Math.min(duration, Number((t + 2.8).toFixed(2))),
      };
      return next;
    });
    setActiveIndex((i) => Math.min(lyrics.length, i + 1));
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  const currentLine = lyrics[activeIndex] ?? null;
  const nextLine = lyrics[activeIndex + 1] ?? null;

  const handleSave = () => {
    onStopPlayback();
    const updated = lyrics.map((line, i) => {
      const s = stamps[i];
      if (!s) return line;
      return redistributeWordTimings({
        ...line,
        start: s.start,
        end: Math.max(s.start + 0.4, s.end),
      });
    });
    onApplyTapTimings(updated);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tapsync-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C1117]/80 p-4"
    >
      <div className="w-full max-w-xl bg-[#121922] border border-[#273545] rounded-[4px] shadow-[0_16px_48px_rgba(0,0,0,0.7)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#273545] bg-[#19232E] flex items-center justify-between">
          <h2 id="tapsync-modal-title" className="text-xs font-semibold uppercase tracking-wider text-[#EEF3F8]">
            Tap-to-Sync Cue Recorder
          </h2>
          <button
            type="button"
            aria-label="Close tap sync"
            onClick={() => {
              onStopPlayback();
              onClose();
            }}
            className="v-btn p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-4 bg-[#121922]">
          {!hasAudio || lyrics.length === 0 ? (
            <p className="text-xs text-[#8696A8] py-4 text-center">
              Load an audio track and add lyric lines before running Tap Sync.
            </p>
          ) : (
            <>
              <div className="v-panel flex items-center justify-between px-3.5 py-2">
                <div className="font-mono-tabular text-sm text-[#F2C230]">
                  {formatTimecode(currentTime)}{' '}
                  <span className="text-[#8696A8]">/ {formatTimecode(duration)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveIndex(0);
                      onStartPlaybackFromZero();
                    }}
                    className="v-btn-amber inline-flex items-center gap-1.5 px-3 py-1 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
                  >
                    {isPlaying ? (
                      <>
                        <RotateCcw className="w-3 h-3" aria-hidden="true" />
                        <span>Restart</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                        <span>Play</span>
                      </>
                    )}
                  </button>
                  {isPlaying && (
                    <button
                      type="button"
                      onClick={onStopPlayback}
                      className="v-btn inline-flex items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                    >
                      <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                      <span>Stop</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="v-inset p-4 text-center space-y-2.5">
                <div className="text-[11px] font-mono-tabular text-[#F87171]">
                  Cue {Math.min(activeIndex + 1, lyrics.length)} / {lyrics.length}
                </div>
                {currentLine ? (
                  <div className="text-base font-medium text-[#EEF3F8]">{currentLine.text}</div>
                ) : (
                  <div className="text-sm font-semibold text-[#F87171]">
                    All cues stamped. Click Save Timings.
                  </div>
                )}
                {nextLine && (
                  <div className="text-xs text-[#8696A8]">Next: {nextLine.text}</div>
                )}
              </div>

              <button
                type="button"
                disabled={activeIndex >= lyrics.length}
                onClick={handleTap}
                className="v-btn-teal w-full py-3 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                <Hand className="w-4 h-4 text-[#E4E4E7]" aria-hidden="true" />
                <span>Tap Line Start (Spacebar)</span>
              </button>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#273545] bg-[#19232E] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              onStopPlayback();
              onClose();
            }}
            className="v-btn px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={lyrics.length === 0}
            onClick={handleSave}
            className="v-btn-teal inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Save Timings</span>
          </button>
        </div>
      </div>
    </div>
  );
};
