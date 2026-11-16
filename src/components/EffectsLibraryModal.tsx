import React from 'react';
import {
  Check,
  CloudDownload,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  CachedLibraryPack,
  LibraryPackData,
  LibraryPackManifestItem,
} from '../types/editor';

interface EffectsLibraryModalProps {
  isOpen: boolean;
  isOnline: boolean;
  isChecking: boolean;
  manifest: LibraryPackManifestItem[];
  cachedPacks: CachedLibraryPack[];
  lastError: string | null;
  onClose: () => void;
  onRefreshManifest: () => void;
  onDownloadPack: (packId: string) => void;
  onApplyPreset: (preset: LibraryPackData['presets'][number]) => void;
}

export const EffectsLibraryModal: React.FC<EffectsLibraryModalProps> = ({
  isOpen,
  isOnline,
  isChecking,
  manifest,
  cachedPacks,
  lastError,
  onClose,
  onRefreshManifest,
  onDownloadPack,
  onApplyPreset,
}) => {
  if (!isOpen) return null;

  const cachedById = new Map(cachedPacks.map((c) => [c.id, c]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-3xl bg-[#181A1F] border border-[#2D323B] rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-3.5 border-b border-[#262A32] flex items-center justify-between gap-4">
          <div>
            <h2 id="library-modal-title" className="text-sm font-semibold text-[#F2F3F5]">
              Effects & Preset Library
            </h2>
            <p className="text-xs text-[#9BA1AB]">
              Download animation, typography, and backdrop packs for offline studio reuse.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-[#9BA1AB]">
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-[#16A34A]" aria-hidden="true" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-[#9BA1AB]" aria-hidden="true" />
                  <span>Offline Mode</span>
                </>
              )}
            </span>
            <button
              type="button"
              onClick={onRefreshManifest}
              disabled={!isOnline || isChecking}
              className="v-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Check Updates</span>
            </button>
            <button
              type="button"
              aria-label="Close library dialog"
              onClick={onClose}
              className="v-btn p-1.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {lastError && (
          <div className="px-5 py-2 bg-[#1B1E24] border-b border-[#2D323B] text-xs text-[#D1D5DB]">
            {lastError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {manifest.length === 0 && cachedPacks.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#9BA1AB]">
              No online packs loaded yet. Connect to the internet and click Check Updates to browse packs.
            </div>
          ) : (
            (manifest.length > 0
              ? manifest
              : cachedPacks.map((c) => ({
                  id: c.id,
                  title: c.data.title,
                  category: c.data.category,
                  version: c.version,
                  description: 'Cached locally for offline editing.',
                  itemCount: c.data.presets.length,
                  updatedAt: new Date(c.downloadedAt).toLocaleDateString(),
                  sizeLabel: 'Cached',
                }))
            ).map((item) => {
              const cached = cachedById.get(item.id);
              const hasUpdate = cached && cached.version !== item.version;

              return (
                <div
                  key={item.id}
                  className="border border-[#282D37] rounded bg-[#14161A] p-3.5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-[#F2F3F5]">
                          {item.title}
                        </h3>
                        <span className="font-mono-tabular text-[11px] text-[#9BA1AB]">
                          v{item.version} · {item.itemCount} presets
                        </span>
                      </div>
                      <p className="text-xs text-[#9BA1AB] mt-0.5">{item.description}</p>
                    </div>

                    <div className="shrink-0">
                      {!cached || hasUpdate ? (
                        <button
                          type="button"
                          disabled={!isOnline}
                          onClick={() => onDownloadPack(item.id)}
                          className="v-btn-cobalt inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs whitespace-nowrap cursor-pointer"
                        >
                          <CloudDownload className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{hasUpdate ? 'Update Pack' : 'Download Offline'}</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-[#16A34A] font-medium">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Cached Offline</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {cached && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-[#22262E]">
                      {cached.data.presets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            onApplyPreset(preset);
                            onClose();
                          }}
                          className="v-btn text-left p-2.5 cursor-pointer"
                        >
                          <div className="text-xs font-medium text-[#F2F3F5]">
                            {preset.name}
                          </div>
                          <div className="text-[11px] text-[#9BA1AB] mt-0.5">
                            {preset.subtitle}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
