import React, { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, RotateCcw } from 'lucide-react';
import { CURATED_FONTS } from '../data/presets';
import { AlbumStylePreset, TypographyStyle } from '../types/editor';

interface TypographyTabProps {
  typography: TypographyStyle;
  onChange: (patch: Partial<TypographyStyle>) => void;
  onReset: () => void;
  savedAlbumPresets: AlbumStylePreset[];
  onSaveAlbumPreset: (name: string) => void;
  onApplyAlbumPreset: (preset: AlbumStylePreset) => void;
  onDeleteAlbumPreset: (id: string) => void;
}

export const TypographyTab: React.FC<TypographyTabProps> = ({
  typography,
  onChange,
  onReset,
  savedAlbumPresets,
  onSaveAlbumPreset,
  onApplyAlbumPreset,
  onDeleteAlbumPreset,
}) => {
  const categories = ['Gospel & Worship', 'Contemporary', 'Editorial', 'Stage & Bold'] as const;
  const activeFont = CURATED_FONTS.find((f) => f.family === typography.fontFamily);
  const availableWeights = activeFont?.weights ?? [400, 500, 600, 700];
  const [presetInput, setPresetInput] = useState('');
  const [presetsOpen, setPresetsOpen] = useState(false);

  return (
    <div className="p-2.5 space-y-2.5 overflow-y-auto h-full bg-[#121922]">
      {/* Console Header */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#EEF3F8]">
          Typography Controls
        </span>
        <button
          type="button"
          onClick={onReset}
          className="v-btn inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
        >
          <RotateCcw className="w-3 h-3 text-[#D4D4D8]" aria-hidden="true" />
          <span>Reset</span>
        </button>
      </div>

      {/* Section 1: Font & Size */}
      <div className="v-panel p-2.5 space-y-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1 text-center sm:text-left">
          1 · Font &amp; Size
        </div>

        <div className="v-inset px-3 py-2 flex items-center justify-between gap-2">
          <span
            className="text-sm text-[#EEF3F8] truncate"
            style={{
              fontFamily: `"${typography.fontFamily}", sans-serif`,
              fontWeight: typography.fontWeight,
            }}
          >
            {activeFont?.label ?? typography.fontFamily}
          </span>
          <span className="font-mono-tabular text-[11px] text-[#22D3EE] shrink-0">
            {typography.fontSize}px
          </span>
        </div>

        <div className="space-y-1">
          <label htmlFor="font-family-select" className="block text-[11px] text-[#8696A8]">
            Font Family
          </label>
          <select
            id="font-family-select"
            value={typography.fontFamily}
            onChange={(e) => {
              const nextFamily = e.target.value;
              const nextFont = CURATED_FONTS.find((f) => f.family === nextFamily);
              const nextWeight = nextFont?.weights.includes(typography.fontWeight)
                ? typography.fontWeight
                : (nextFont?.weights[0] ?? 600);
              onChange({ fontFamily: nextFamily, fontWeight: nextWeight });
            }}
            className="v-inset w-full px-2 py-1.5 text-xs text-[#EEF3F8] focus:outline-none focus:border-[#22D3EE]"
          >
            {categories.map((cat) => (
              <optgroup key={cat} label={cat}>
                {CURATED_FONTS.filter((f) => f.category === cat).map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="font-size-slider" className="text-[#8696A8]">
                Size
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">{typography.fontSize}px</span>
            </div>
            <input
              id="font-size-slider"
              type="range"
              min={28}
              max={120}
              value={typography.fontSize}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="font-weight-select" className="block text-[11px] text-[#8696A8]">
              Weight
            </label>
            <select
              id="font-weight-select"
              value={typography.fontWeight}
              onChange={(e) => onChange({ fontWeight: Number(e.target.value) })}
              className="v-inset w-full px-2 py-1 text-xs text-[#EEF3F8] focus:outline-none focus:border-[#22D3EE]"
            >
              {availableWeights.map((w) => (
                <option key={w} value={w}>
                  {w === 400
                    ? 'Regular (400)'
                    : w === 500
                      ? 'Medium (500)'
                      : w === 600
                        ? 'SemiBold (600)'
                        : w === 700
                          ? 'Bold (700)'
                          : 'ExtraBold (800)'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Section 2: Alignment & Colour */}
      <div className="v-panel p-2.5 space-y-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1 text-center sm:text-left">
          2 · Alignment &amp; Colour
        </div>

        <div className="space-y-1">
          <span className="block text-[11px] text-[#8696A8]">Text Alignment</span>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { val: 'left', icon: AlignLeft, label: 'Align left' },
                { val: 'center', icon: AlignCenter, label: 'Align center' },
                { val: 'right', icon: AlignRight, label: 'Align right' },
              ] as const
            ).map(({ val, icon: Icon, label }) => (
              <button
                key={val}
                type="button"
                aria-label={label}
                onClick={() => onChange({ align: val })}
                className={`py-1.5 flex items-center justify-center cursor-pointer ${
                  typography.align === val ? 'v-btn-teal' : 'v-btn'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <label htmlFor="text-color-input" className="block text-[11px] text-[#8696A8]">
              Text Colour
            </label>
            <div className="v-inset flex items-center gap-1.5 px-2 py-1">
              <input
                id="text-color-input"
                type="color"
                value={typography.color}
                onChange={(e) => onChange({ color: e.target.value })}
                className="w-5 h-5 bg-transparent border-0 cursor-pointer p-0"
              />
              <span className="font-mono-tabular text-[11px] text-[#EEF3F8] uppercase">
                {typography.color}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="highlight-color-input" className="block text-[11px] text-[#8696A8]">
              Highlight Fill
            </label>
            <div className="v-inset flex items-center gap-1.5 px-2 py-1">
              <input
                id="highlight-color-input"
                type="color"
                value={typography.highlightColor}
                onChange={(e) => onChange({ highlightColor: e.target.value })}
                className="w-5 h-5 bg-transparent border-0 cursor-pointer p-0"
              />
              <span className="font-mono-tabular text-[11px] text-[#EEF3F8] uppercase">
                {typography.highlightColor}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Position & Spacing */}
      <div className="v-panel p-2.5 space-y-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1 text-center sm:text-left">
          3 · Position &amp; Spacing
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="pos-y-slider" className="text-[#8696A8]">
                Vertical Pos
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {Math.round(typography.positionY * 100)}%
              </span>
            </div>
            <input
              id="pos-y-slider"
              type="range"
              min={0.15}
              max={0.88}
              step={0.01}
              value={typography.positionY}
              onChange={(e) => onChange({ positionY: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="pos-x-slider" className="text-[#8696A8]">
                Horizontal Pos
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {Math.round(typography.positionX * 100)}%
              </span>
            </div>
            <input
              id="pos-x-slider"
              type="range"
              min={0.15}
              max={0.85}
              step={0.01}
              value={typography.positionX}
              onChange={(e) => onChange({ positionX: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="line-spacing-slider" className="text-[#8696A8]">
                Line Spacing
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {typography.lineSpacing.toFixed(2)}
              </span>
            </div>
            <input
              id="line-spacing-slider"
              type="range"
              min={1.0}
              max={2.0}
              step={0.05}
              value={typography.lineSpacing}
              onChange={(e) => onChange({ lineSpacing: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="letter-spacing-slider" className="text-[#8696A8]">
                Tracking
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {typography.letterSpacing.toFixed(1)}px
              </span>
            </div>
            <input
              id="letter-spacing-slider"
              type="range"
              min={-2}
              max={12}
              step={0.5}
              value={typography.letterSpacing}
              onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </div>
      </div>

      {/* Section 4: Shadow, Outline & Backing */}
      <div className="v-panel p-2.5 space-y-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1 text-center sm:text-left">
          4 · Shadow &amp; Outline
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="shadow-blur-slider" className="text-[#8696A8]">
                Shadow
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">{typography.shadowBlur}px</span>
            </div>
            <input
              id="shadow-blur-slider"
              type="range"
              min={0}
              max={40}
              value={typography.shadowBlur}
              onChange={(e) => onChange({ shadowBlur: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="text-opacity-slider" className="text-[#8696A8]">
                Opacity
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {Math.round(typography.opacity * 100)}%
              </span>
            </div>
            <input
              id="text-opacity-slider"
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={typography.opacity}
              onChange={(e) => onChange({ opacity: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 items-end">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="outline-width-slider" className="text-[#8696A8]">
                Outline
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {typography.outlineWidth}px
              </span>
            </div>
            <input
              id="outline-width-slider"
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={typography.outlineWidth}
              onChange={(e) => onChange({ outlineWidth: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="outline-color-input" className="block text-[11px] text-[#8696A8]">
              Outline Colour
            </label>
            <div className="v-inset flex items-center gap-1.5 px-2 py-1">
              <input
                id="outline-color-input"
                type="color"
                value={typography.outlineColor}
                onChange={(e) => onChange({ outlineColor: e.target.value })}
                className="w-5 h-5 bg-transparent border-0 cursor-pointer p-0"
              />
              <span className="font-mono-tabular text-[11px] text-[#EEF3F8] uppercase">
                {typography.outlineColor}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 items-end">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="bg-opacity-slider" className="text-[#8696A8]">
                Text Box
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {Math.round(typography.backgroundOpacity * 100)}%
              </span>
            </div>
            <input
              id="bg-opacity-slider"
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={typography.backgroundOpacity}
              onChange={(e) => onChange({ backgroundOpacity: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="bg-box-color-input" className="block text-[11px] text-[#8696A8]">
              Box Colour
            </label>
            <div className="v-inset flex items-center gap-1.5 px-2 py-1">
              <input
                id="bg-box-color-input"
                type="color"
                value={typography.backgroundColor}
                onChange={(e) => onChange({ backgroundColor: e.target.value })}
                className="w-5 h-5 bg-transparent border-0 cursor-pointer p-0"
              />
              <span className="font-mono-tabular text-[11px] text-[#EEF3F8] uppercase">
                {typography.backgroundColor}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 5: Album Style Presets */}
      <div className="v-panel p-2.5 space-y-2">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1">
          <span>5 · Album Style Presets</span>
          <button
            type="button"
            onClick={() => setPresetsOpen(!presetsOpen)}
            className="v-btn px-2 py-0.5 text-[10px] text-[#E4E4E7] cursor-pointer"
          >
            {presetsOpen ? 'Hide' : `Manage (${savedAlbumPresets.length})`}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            placeholder="Album Track Preset Name..."
            value={presetInput}
            onChange={(e) => setPresetInput(e.target.value)}
            className="v-inset flex-1 px-2 py-1 text-xs text-[#EEF3F8] placeholder-[#8696A8] focus:outline-none focus:border-[#22D3EE]"
          />
          <button
            type="button"
            onClick={() => {
              if (presetInput.trim()) {
                onSaveAlbumPreset(presetInput.trim());
                setPresetInput('');
                setPresetsOpen(true);
              }
            }}
            className="v-btn-teal px-2.5 py-1 text-[10px] uppercase tracking-wider whitespace-nowrap cursor-pointer"
          >
            Save Style
          </button>
        </div>

        {presetsOpen && (
          <div className="space-y-1.5 pt-1 border-t border-[#273545] max-h-40 overflow-y-auto">
            {savedAlbumPresets.length === 0 ? (
              <p className="text-[10px] text-[#8696A8] italic py-1">
                No saved album presets yet. Save your style to apply across album tracks.
              </p>
            ) : (
              savedAlbumPresets.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-1.5 bg-[#19232E] px-2 py-1 rounded-[3px] border border-[#273545]"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#EEF3F8] truncate">{p.name}</p>
                    <p className="text-[9px] text-[#8696A8]">
                      {p.typography.fontFamily} · {p.autoEffectStyle}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onApplyAlbumPreset(p)}
                      title="Apply preset to current track"
                      className="v-btn px-2 py-0.5 text-[10px] font-semibold cursor-pointer"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteAlbumPreset(p.id)}
                      title="Delete preset"
                      className="v-btn px-1.5 py-0.5 text-[10px] cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
