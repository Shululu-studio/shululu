import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  FileEdit,
  Hand,
  Play,
  Plus,
  RotateCcw,
  Square,
  StepBack,
  Trash2,
  X,
} from 'lucide-react';
import { SECTION_LABELS } from '../data/presets';
import { LyricLine, SectionType } from '../types/editor';
import { formatTimecode } from '../utils/timeFormat';
import {
  applyTapAtIndex,
  createBlankTapCueLine,
  finalizeTapSyncLines,
  formatDraftLinesForBulkEdit,
  syncDraftLinesFromBulkText,
} from '../utils/tapSync';

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

const SECTIONS: SectionType[] = [
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'bridge',
  'outro',
];

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
  const [draftLines, setDraftLines] = useState<LyricLine[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState('');
  const activeRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      setDraftLines(lyrics.map((l) => ({ ...l, words: [...l.words] })));
      setBulkEditOpen(false);
      setBulkDraft(formatDraftLinesForBulkEdit(lyrics));
    }
  }, [isOpen, lyrics]);

  useEffect(() => {
    if (!isOpen || bulkEditOpen) return;
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex, isOpen, bulkEditOpen]);

  const handleTap = () => {
    if (bulkEditOpen || activeIndex >= draftLines.length) return;
    const result = applyTapAtIndex(draftLines, activeIndex, currentTime, duration);
    setDraftLines(result.lines);
    setActiveIndex(result.nextIndex);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.code === 'Space' && !e.repeat && !bulkEditOpen) {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!isOpen) return null;

  const currentLine = draftLines[activeIndex] ?? null;
  const nextLine = draftLines[activeIndex + 1] ?? null;
  const hasSaveableLines = draftLines.some((l) => l.text.trim().length > 0);
  const canSave = hasSaveableLines || (lyrics.length > 0 && draftLines.length === 0);

  const handleUpdateDraftText = (id: string, text: string) => {
    setDraftLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, text } : l))
    );
  };

  const handleUpdateDraftSection = (id: string, section: SectionType) => {
    setDraftLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, section } : l))
    );
  };

  const handleAddDraftLine = () => {
    const newLine = createBlankTapCueLine(draftLines, duration);
    setDraftLines((prev) => [...prev, newLine]);
    if (activeIndex >= draftLines.length) {
      setActiveIndex(draftLines.length);
    }
  };

  const handleDeleteDraftLine = (idx: number) => {
    setDraftLines((prev) => prev.filter((_, i) => i !== idx));
    setActiveIndex((curr) => {
      if (idx < curr) return Math.max(0, curr - 1);
      return Math.min(curr, Math.max(0, draftLines.length - 2));
    });
  };

  const handleOpenBulkEdit = () => {
    setBulkDraft(formatDraftLinesForBulkEdit(draftLines));
    setBulkEditOpen(true);
  };

  const handleApplyBulkEdit = () => {
    const nextLines = syncDraftLinesFromBulkText(bulkDraft, draftLines, duration);
    setDraftLines(nextLines);
    setActiveIndex((curr) => Math.min(curr, Math.max(0, nextLines.length - 1)));
    setBulkEditOpen(false);
  };

  const handleSave = () => {
    onStopPlayback();
    const baseLines = bulkEditOpen
      ? syncDraftLinesFromBulkText(bulkDraft, draftLines, duration)
      : draftLines;
    const finalized = finalizeTapSyncLines(baseLines);
    onApplyTapTimings(finalized);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tapsync-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C1117]/80 p-3 sm:p-4"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-[#121922] border border-[#273545] rounded-[4px] shadow-[0_16px_48px_rgba(0,0,0,0.75)] overflow-hidden">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-[#273545] bg-[#19232E] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`v-led ${isPlaying ? 'v-led-active' : ''}`}
              aria-hidden="true"
            />
            <h2
              id="tapsync-modal-title"
              className="text-xs font-semibold uppercase tracking-wider text-[#EEF3F8] truncate"
            >
              Tap-to-Sync Cue Recorder
            </h2>
            <span className="text-[11px] font-mono-tabular text-[#8696A8] whitespace-nowrap shrink-0">
              {draftLines.length} {draftLines.length === 1 ? 'cue' : 'cues'}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close tap sync"
            onClick={() => {
              onStopPlayback();
              onClose();
            }}
            className="v-btn p-1 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 space-y-3 bg-[#121922]">
          {/* Transport & Mode Controls */}
          <div className="v-panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="font-mono-tabular text-sm text-[#F2C230]">
                {formatTimecode(currentTime)}{' '}
                <span className="text-[#8696A8]">/ {formatTimecode(duration)}</span>
              </div>
              {!hasAudio && (
                <span className="text-[11px] text-[#8696A8]">
                  No audio loaded · edit lyrics freely
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {hasAudio && (
                <>
                  <button
                    type="button"
                    disabled={draftLines.length === 0}
                    onClick={() => {
                      setActiveIndex(0);
                      onStartPlaybackFromZero();
                    }}
                    className="v-btn-amber inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
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
                      className="v-btn inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                    >
                      <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                      <span>Stop</span>
                    </button>
                  )}
                </>
              )}

              {!bulkEditOpen && (
                <button
                  type="button"
                  disabled={activeIndex <= 0}
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                  className="v-btn inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                >
                  <StepBack className="w-3 h-3" aria-hidden="true" />
                  <span>Prev Cue</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (bulkEditOpen) {
                    setBulkEditOpen(false);
                  } else {
                    handleOpenBulkEdit();
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                  bulkEditOpen ? 'v-btn-teal' : 'v-btn'
                }`}
              >
                <FileEdit className="w-3 h-3" aria-hidden="true" />
                <span>{bulkEditOpen ? 'Cue View' : 'Bulk Edit Lyrics'}</span>
              </button>
            </div>
          </div>

          {bulkEditOpen ? (
            /* Bulk Lyrics Editor */
            <div className="v-panel p-3 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="tapsync-bulk-textarea"
                  className="text-[11px] font-semibold uppercase tracking-wider text-[#EEF3F8]"
                >
                  Edit Full Lyrics Text
                </label>
                <span className="text-[11px] text-[#8696A8]">
                  Supports [Verse], [Chorus], or [mm:ss.xx] · preserves existing tap timings
                </span>
              </div>

              <textarea
                id="tapsync-bulk-textarea"
                rows={10}
                value={bulkDraft}
                onChange={(e) => setBulkDraft(e.target.value)}
                placeholder={'[Verse]\nEnter or paste lyric lines here...\nOne line per cue.'}
                className="v-inset w-full px-3 py-2 text-sm text-[#EEF3F8] placeholder-[#8696A8] leading-relaxed focus:outline-none focus:border-[#22D3EE]"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkEditOpen(false)}
                  className="v-btn px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                >
                  Back to Cues
                </button>
                <button
                  type="button"
                  onClick={handleApplyBulkEdit}
                  className="v-btn-teal inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Apply Lyrics</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Active Cue Deck */}
              <div className="v-inset p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono-tabular text-[#F87171]">
                    {draftLines.length === 0
                      ? 'Cue 0 / 0'
                      : `Cue ${Math.min(activeIndex + 1, draftLines.length)} / ${draftLines.length}`}
                  </span>
                  {currentLine && (
                    <span className="text-[11px] font-mono-tabular text-[#8696A8]">
                      {formatTimecode(currentLine.start)} – {formatTimecode(currentLine.end)}
                    </span>
                  )}
                </div>

                {currentLine ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      aria-label="Current cue lyric text"
                      value={currentLine.text}
                      onChange={(e) => handleUpdateDraftText(currentLine.id, e.target.value)}
                      placeholder="Type lyric text for this cue..."
                      className="v-panel w-full px-3 py-2 text-center text-base font-medium text-[#EEF3F8] placeholder-[#8696A8] focus:outline-none focus:border-[#22D3EE]"
                    />
                    {nextLine && (
                      <div className="text-xs text-[#8696A8] text-center truncate">
                        Next: {nextLine.text || '(empty cue)'}
                      </div>
                    )}
                  </div>
                ) : draftLines.length === 0 ? (
                  <p className="text-xs text-[#8696A8] text-center py-2">
                    No lyric cues yet. Add a cue line below or switch to Bulk Edit Lyrics to paste text.
                  </p>
                ) : (
                  <div className="text-sm font-semibold text-[#F87171] text-center py-1">
                    All cues stamped. Edit any cue below or click Save Lyrics &amp; Timings.
                  </div>
                )}

                {draftLines.length > 0 && (
                  <button
                    type="button"
                    disabled={activeIndex >= draftLines.length}
                    onClick={handleTap}
                    className="v-btn-teal w-full py-2.5 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider cursor-pointer"
                  >
                    <Hand className="w-4 h-4 text-[#E4E4E7]" aria-hidden="true" />
                    <span>Tap Line Start (Spacebar)</span>
                  </button>
                )}
              </div>

              {/* Inline Editable Cue & Lyrics List */}
              <div className="v-panel p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8]">
                    Editable Cues &amp; Lyrics ({draftLines.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddDraftLine}
                    className="v-btn inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    <span>Add Line</span>
                  </button>
                </div>

                {draftLines.length === 0 ? (
                  <div className="v-inset py-5 px-3 text-center text-xs text-[#8696A8]">
                    Click Add Line above or Bulk Edit Lyrics to start writing cues.
                  </div>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
                    {draftLines.map((line, idx) => {
                      const isActive = idx === activeIndex;
                      return (
                        <div
                          key={line.id}
                          ref={isActive ? activeRowRef : null}
                          className={`flex items-center gap-1.5 p-1.5 rounded-[4px] border transition-colors ${
                            isActive
                              ? 'bg-[#162332] border-[#22D3EE]'
                              : 'bg-[#0C1117] border-[#243140] hover:border-[#3A4E63]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveIndex(idx)}
                            title={`Jump tap recorder to cue ${idx + 1}`}
                            aria-label={`Select cue ${idx + 1}`}
                            className={`px-2 py-1 text-[10px] font-mono-tabular font-semibold rounded-[3px] shrink-0 cursor-pointer ${
                              isActive
                                ? 'bg-[#22D3EE] text-[#090D14]'
                                : 'bg-[#19232E] text-[#8696A8] hover:text-[#EEF3F8]'
                            }`}
                          >
                            {String(idx + 1).padStart(2, '0')}
                          </button>

                          <select
                            aria-label={`Cue ${idx + 1} section`}
                            value={line.section}
                            onChange={(e) =>
                              handleUpdateDraftSection(line.id, e.target.value as SectionType)
                            }
                            className="v-inset px-1.5 py-1 text-[10px] text-[#EEF3F8] bg-[#121922] shrink-0 focus:outline-none focus:border-[#22D3EE] cursor-pointer"
                          >
                            {SECTIONS.map((sec) => (
                              <option key={sec} value={sec}>
                                {SECTION_LABELS[sec]}
                              </option>
                            ))}
                          </select>

                          <input
                            type="text"
                            aria-label={`Cue ${idx + 1} lyric text`}
                            value={line.text}
                            onChange={(e) => handleUpdateDraftText(line.id, e.target.value)}
                            placeholder="Enter lyric line..."
                            className="v-inset flex-1 min-w-0 px-2.5 py-1 text-xs text-[#EEF3F8] placeholder-[#8696A8] focus:outline-none focus:border-[#22D3EE]"
                          />

                          <span className="hidden sm:inline font-mono-tabular text-[10px] text-[#8696A8] whitespace-nowrap shrink-0 px-1">
                            {formatTimecode(line.start)}–{formatTimecode(line.end)}
                          </span>

                          <button
                            type="button"
                            aria-label={`Delete cue ${idx + 1}`}
                            onClick={() => handleDeleteDraftLine(idx)}
                            className="v-btn p-1.5 text-[#8696A8] hover:text-[#E05252] shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[#273545] bg-[#19232E] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-[#8696A8]">
            Edit any lyric inline or click a cue number to re-stamp its timing.
          </span>
          <div className="flex items-center gap-2 ml-auto">
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
              disabled={!canSave}
              onClick={handleSave}
              className="v-btn-teal inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Save Lyrics &amp; Timings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
