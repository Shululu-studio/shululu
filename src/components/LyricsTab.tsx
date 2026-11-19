import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  AudioLines,
  ClipboardPaste,
  Edit3,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { LYRIC_LANGUAGES, SECTION_COLORS, SECTION_LABELS } from '../data/presets';
import { LyricLine, SectionType, VocalRole } from '../types/editor';
import { formatTimecode } from '../utils/timeFormat';

const VOCAL_ROLE_LABELS: Record<VocalRole, string> = {
  lead: 'Lead',
  backing: 'Backing',
  choir: 'Choir',
  adlib: 'Ad-lib',
};

interface LyricsTabProps {
  audioFileName: string | null;
  duration: number;
  language?: string;
  onChangeLanguage?: (language: string) => void;
  lyrics: LyricLine[];
  selectedLineId: string | null;
  isSyncing: boolean;
  syncStatusText: string;
  syncError?: string | null;
  autoReviewActive?: boolean;
  pasteDrawerOpen?: boolean;
  onTogglePasteDrawer?: (open: boolean) => void;
  onClearSyncError?: () => void;
  onCreateBlankCueSlots?: () => void;
  onUploadAudio: (file: File) => void;
  onImportLyricsText: (rawText: string) => void;
  onAutoCreateLyrics: () => void;
  onRunAutoSync: () => void;
  onShiftAllTiming?: (deltaSec: number) => void;
  onApplyBulkEditText: (rawText: string) => void;
  onDismissAutoReview?: () => void;
  onSelectLine: (id: string) => void;
  onAddLine: () => void;
  onUpdateLine: (id: string, patch: Partial<LyricLine>) => void;
  onUpdateWordText: (lineId: string, wordId: string, newText: string) => void;
  onMoveLine: (id: string, direction: -1 | 1) => void;
  onDeleteLine: (id: string) => void;
  onFillLongSongCues?: () => void;
  onCreateWorshipTemplate?: () => void;
}

function formatLyricsForBulkEdit(lyrics: LyricLine[]): string {
  const out: string[] = [];
  let prevSection: SectionType | null = null;
  for (const line of lyrics) {
    if (line.section !== prevSection) {
      if (out.length > 0) out.push('');
      out.push(`[${SECTION_LABELS[line.section]}]`);
      prevSection = line.section;
    }
    out.push(line.text);
  }
  return out.join('\n');
}

