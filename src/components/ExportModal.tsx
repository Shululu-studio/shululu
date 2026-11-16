import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Film,
  Info,
  Loader2,
  X,
} from 'lucide-react';
import { ProjectData } from '../types/editor';
import { getResolutionForAspect, MediaAssetCache } from '../utils/lyricRenderer';
import {
  checkExportCapabilities,
  ExportCapabilities,
  ExportProgress,
  ExportResult,
  exportLyricsVideo,
} from '../utils/videoExporter';

interface ExportModalProps {
  isOpen: boolean;
  project: ProjectData;
  audioBuffer: AudioBuffer | null;
  mediaCache: MediaAssetCache;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  project,
  audioBuffer,
  mediaCache,
  onClose,
}) => {
  const [resolution, setResolution] = useState<720 | 1080>(720);
  const [fps, setFps] = useState<24 | 30 | 60>(30);
  const [caps, setCaps] = useState<ExportCapabilities | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setResult(null);
    setErrorMsg(null);
    setProgress(null);
    checkExportCapabilities()
      .then((c) => {
        if (active) setCaps(c);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  if (!isOpen) return null;

  const { width, height } = getResolutionForAspect(project.aspectRatio, resolution);

  const handleStartExport = async () => {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    setResult(null);
    setErrorMsg(null);
    setIsExporting(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await exportLyricsVideo({
        project,
        audioBuffer,
        resolution,
        fps,
        mediaCache,
        signal: controller.signal,
        onProgress: setProgress,
      });
      const url = URL.createObjectURL(res.blob);
      setDownloadUrl(url);
      setResult(res);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setErrorMsg('Export cancelled.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Video export failed.');
      }
    } finally {
      setIsExporting(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C1117]/80 p-4"
    >
      <div className="w-full max-w-lg bg-[#121922] border border-[#273545] rounded-[4px] shadow-[0_16px_48px_rgba(0,0,0,0.7)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#273545] bg-[#19232E] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-[#F87171]" aria-hidden="true" />
            <h2 id="export-modal-title" className="text-xs font-semibold uppercase tracking-wider text-[#EEF3F8]">
              Export Lyrics Video
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close export dialog"
            disabled={isExporting}
            onClick={onClose}
            className="v-btn p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-3.5 bg-[#121922]">
          {/* Resolution & FPS */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="export-res" className="block text-[11px] text-[#8696A8]">
                Resolution
              </label>
              <select
                id="export-res"
                disabled={isExporting}
                value={resolution}
                onChange={(e) => setResolution(Number(e.target.value) as 720 | 1080)}
                className="v-inset w-full px-2.5 py-1.5 text-xs text-[#EEF3F8] focus:outline-none focus:border-[#EF4444]"
              >
                <option value={720}>720p HD</option>
                <option value={1080}>1080p Full HD</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="export-fps" className="block text-[11px] text-[#8696A8]">
                Frame Rate
              </label>
              <select
                id="export-fps"
                disabled={isExporting}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value) as 24 | 30 | 60)}
                className="v-inset w-full px-2.5 py-1.5 text-xs text-[#EEF3F8] focus:outline-none focus:border-[#EF4444]"
              >
                <option value={24}>24 fps (Cinema)</option>
                <option value={30}>30 fps (Standard)</option>
                <option value={60}>60 fps (Smooth)</option>
              </select>
            </div>
          </div>

          {/* Output Summary */}
          <div className="v-panel p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[#8696A8]">Dimensions</span>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {width} × {height} ({project.aspectRatio})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8696A8]">Duration</span>
              <span className="font-mono-tabular text-[#F87171]">
                {project.duration.toFixed(1)}s · {audioBuffer ? 'With Audio' : 'Video Only'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8696A8]">Format</span>
              <span className="text-[#EEF3F8]">
                {caps?.recommendedMode === 'webcodecs-mp4'
                  ? `MP4 (H.264 + ${caps.webCodecsAudioCodec === 'opus' ? 'Opus' : 'AAC'})`
                  : caps?.mediaRecorderExtension
                    ? `${caps.mediaRecorderExtension.toUpperCase()} (${caps.mediaRecorderMimeType})`
                    : 'Checking...'}
              </span>
            </div>
          </div>

          {caps && caps.recommendedMode !== 'webcodecs-mp4' && (
            <div className="v-inset p-2.5 text-xs text-[#EEF3F8] flex items-start gap-2">
              <Info className="w-4 h-4 text-[#8696A8] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <div className="font-medium text-[#EEF3F8]">Browser Encoder</div>
                <p className="text-[11px] text-[#8696A8] mt-0.5">
                  {caps.webCodecsReason}{' '}
                  {caps.mediaRecorderExtension
                    ? `Export renders as ${caps.mediaRecorderMimeType}.`
                    : 'No compatible browser video encoder detected.'}
                </p>
              </div>
            </div>
          )}

          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#EEF3F8] truncate pr-2">{progress.statusText}</span>
                <span className="font-mono-tabular text-[#F87171] shrink-0">
                  {progress.percent}%
                  {progress.etaSeconds !== null && progress.etaSeconds > 0
                    ? ` · ~${progress.etaSeconds}s left`
                    : ''}
                </span>
              </div>
              <div className="v-inset h-2 overflow-hidden">
                <div
                  className="h-full bg-[#EF4444] transition-all duration-150"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-[3px] bg-[#E05252]/15 border border-[#E05252] text-xs text-[#E05252]">
              {errorMsg}
            </div>
          )}

          {result && downloadUrl && (
            <div className="v-panel p-3 border-[#EF4444]/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-[#2EC46E] shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#EEF3F8] truncate">
                    {result.filename}
                  </div>
                  <div className="text-[11px] text-[#8696A8]">
                    {(result.blob.size / (1024 * 1024)).toFixed(2)} MB · {result.encoderUsed}
                  </div>
                </div>
              </div>
              <a
                href={downloadUrl}
                download={result.filename}
                className="v-btn-cobalt inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Download</span>
              </a>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#273545] bg-[#19232E] flex items-center justify-end gap-2">
          {isExporting ? (
            <button
              type="button"
              onClick={handleCancel}
              className="v-btn px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#E05252] whitespace-nowrap cursor-pointer"
            >
              Cancel Export
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="v-btn px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                disabled={caps?.recommendedMode === 'unsupported'}
                onClick={handleStartExport}
                className="v-btn-cobalt inline-flex items-center gap-1.5 px-4 py-1.5 text-[11px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
              >
                {isExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{result ? 'Render Again' : 'Export Video'}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
