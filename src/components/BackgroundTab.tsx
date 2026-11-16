import React, { useRef } from 'react';
import { Image as ImageIcon, Upload, Video } from 'lucide-react';
import { BACKGROUND_TEMPLATES, GRADIENT_PRESETS } from '../data/presets';
import { AspectRatio, BackgroundConfig } from '../types/editor';

interface BackgroundTabProps {
  aspectRatio: AspectRatio;
  background: BackgroundConfig;
  onChangeAspectRatio: (ratio: AspectRatio) => void;
  onChangeBackground: (patch: Partial<BackgroundConfig>) => void;
  onUploadBackgroundMedia: (file: File) => void;
}

export const BackgroundTab: React.FC<BackgroundTabProps> = ({
  aspectRatio,
  background,
  onChangeAspectRatio,
  onChangeBackground,
  onUploadBackgroundMedia,
}) => {
  const mediaInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="p-2.5 space-y-2.5 overflow-y-auto h-full bg-[#121922]">
      {/* 1. Output Aspect Ratio */}
      <div className="v-panel p-2.5 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1 text-center sm:text-left">
          1 · Output Aspect Ratio
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              { value: '16:9', label: '16:9', sub: 'Widescreen' },
              { value: '9:16', label: '9:16', sub: 'Vertical' },
              { value: '1:1', label: '1:1', sub: 'Square' },
            ] as const
          ).map((item) => {
            const active = aspectRatio === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onChangeAspectRatio(item.value)}
                className={`py-1.5 px-2 text-center cursor-pointer ${
                  active ? 'v-btn-teal' : 'v-btn'
                }`}
              >
                <div className="font-mono-tabular text-xs font-bold">{item.label}</div>
                <div className="text-[10px] opacity-80">{item.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Background Source */}
      <div className="v-panel p-2.5 space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1 text-center sm:text-left">
          2 · Background Source
        </div>
        <div className="grid grid-cols-4 gap-1">
          {(
            [
              { id: 'template', label: 'Scenes' },
              { id: 'gradient', label: 'Grad' },
              { id: 'solid', label: 'Solid' },
              { id: 'media', label: 'Media' },
            ] as const
          ).map((mode) => {
            const active =
              mode.id === 'media'
                ? background.type === 'image' || background.type === 'video'
                : background.type === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  if (mode.id === 'media') {
                    mediaInputRef.current?.click();
                  } else {
                    onChangeBackground({ type: mode.id });
                  }
                }}
                className={`py-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer ${
                  active ? 'v-btn-teal' : 'v-btn'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadBackgroundMedia(file);
            e.target.value = '';
          }}
        />

        {background.type === 'template' && (
          <div className="space-y-2.5 pt-1">
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#22D3EE] px-0.5 text-center sm:text-left">
                Gospel Nature &amp; Worship Scenes
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {BACKGROUND_TEMPLATES.filter((t) => t.category === 'gospel-nature').map((tpl) => {
                  const active = background.templateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      title={tpl.subtitle}
                      onClick={() =>
                        onChangeBackground({
                          type: 'template',
                          templateId: tpl.id,
                          dimOverlay: tpl.recommendedDim,
                          blur: 0,
                        })
                      }
                      className={`text-left rounded-[3px] overflow-hidden border transition-colors cursor-pointer ${
                        active ? 'border-[#67E8F9]' : 'border-[#273545] hover:border-[#3A4E63]'
                      }`}
                    >
                      <div className="aspect-video bg-[#0C1117] overflow-hidden">
                        <img
                          src={tpl.imageUrl}
                          alt={tpl.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="px-1.5 py-1 bg-[#0C1117]">
                        <div
                          className={`text-[10px] font-medium truncate ${
                            active ? 'text-[#22D3EE]' : 'text-[#EEF3F8]'
                          }`}
                        >
                          {tpl.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] px-0.5 text-center sm:text-left">
                Stage &amp; Studio
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {BACKGROUND_TEMPLATES.filter((t) => t.category === 'stage').map((tpl) => {
                  const active = background.templateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      title={tpl.subtitle}
                      onClick={() =>
                        onChangeBackground({
                          type: 'template',
                          templateId: tpl.id,
                          dimOverlay: tpl.recommendedDim,
                          blur: 0,
                        })
                      }
                      className={`text-left rounded-[3px] overflow-hidden border transition-colors cursor-pointer ${
                        active ? 'border-[#67E8F9]' : 'border-[#273545] hover:border-[#3A4E63]'
                      }`}
                    >
                      <div className="aspect-video bg-[#0C1117] overflow-hidden">
                        <img
                          src={tpl.imageUrl}
                          alt={tpl.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="px-1.5 py-1 bg-[#0C1117]">
                        <div
                          className={`text-[10px] font-medium truncate ${
                            active ? 'text-[#22D3EE]' : 'text-[#EEF3F8]'
                          }`}
                        >
                          {tpl.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {background.type === 'gradient' && (
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-3 gap-1.5">
              {GRADIENT_PRESETS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    onChangeBackground({
                      type: 'gradient',
                      gradientFrom: g.from,
                      gradientTo: g.to,
                      gradientAngle: g.angle,
                    })
                  }
                  className="rounded-[3px] overflow-hidden border border-[#273545] hover:border-[#67E8F9] transition-colors cursor-pointer"
                >
                  <div
                    className="h-8 w-full"
                    style={{
                      background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`,
                    }}
                  />
                  <div className="px-1.5 py-0.5 bg-[#0C1117] text-[10px] text-[#EEF3F8] truncate">
                    {g.name}
                  </div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-[11px] text-[#8696A8]">
                <span>Start</span>
                <div className="v-inset flex items-center gap-1.5 px-2 py-1">
                  <input
                    type="color"
                    value={background.gradientFrom}
                    onChange={(e) => onChangeBackground({ gradientFrom: e.target.value })}
                    className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer"
                  />
                  <span className="font-mono-tabular text-[11px] text-[#EEF3F8]">
                    {background.gradientFrom}
                  </span>
                </div>
              </label>

              <label className="space-y-1 text-[11px] text-[#8696A8]">
                <span>End</span>
                <div className="v-inset flex items-center gap-1.5 px-2 py-1">
                  <input
                    type="color"
                    value={background.gradientTo}
                    onChange={(e) => onChangeBackground({ gradientTo: e.target.value })}
                    className="w-5 h-5 bg-transparent border-0 p-0 cursor-pointer"
                  />
                  <span className="font-mono-tabular text-[11px] text-[#EEF3F8]">
                    {background.gradientTo}
                  </span>
                </div>
              </label>
            </div>
          </div>
        )}

        {background.type === 'solid' && (
          <div className="pt-1">
            <div className="v-inset flex items-center gap-2 px-2.5 py-1.5">
              <input
                type="color"
                aria-label="Solid background colour"
                value={background.solidColor}
                onChange={(e) => onChangeBackground({ solidColor: e.target.value })}
                className="w-6 h-6 bg-transparent border-0 p-0 cursor-pointer"
              />
              <span className="font-mono-tabular text-xs text-[#EEF3F8]">
                {background.solidColor.toUpperCase()}
              </span>
            </div>
          </div>
        )}

        {(background.type === 'image' || background.type === 'video') && (
          <div className="v-inset p-2 space-y-2">
            <div className="flex items-center gap-2 text-xs text-[#EEF3F8]">
              {background.type === 'video' ? (
                <Video className="w-4 h-4 text-[#D4D4D8] shrink-0" />
              ) : (
                <ImageIcon className="w-4 h-4 text-[#D4D4D8] shrink-0" />
              )}
              <span className="truncate">{background.mediaName || 'Uploaded media'}</span>
            </div>
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              className="v-btn w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-[#D4D4D8]" aria-hidden="true" />
              <span>Replace Media</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Framing & Scrim */}
      <div className="v-panel p-2.5 space-y-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] border-b border-[#273545] pb-1 text-center sm:text-left">
          3 · Framing &amp; Readability
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <label htmlFor="bg-scale-slider" className="text-[#8696A8]">
              Scale
            </label>
            <span className="font-mono-tabular text-[#EEF3F8]">
              {Math.round(background.scale * 100)}%
            </span>
          </div>
          <input
            id="bg-scale-slider"
            type="range"
            min={1}
            max={2.2}
            step={0.05}
            value={background.scale}
            onChange={(e) => onChangeBackground({ scale: Number(e.target.value) })}
            className="w-full studio-slider"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="bg-offset-x" className="text-[#8696A8]">
                Crop X
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {Math.round(background.offsetX * 100)}%
              </span>
            </div>
            <input
              id="bg-offset-x"
              type="range"
              min={-0.35}
              max={0.35}
              step={0.02}
              value={background.offsetX}
              onChange={(e) => onChangeBackground({ offsetX: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="bg-offset-y" className="text-[#8696A8]">
                Crop Y
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {Math.round(background.offsetY * 100)}%
              </span>
            </div>
            <input
              id="bg-offset-y"
              type="range"
              min={-0.35}
              max={0.35}
              step={0.02}
              value={background.offsetY}
              onChange={(e) => onChangeBackground({ offsetY: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="bg-dim-slider" className="text-[#8696A8]">
                Dim Scrim
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">
                {Math.round(background.dimOverlay * 100)}%
              </span>
            </div>
            <input
              id="bg-dim-slider"
              type="range"
              min={0}
              max={0.85}
              step={0.02}
              value={background.dimOverlay}
              onChange={(e) => onChangeBackground({ dimOverlay: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <label htmlFor="bg-blur-slider" className="text-[#8696A8]">
                Blur
              </label>
              <span className="font-mono-tabular text-[#EEF3F8]">{background.blur}px</span>
            </div>
            <input
              id="bg-blur-slider"
              type="range"
              min={0}
              max={20}
              step={1}
              value={background.blur}
              onChange={(e) => onChangeBackground({ blur: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
