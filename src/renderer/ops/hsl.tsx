import { useI18n } from "@renderer/i18n/I18nContext";
import type { OpRenderer } from "./op-renderer";
import type { MessageKey } from "@shared/i18n/catalogues";
import { ANGLE_LIMITS, HSL_AMOUNT_LIMITS, HSL_RANGES, type HslRange } from "@shared/op-limits";

type HslAdjustment = { hue: number; sat: number; lum: number };
type HslBand = "all" | HslRange;
type HslParams = Record<HslBand, HslAdjustment>;

const BAND_LOOKS: Readonly<Record<HslBand, { label: MessageKey; color: string; subtitle?: MessageKey }>> = {
  all: { label: "hsl.range.all", color: "#94a3b8", subtitle: "hsl.global" },
  red: { label: "hsl.range.red", color: "#ef4444" },
  orange: { label: "hsl.range.orange", color: "#f97316" },
  yellow: { label: "hsl.range.yellow", color: "#eab308" },
  green: { label: "hsl.range.green", color: "#22c55e" },
  aqua: { label: "hsl.range.aqua", color: "#06b6d4" },
  blue: { label: "hsl.range.blue", color: "#3b82f6" },
  purple: { label: "hsl.range.purple", color: "#8b5cf6" },
  magenta: { label: "hsl.range.magenta", color: "#d946ef" }
};
const HSL_BANDS = (["all", ...HSL_RANGES] as const).map((id) => ({ id, ...BAND_LOOKS[id] }));

export const hslRenderer: OpRenderer<HslParams> = {
  Card({ params, disabled, onParamsChange }) {
    const { t, percent } = useI18n();
    const signedPercent = (value: number): string => `${value > 0 ? "+" : ""}${percent(value / 100)}`;
    function setAdjustment(range: HslBand, patch: Partial<HslAdjustment>): void {
      const current = params[range] ?? { hue: 0, sat: 0, lum: 0 };
      onParamsChange({ [range]: { ...current, ...patch } } as Partial<HslParams>);
    }
    return (
      <div className="hsl-panel">
        <div className="hsl-grid">
        {HSL_BANDS.map((range) => {
          const adjustment = params[range.id] ?? { hue: 0, sat: 0, lum: 0 };
          return (
            <section className={`hsl-band ${range.id === "all" ? "all-colors" : ""}`} key={range.id}>
              <div className="hsl-band-header">
                <span className="hsl-band-swatch" style={{ backgroundColor: range.color }} />
                <div className="hsl-band-heading">
                  <strong>{t(range.label)}</strong>
                  <span>{t(range.subtitle ?? "hsl.hueBand")}</span>
                </div>
              </div>
              <div className="hsl-band-sliders">
                <label className="slider-row">
                  <span>{t("hsl.hue")}</span>
                  <input
                    disabled={disabled}
                    max={ANGLE_LIMITS.max}
                    min={ANGLE_LIMITS.min}
                    step={1}
                    type="range"
                    value={adjustment.hue}
                    onChange={(e) => setAdjustment(range.id, { hue: e.currentTarget.valueAsNumber })}
                  />
                  <span className="slider-value">{formatSigned(adjustment.hue, "\u00b0")}</span>
                </label>
                <label className="slider-row">
                  <span>{t("hsl.saturation")}</span>
                  <input
                    disabled={disabled}
                    max={HSL_AMOUNT_LIMITS.max * 100}
                    min={HSL_AMOUNT_LIMITS.min * 100}
                    step={1}
                    type="range"
                    value={Math.round(adjustment.sat * 100)}
                    onChange={(e) => setAdjustment(range.id, { sat: e.currentTarget.valueAsNumber / 100 })}
                  />
                  <span className="slider-value">{signedPercent(Math.round(adjustment.sat * 100))}</span>
                </label>
                <label className="slider-row">
                  <span>{t("hsl.lightness")}</span>
                  <input
                    disabled={disabled}
                    max={HSL_AMOUNT_LIMITS.max * 100}
                    min={HSL_AMOUNT_LIMITS.min * 100}
                    step={1}
                    type="range"
                    value={Math.round(adjustment.lum * 100)}
                    onChange={(e) => setAdjustment(range.id, { lum: e.currentTarget.valueAsNumber / 100 })}
                  />
                  <span className="slider-value">{signedPercent(Math.round(adjustment.lum * 100))}</span>
                </label>
              </div>
            </section>
          );
        })}
        </div>
      </div>
    );
  }
};

function formatSigned(value: number, suffix: string): string {
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}
