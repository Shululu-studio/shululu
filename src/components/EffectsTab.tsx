import React from 'react';
import { RotateCcw, Wand2 } from 'lucide-react';
import { AUTO_EFFECT_STYLE_OPTIONS, EFFECT_OPTIONS, SECTION_LABELS } from '../data/presets';
import { AutoEffectStyle, EffectType, LyricLine } from '../types/editor';

interface EffectsTabProps {
  autoEffectsEnabled: boolean;
  autoEffectStyle: AutoEffectStyle;
  selectedLine: LyricLine | null;
  onToggleAutoEffects: (enabled: boolean) => void;
  onChangeAutoStyle: (style: AutoEffectStyle) => void;
  onApplyAutoEffectsAll: () => void;
  onOverrideLineEffect: (lineId: string, effect: EffectType) => void;
  onResetLineOverride: (lineId: string) => void;
  onUpdateLine: (id: string, patch: Partial<LyricLine>) => void;
}

export const EffectsTab: React.FC<EffectsTabProps> = ({
  autoEffectsEnabled,
  autoEffectStyle,
  selectedLine,
  onToggleAutoEffects,
  onChangeAutoStyle,
  onApplyAutoEffectsAll,
  onOverrideLineEffect,
  onResetLineOverride,
  onUpdateLine,
}) => {
  return (
    <div className="p-2.5 space-y-2.5 bg-[#121922]">
      {/* 1. Global Auto Effects Switcher */}
      <div className="v-panel p-2.5 space-y-2.5">
        <div className="flex items-center justify-between border-b border-[#273545] pb-1.5">
          <div className="flex items-center gap-2">
            <span className={`v-led ${autoEffectsEnabled ? 'v-led-active' : ''}`} aria-hidden="true" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#EEF3F8]">
              1 · Auto Effects
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoEffectsEnabled}
            aria-label="Enable Auto Effects"
            onClick={() => onToggleAutoEffects(!autoEffectsEnabled)}
            className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer ${
              autoEffectsEnabled ? 'v-btn-teal' : 'v-btn'
            }`}
          >
            {autoEffectsEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#8696A8] text-center sm:text-left">
            Style Profile
          </span>
          <div className="space-y-1.5">
            {AUTO_EFFECT_STYLE_OPTIONS.map((opt) => {
              const active = autoEffectStyle === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeAutoStyle(opt.value)}
                  className={`w-full text-left px-2.5 py-1.5 cursor-pointer ${
                    active ? 'v-btn-teal' : 'v-btn'
                  }`}
                >
                  <div className="text-[11px] font-semibold">{opt.label}</div>
                  <div
                    className={`text-[10px] ${
                      active ? 'text-[#D4D4D8]' : 'text-[#8696A8]'
                    }`}
                  >
                    {opt.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onApplyAutoEffectsAll}
          className="v-btn w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer"
        >
          <Wand2 className="w-3.5 h-3.5 text-[#D4D4D8]" aria-hidden="true" />
          <span>Apply to All Lines</span>
        </button>
      </div>

      {/* 2. Selected Line Override & Transition Timing */}
      <div className="v-panel p-2.5 space-y-2.5">
        <div className="flex items-center justify-between border-b border-[#273545] pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#EEF3F8]">
            2 · Selected Cue Transition & Timing
          </span>
          {selectedLine?.effectOverride && (
            <button
              type="button"
              onClick={() => onResetLineOverride(selectedLine.id)}
              className="v-btn inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer"
            >
              <RotateCcw className="w-2.5 h-2.5 text-[#D4D4D8]" aria-hidden="true" />
              <span>Auto</span>
            </button>
          )}
        </div>

        {!selectedLine ? (
          <p className="text-[11px] text-[#8696A8]">
            Select a lyric cue in the Lyrics panel or Timeline.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="v-inset p-2">
              <div className="text-[10px] font-mono-tabular text-[#22D3EE]">
                {SECTION_LABELS[selectedLine.section]} · {selectedLine.start.toFixed(2)}s –{' '}
                {selectedLine.end.toFixed(2)}s
              </div>
              <div className="text-xs text-[#EEF3F8] truncate mt-0.5">
                {selectedLine.text.trim() || 'Lyric cue'}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#8696A8]">
                Transition Effect
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECT_OPTIONS.map((eff) => {
                  const isSelected = selectedLine.effect === eff.value;
                  return (
                    <button
                      key={eff.value}
                      type="button"
                      onClick={() => onOverrideLineEffect(selectedLine.id, eff.value)}
                      className={`w-full text-left px-2 py-1.5 cursor-pointer ${
                        isSelected ? 'v-btn-teal' : 'v-btn'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-semibold truncate">{eff.label}</span>
                        {isSelected && selectedLine.effectOverride && (
                          <span className="text-[9px] uppercase font-bold text-[#22D3EE] shrink-0">M</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Independent Transition Timing Controls */}
            <div className="space-y-2 pt-1 border-t border-[#273545]">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#8696A8]">
                Transition Timing &amp; Easing
              </span>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-[#8696A8]">
                    <span>Entrance Dur</span>
                    <span className="font-mono-tabular text-[#EEF3F8]">
                      {(selectedLine.entranceDuration ?? 0.35).toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="1.5"
                    step="0.05"
                    value={selectedLine.entranceDuration ?? 0.35}
                    onChange={(e) => onUpdateLine(selectedLine.id, { entranceDuration: parseFloat(e.target.value) })}
                    className="w-full accent-[#22D3EE] cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-[#8696A8]">
                    <span>Exit Dur</span>
                    <span className="font-mono-tabular text-[#EEF3F8]">
                      {(selectedLine.exitDuration ?? 0.4).toFixed(2)}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="1.5"
                    step="0.05"
                    value={selectedLine.exitDuration ?? 0.4}
                    onChange={(e) => onUpdateLine(selectedLine.id, { exitDuration: parseFloat(e.target.value) })}
                    className="w-full accent-[#22D3EE] cursor-pointer"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-[#8696A8]">
                  <span>Delay Before Entrance</span>
                  <span className="font-mono-tabular text-[#EEF3F8]">
                    {(selectedLine.delayBefore ?? 0.0).toFixed(2)}s
                  </span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={selectedLine.delayBefore ?? 0.0}
                  onChange={(e) => onUpdateLine(selectedLine.id, { delayBefore: parseFloat(e.target.value) })}
                  className="w-full accent-[#22D3EE] cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <span className="block text-[10px] text-[#8696A8]">Transition Easing</span>
                <select
                  value={selectedLine.easing ?? 'easeOutCubic'}
                  onChange={(e) => onUpdateLine(selectedLine.id, { easing: e.target.value as any })}
                  className="v-inset w-full px-2 py-1 text-xs text-[#EEF3F8] bg-[#0C1117] focus:outline-none focus:border-[#22D3EE] cursor-pointer"
                >
                  <option value="easeOutCubic">Ease Out Cubic (Smooth)</option>
                  <option value="easeInOutSine">Ease In-Out Sine (Gentle)</option>
                  <option value="linear">Linear (Constant)</option>
                  <option value="elastic">Elastic (Bouncy)</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
