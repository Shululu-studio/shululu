import React from 'react';
import { X } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'Space', action: 'Play or pause video preview' },
  { key: 'Left / Right', action: 'Nudge playhead backward or forward 1 second' },
  { key: 'Shift + Arrows', action: 'Nudge playhead backward or forward 5 seconds' },
  { key: 'Ctrl / Cmd + S', action: 'Save project to local storage' },
  { key: 'Drag Monitor Text', action: 'Reposition lyric placement directly' },
  { key: 'Drag Cue Segment', action: 'Move or trim start/end timestamps' },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C1117]/80 p-4"
    >
      <div className="w-full max-w-md bg-[#121922] border border-[#273545] rounded-[4px] shadow-[0_16px_48px_rgba(0,0,0,0.7)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#273545] bg-[#19232E] flex items-center justify-between">
          <h2 id="shortcuts-modal-title" className="text-xs font-semibold uppercase tracking-wider text-[#EEF3F8]">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close shortcuts dialog"
            onClick={onClose}
            className="v-btn p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="divide-y divide-[#273545] bg-[#0C1117]">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs">
              <span className="text-[#EEF3F8]">{s.action}</span>
              <kbd className="v-inset px-2 py-0.5 font-mono-tabular text-[11px] text-[#F87171] whitespace-nowrap">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