export const LyricsTab: React.FC<LyricsTabProps> = ({
  audioFileName,
  duration,
  language = 'auto',
  onChangeLanguage,
  lyrics,
  selectedLineId,
  isSyncing,
  syncStatusText,
  syncError = null,
  autoReviewActive = false,
  pasteDrawerOpen,
  onTogglePasteDrawer,
  onClearSyncError,
  onCreateBlankCueSlots,
  onUploadAudio,
  onImportLyricsText,
  onAutoCreateLyrics,
  onRunAutoSync,
  onShiftAllTiming,
  onApplyBulkEditText,
  onDismissAutoReview,
  onSelectLine,
  onAddLine,
  onUpdateLine,
  onUpdateWordText,
  onMoveLine,
  onDeleteLine,
  onFillLongSongCues,
  onCreateWorshipTemplate,
}) => {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [localPasteOpen, setLocalPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState('');
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState('');
  const [expandedWordsLineId, setExpandedWordsLineId] = useState<string | null>(null);
  const [reviewOnlyUncertain, setReviewOnlyUncertain] = useState(false);

  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [urlInputMode, setUrlInputMode] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleLoadFromUrl = async () => {
    const trimmed = mediaUrl.trim();
    if (!trimmed) return;
    if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
      setUrlError('YouTube web links cannot be loaded directly because YouTube blocks direct browser fetches (CORS). Please use a direct MP3/WAV file link or upload the audio file from your device.');
      return;
    }
    try {
      setIsLoadingUrl(true);
      setUrlError(null);
      const res = await fetch(trimmed);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const blob = await res.blob();
      const filename = trimmed.split('/').pop()?.split('?')[0] || 'imported_audio.mp3';
      const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });
      if (audioFileName) {
        setBulkEditOpen(false);
        setBulkDraft('');
        setExpandedWordsLineId(null);
      }
      onUploadAudio(file);
      setSourcePickerOpen(false);
      setUrlInputMode(false);
      setMediaUrl('');
    } catch (err: any) {
      setUrlError(err?.message || 'Failed to fetch audio from URL (check CORS permissions or direct link validity).');
    } finally {
      setIsLoadingUrl(false);
    }
  };

  const pasteOpen = pasteDrawerOpen ?? localPasteOpen;
  const setPasteOpen = (open: boolean) => {
    setLocalPasteOpen(open);
    onTogglePasteDrawer?.(open);
  };

  const formattedCurrentLyrics = useMemo(
    () => formatLyricsForBulkEdit(lyrics),
    [lyrics]
  );

  const uncertainLines = useMemo(
    () =>
      lyrics.filter(
        (l) =>
          Boolean(l.uncertain) ||
          (typeof l.confidence === 'number' && l.confidence < 0.72) ||
          l.words.some((w) => w.uncertain)
      ),
    [lyrics]
  );

  const displayedLyrics = useMemo(
    () => (reviewOnlyUncertain && uncertainLines.length > 0 ? uncertainLines : lyrics),
    [lyrics, reviewOnlyUncertain, uncertainLines]
  );

  const handleOpenBulkEdit = () => {
    setBulkDraft(formattedCurrentLyrics);
    setBulkEditOpen((prev) => !prev);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      onImportLyricsText(text);
    } catch {
      // Ignore unreadable file selection errors
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#121922]">
      {/* Organized Media & Lyrics Control Rack */}
      <div className="p-2.5 border-b border-[#273545] space-y-2 shrink-0 bg-[#0C1117]">
        {/* Group 1: Audio Source */}
        <div className="v-panel p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] shrink-0">
              <span className={`v-led ${audioFileName ? 'v-led-active' : ''}`} aria-hidden="true" />
              <span>Audio Source</span>
            </span>
            {audioFileName ? (
              <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[#EEF3F8]">
                <span className="truncate max-w-[130px]" title={audioFileName}>
                  {audioFileName}
                </span>
                <span className="text-[#8696A8] shrink-0">·</span>
                <span className="font-mono-tabular text-[#22D3EE] font-semibold shrink-0">
                  {formatTimecode(duration)}
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-[#8696A8]">None</span>
            )}
          </div>

          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (audioFileName) {
                  setBulkEditOpen(false);
                  setBulkDraft('');
                  setExpandedWordsLineId(null);
                }
                onUploadAudio(f);
              }
              e.target.value = '';
            }}
          />
          <input
            ref={textInputRef}
            type="file"
            accept=".txt,.lrc,text/plain"
            className="hidden"
            onChange={handleFileImport}
          />

          <button
            type="button"
            onClick={() => setSourcePickerOpen(true)}
            className="v-btn w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#D4D4D8]" aria-hidden="true" />
            <span>{audioFileName ? 'Replace Audio' : 'Load Audio'}</span>
          </button>
        </div>

        {sourcePickerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
            <div className="v-panel p-4 w-full max-w-sm space-y-3 bg-[#121922] border-[#273545] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#273545] pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#EEF3F8]">
                  Select Audio Source
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSourcePickerOpen(false);
                    setUrlInputMode(false);
                    setUrlError(null);
                  }}
                  className="v-btn w-6 h-6 flex items-center justify-center text-[#8696A8] hover:text-[#EEF3F8] text-xs font-bold cursor-pointer"
                  aria-label="Close audio source picker"
                >
                  ✕
                </button>
              </div>

              {!urlInputMode ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSourcePickerOpen(false);
                      audioInputRef.current?.click();
                    }}
                    className="v-btn w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4 text-[#22D3EE]" aria-hidden="true" />
                    <span>Upload from Device (File)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUrlInputMode(true)}
                    className="v-btn w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider cursor-pointer"
                  >
                    <Globe className="w-4 h-4 text-[#22D3EE]" aria-hidden="true" />
                    <span>Import via Audio / Video Link</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <label htmlFor="media-url-input" className="block text-[11px] font-medium text-[#8696A8]">
                    Paste direct audio or video file URL (MP3, WAV, AAC, MP4)
                  </label>
                  <input
                    id="media-url-input"
                    type="url"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="https://example.com/song.mp3"
                    className="v-inset w-full p-2 text-xs text-[#EEF3F8] placeholder:text-[#8696A8] focus:outline-none focus:border-[#22D3EE]"
                  />
                  {urlError && (
                    <p className="text-[11px] text-[#E05252]" role="alert">
                      {urlError}
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setUrlInputMode(false)}
                      className="v-btn px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleLoadFromUrl}
                      disabled={isLoadingUrl || !mediaUrl.trim()}
                      className="v-btn-teal px-3 py-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer flex items-center gap-1.5"
                    >
                      {isLoadingUrl && <Loader2 className="w-3 h-3 animate-spin shrink-0" aria-hidden="true" />}
                      <span>Load URL</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Group 2: Lyrics Input & Sync Tools */}
        <div className="v-panel p-2 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] px-0.5 text-center sm:text-left">
            Lyrics &amp; Timing Tools
          </div>
          {onChangeLanguage && (
            <div className="flex items-center justify-between gap-2 px-0.5">
              <label
                htmlFor="lyrics-language-select"
                className="text-[10px] font-medium uppercase tracking-wider text-[#8696A8] shrink-0"
              >
                Language
              </label>
              <select
                id="lyrics-language-select"
                aria-label="Lyrics language"
                value={language}
                onChange={(e) => onChangeLanguage(e.target.value)}
                disabled={isSyncing}
                className="v-inset flex-1 min-w-0 px-2 py-1 text-[11px] text-[#EEF3F8] focus:outline-none focus:border-[#22D3EE]"
              >
                {LYRIC_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setPasteOpen(!pasteOpen)}
              className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                pasteOpen ? 'v-btn-teal' : 'v-btn'
              }`}
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-[#D4D4D8]" aria-hidden="true" />
              <span>Paste</span>
            </button>

            <button
              type="button"
              onClick={() => textInputRef.current?.click()}
              className="v-btn flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-[#D4D4D8]" aria-hidden="true" />
              <span>Import</span>
            </button>

            <button
              type="button"
              onClick={onAutoCreateLyrics}
              disabled={isSyncing || !audioFileName}
              className="v-btn-teal flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
            >
              {isSyncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <AudioLines className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>Auto Transcribe</span>
            </button>

            <button
              type="button"
              onClick={onRunAutoSync}
              disabled={isSyncing || !audioFileName || lyrics.length === 0}
              className="v-btn flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#D4D4D8] shrink-0" aria-hidden="true" />
              <span>Sync</span>
            </button>
          </div>
          {lyrics.length > 0 && onShiftAllTiming && (
            <div className="pt-1.5 border-t border-[#273545]/80 flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[#8696A8] shrink-0">
                Nudge All
              </span>
              <div className="grid grid-cols-4 gap-1 flex-1 max-w-[220px]">
                {[
                  { delta: -0.5, label: '-0.5s', title: 'Shift all lyrics 500ms earlier' },
                  { delta: -0.1, label: '-0.1s', title: 'Shift all lyrics 100ms earlier' },
                  { delta: 0.1, label: '+0.1s', title: 'Shift all lyrics 100ms later' },
                  { delta: 0.5, label: '+0.5s', title: 'Shift all lyrics 500ms later' },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    title={item.title}
                    disabled={isSyncing}
                    onClick={() => onShiftAllTiming(item.delta)}
                    className="v-btn py-1 px-1 text-[10px] font-mono-tabular font-semibold text-[#EEF3F8] hover:text-[#22D3EE] whitespace-nowrap cursor-pointer"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {isSyncing && syncStatusText && (
          <div className="v-inset px-2.5 py-1.5 text-[11px] text-[#22D3EE] flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />
            <span className="truncate">{syncStatusText}</span>
          </div>
        )}

        {!isSyncing && syncError && (
          <div
            role="alert"
            className="v-panel p-2.5 border-[#E05252]/70 space-y-2"
          >
            <div className="flex items-start gap-2 text-[11px] text-[#EEF3F8]">
              <AlertCircle className="w-3.5 h-3.5 text-[#E05252] shrink-0 mt-0.5" aria-hidden="true" />
              <span className="leading-snug">{syncError}</span>
            </div>
            <div className="flex items-center justify-end gap-1.5">
              {onCreateWorshipTemplate && (
                <button
                  type="button"
                  onClick={onCreateWorshipTemplate}
                  className="v-btn-teal px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                >
                  Worship Template
                </button>
              )}
              {onCreateBlankCueSlots && (
                <button
                  type="button"
                  onClick={onCreateBlankCueSlots}
                  className="v-btn px-2 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                >
                  Create Cue Slots
                </button>
              )}
              {onClearSyncError && (
                <button
                  type="button"
                  onClick={onClearSyncError}
                  className="v-btn px-2 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}

        {pasteOpen && (
          <div className="v-panel p-2.5 space-y-2">
            <label htmlFor="paste-lyrics-area" className="block text-[11px] font-medium text-[#8696A8]">
              Paste lyrics ([Verse], [Chorus] or LRC timestamps)
            </label>
            <textarea
              id="paste-lyrics-area"
              value={pasteDraft}
              onChange={(e) => setPasteDraft(e.target.value)}
              rows={5}
              placeholder="Paste lyrics here, one line per row..."
              className="v-inset w-full p-2 text-xs text-[#EEF3F8] placeholder:text-[#8696A8] focus:outline-none focus:border-[#22D3EE] resize-y"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="v-btn px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onImportLyricsText(pasteDraft);
                  setPasteDraft('');
                  setPasteOpen(false);
                }}
                disabled={!pasteDraft.trim()}
                className="v-btn-teal px-3 py-1 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {(autoReviewActive || uncertainLines.length > 0) && lyrics.length > 0 && !isSyncing && (
          <div className="v-panel p-2 border-[#22D3EE]/50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="v-led v-led-active" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#EEF3F8] truncate">
                {uncertainLines.length > 0
                  ? `Review (${uncertainLines.length} uncertain)`
                  : 'Review Lyrics'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {uncertainLines.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = !reviewOnlyUncertain;
                    setReviewOnlyUncertain(next);
                    if (next && uncertainLines[0]) {
                      onSelectLine(uncertainLines[0].id);
                      setExpandedWordsLineId(uncertainLines[0].id);
                    }
                  }}
                  className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                    reviewOnlyUncertain ? 'v-btn-amber' : 'v-btn'
                  }`}
                >
                  {reviewOnlyUncertain ? 'All Cues' : 'Flagged'}
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenBulkEdit}
                className="v-btn inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
              >
                <Edit3 className="w-3 h-3 text-[#D4D4D8]" aria-hidden="true" />
                <span>{bulkEditOpen ? 'Close' : 'Edit All'}</span>
              </button>
              {onDismissAutoReview && autoReviewActive && (
                <button
                  type="button"
                  onClick={() => {
                    setBulkEditOpen(false);
                    setReviewOnlyUncertain(false);
                    onDismissAutoReview();
                  }}
                  className="v-btn-teal px-2.5 py-1 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        )}

        {bulkEditOpen && (
          <div className="v-panel p-2.5 space-y-2">
            <label htmlFor="bulk-edit-lyrics-area" className="block text-[11px] font-medium text-[#8696A8]">
              Edit full lyrics text (preserve line count to keep timings)
            </label>
            <textarea
              id="bulk-edit-lyrics-area"
              value={bulkDraft}
              onChange={(e) => setBulkDraft(e.target.value)}
              rows={6}
              className="v-inset w-full p-2 text-xs text-[#EEF3F8] focus:outline-none focus:border-[#22D3EE] resize-y"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className="v-btn px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onApplyBulkEditText(bulkDraft);
                  setBulkEditOpen(false);
                }}
                disabled={!bulkDraft.trim()}
                className="v-btn-teal px-3 py-1 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
              >
                Save Edits
              </button>
            </div>
          </div>
        )}
      </div>

      {duration > 150 && lyrics.length > 0 && lyrics[lyrics.length - 1].end < duration - 45 && (
        <div className="mx-2.5 mt-2.5 v-panel p-2.5 border-[#22D3EE]/50 bg-[#13222B] flex items-center justify-between gap-2 shrink-0">
          <div className="space-y-0.5 min-w-0">
            <div className="text-[11px] font-bold text-[#22D3EE] uppercase tracking-wider">
              Long Song Detected ({Math.round(duration / 60)} min)
            </div>
            <div className="text-[10px] text-[#8696A8] truncate">
              Lyrics end at {formatTimecode(lyrics[lyrics.length - 1].end)}. Fill vamps to end?
            </div>
          </div>
          <button
            type="button"
            onClick={() => onFillLongSongCues?.()}
            className="v-btn-teal px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer shrink-0"
          >
            Fill Remaining Cues
          </button>
        </div>
      )}

      {/* Group 3: Lyric Cue List Header */}
      <div className="px-2.5 py-2 border-b border-[#273545] flex items-center justify-between gap-1.5 shrink-0 bg-[#19232E]">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#EEF3F8] whitespace-nowrap shrink-0">
          Lines <span className="font-mono-tabular text-[#22D3EE]">({lyrics.length})</span>
        </span>
        <div className="flex items-center gap-1 min-w-0">
          {lyrics.length > 0 && !autoReviewActive && (
            <button
              type="button"
              onClick={handleOpenBulkEdit}
              className="v-btn inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
            >
              <span>Edit All</span>
            </button>
          )}
          <button
            type="button"
            onClick={onAddLine}
            className="v-btn inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3 h-3 text-[#D4D4D8] shrink-0" aria-hidden="true" />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Scrollable Lyric Cue List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-[#121922]">
        {lyrics.length === 0 ? (
          <div className="v-panel p-4 text-center space-y-1.5 mt-1">
            <p className="text-xs font-medium text-[#EEF3F8]">No Lyric Cues</p>
            <p className="text-[11px] text-[#8696A8]">
              Load audio and click Auto Transcribe, Paste, or Add Line.
            </p>
          </div>
        ) : (
          displayedLyrics.map((line) => {
            const index = lyrics.findIndex((l) => l.id === line.id);
            const isSelected = line.id === selectedLineId;
            const wordsExpanded = expandedWordsLineId === line.id;
            const lineRole: VocalRole = line.vocalRole ?? 'lead';
            const hasUncertain =
              Boolean(line.uncertain) ||
              (typeof line.confidence === 'number' && line.confidence < 0.72) ||
              line.words.some((w) => w.uncertain);

            return (
              <div
                key={line.id}
                onClick={() => onSelectLine(line.id)}
                className={`p-2.5 rounded-[5px] border transition-colors cursor-pointer space-y-2 ${
                  isSelected
                    ? 'bg-[#13222B] border-[#22D3EE]'
                    : hasUncertain
                      ? 'bg-[#151E28] border-[#F2C230]/65 hover:border-[#F2C230]'
                      : 'bg-[#151E28] border-[#273545] hover:border-[#3A4E63]'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1 min-w-0 flex-wrap">
                    <span
                      className={`v-led ${isSelected ? 'v-led-active' : ''}`}
                      aria-hidden="true"
                    />
                    <span
                      className={`font-mono-tabular text-[11px] px-1.5 py-0.5 rounded-[3px] ${
                        isSelected
                          ? 'bg-[#0891B2] text-white font-semibold'
                          : 'bg-[#19232E] text-[#8696A8]'
                      }`}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <select
                      aria-label={`Section for line ${index + 1}`}
                      value={line.section}
                      onChange={(e) =>
                        onUpdateLine(line.id, { section: e.target.value as SectionType })
                      }
                      onClick={(e) => e.stopPropagation()}
                      style={{ borderColor: SECTION_COLORS[line.section] }}
                      className="text-[11px] font-medium bg-[#0C1117] text-[#EEF3F8] border rounded-[3px] px-1.5 py-0.5 focus:outline-none"
                    >
                      {(Object.keys(SECTION_LABELS) as SectionType[]).map((sec) => (
                        <option key={sec} value={sec}>
                          {SECTION_LABELS[sec]}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Vocal role for line ${index + 1}`}
                      value={lineRole}
                      onChange={(e) =>
                        onUpdateLine(line.id, { vocalRole: e.target.value as VocalRole })
                      }
                      onClick={(e) => e.stopPropagation()}
                      title="Vocal layer (Lead, Backing, Choir, Ad-lib)"
                      className={`text-[10px] font-semibold uppercase tracking-wider bg-[#0C1117] border rounded-[3px] px-1.5 py-0.5 focus:outline-none ${
                        lineRole === 'backing'
                          ? 'border-[#22D3EE]/70 text-[#22D3EE]'
                          : lineRole === 'choir'
                            ? 'border-[#2EC46E]/70 text-[#2EC46E]'
                            : lineRole === 'adlib'
                              ? 'border-[#F2C230]/70 text-[#F2C230]'
                              : 'border-[#273545] text-[#CBD5E1]'
                      }`}
                    >
                      {(Object.keys(VOCAL_ROLE_LABELS) as VocalRole[]).map((role) => (
                        <option key={role} value={role}>
                          {VOCAL_ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                    {hasUncertain && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateLine(line.id, {
                            uncertain: false,
                            confidence: 1,
                            words: line.words.map((w) => ({
                              ...w,
                              uncertain: false,
                              confidence: 1,
                            })),
                          });
                        }}
                        title="Low transcription confidence — edit text or click to confirm"
                        className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-[#F2C230]/15 text-[#F2C230] border border-[#F2C230]/50 rounded-[2px] hover:bg-[#F2C230]/25 cursor-pointer"
                      >
                        Check
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      aria-label={`Move line ${index + 1} up`}
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveLine(line.id, -1);
                      }}
                      className="v-btn-knob w-6 h-6 flex items-center justify-center cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move line ${index + 1} down`}
                      disabled={index === lyrics.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveLine(line.id, 1);
                      }}
                      className="v-btn-knob w-6 h-6 flex items-center justify-center cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete line ${index + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLine(line.id);
                      }}
                      className="v-btn-knob w-6 h-6 flex items-center justify-center hover:text-white cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <input
                  type="text"
                  aria-label={`Lyric text for line ${index + 1}`}
                  value={line.text}
                  placeholder="Enter lyric text..."
                  onChange={(e) => onUpdateLine(line.id, { text: e.target.value })}
                  className="v-inset w-full px-2 py-1.5 text-xs text-[#EEF3F8] placeholder:text-[#8696A8] focus:outline-none focus:border-[#22D3EE]"
                />

                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <label className="text-[#8696A8] flex items-center gap-1">
                      <span>IN</span>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        value={line.start}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const maxStart = Math.max(0, Number((line.end - 0.25).toFixed(2)));
                          const nextStart = Math.min(
                            maxStart,
                            Math.max(0, parseFloat(e.target.value) || 0)
                          );
                          onUpdateLine(line.id, { start: nextStart });
                        }}
                        className="v-inset w-[68px] px-1.5 py-0.5 font-mono-tabular text-[#EEF3F8] focus:outline-none focus:border-[#22D3EE]"
                      />
                    </label>
                    <label className="text-[#8696A8] flex items-center gap-1">
                      <span>OUT</span>
                      <input
                        type="number"
                        step="0.05"
                        min="0.2"
                        value={line.end}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          onUpdateLine(line.id, {
                            end: Math.max(
                              line.start + 0.25,
                              parseFloat(e.target.value) || line.start + 0.5
                            ),
                          })
                        }
                        className="v-inset w-[68px] px-1.5 py-0.5 font-mono-tabular text-[#EEF3F8] focus:outline-none focus:border-[#22D3EE]"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedWordsLineId(wordsExpanded ? null : line.id);
                    }}
                    className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                      wordsExpanded ? 'v-btn-teal' : 'v-btn'
                    }`}
                  >
                    {wordsExpanded ? 'Hide' : `Words (${line.words.length})`}
                  </button>
                </div>

                {wordsExpanded && line.words.length > 0 && (
                  <div
                    className="pt-2 border-t border-[#273545] grid grid-cols-2 gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {line.words.map((w, wIdx) => (
                      <div
                        key={w.id}
                        className={`v-inset flex items-center gap-1 px-1.5 py-1 ${
                          w.uncertain ? 'border-[#F2C230]/75' : ''
                        }`}
                      >
                        <input
                          type="text"
                          aria-label={`Word ${wIdx + 1} in line ${index + 1}`}
                          value={w.text}
                          onChange={(e) => onUpdateWordText(line.id, w.id, e.target.value)}
                          className={`w-full min-w-0 bg-transparent text-[11px] focus:outline-none ${
                            w.uncertain ? 'text-[#F2C230]' : 'text-[#EEF3F8]'
                          }`}
                        />
                        <span className="font-mono-tabular text-[10px] text-[#8696A8] shrink-0">
                          {w.start.toFixed(1)}s
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
