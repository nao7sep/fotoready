import { useI18n } from "@renderer/i18n/I18nContext";
import { SegmentedRadioGroup } from "@renderer/components/SegmentedRadioGroup";
import type { OpRenderer } from "./op-renderer";

type AutoToneParams = { shadowClip: number; highlightClip: number };

// Clip amounts are percentages of the pixels (0.25 means 0.25%).
const autoTonePresets = [
  { id: "0", shadowClip: 0, highlightClip: 0 },
  { id: "0.1", shadowClip: 0.1, highlightClip: 0.1 },
  { id: "0.25", shadowClip: 0.25, highlightClip: 0.25 },
  { id: "0.5", shadowClip: 0.5, highlightClip: 0.5 },
  { id: "1", shadowClip: 1, highlightClip: 1 },
  { id: "2", shadowClip: 2, highlightClip: 2 }
] as const;

export const autoToneRenderer: OpRenderer<AutoToneParams> = {
  type: "auto-tone",
  Card({ params, disabled, onParamsChange }) {
    const { t, percent } = useI18n();
    const formatClip = (value: number): string => percent(value / 100, 2);
    return (
      <div className="geometry-controls">
        <label className="slider-row">
          <span>{t("autoTone.clipShadows")}</span>
          <input
            disabled={disabled}
            max={10}
            min={0}
            step={0.05}
            type="range"
            value={params.shadowClip}
            onChange={(e) => onParamsChange({ shadowClip: e.currentTarget.valueAsNumber })}
          />
          <span className="slider-value">{formatClip(params.shadowClip)}</span>
        </label>
        <label className="slider-row">
          <span>{t("autoTone.clipHighlights")}</span>
          <input
            disabled={disabled}
            max={10}
            min={0}
            step={0.05}
            type="range"
            value={params.highlightClip}
            onChange={(e) => onParamsChange({ highlightClip: e.currentTarget.valueAsNumber })}
          />
          <span className="slider-value">{formatClip(params.highlightClip)}</span>
        </label>
        <SegmentedRadioGroup
          className="geometry-chip-group"
          optionClassName="toolbar-button compact-text"
          ariaLabel={t("autoTone.presets")}
          options={autoTonePresets.map((preset) => ({ id: preset.id, label: formatClip(preset.shadowClip) }))}
          value={
            autoTonePresets.find(
              (preset) =>
                params.shadowClip === preset.shadowClip &&
                params.highlightClip === preset.highlightClip,
            )?.id ?? null
          }
          onChange={(id) => {
            const preset = autoTonePresets.find((p) => p.id === id);
            if (preset) onParamsChange({ shadowClip: preset.shadowClip, highlightClip: preset.highlightClip });
          }}
          disabled={disabled}
        />
      </div>
    );
  }
};

