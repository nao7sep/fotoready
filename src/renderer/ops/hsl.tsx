import { useI18n } from "@renderer/i18n/I18nContext";
import type { OpRenderer } from "./op-renderer";
import type { MessageKey } from "@shared/i18n/catalogues";

type HslAdjustment = { hue: number; sat: number; lum: number };
const HSL_RANGES = [
  { id: "all", label: "hsl.range.all", color: "#94a3b8", subtitle: "hsl.global" },
  { id: "red", label: "hsl.range.red", color: "#ef4444", subtitle: undefined },
  { id: "orange", label: "hsl.range.orange", color: "#f97316", subtitle: undefined },
  { id: "yellow", label: "hsl.range.yellow", color: "#eab308", subtitle: undefined },
  { id: "green", label: "hsl.range.green", color: "#22c55e", subtitle: undefined },
  { id: "aqua", label: "hsl.range.aqua", color: "#06b6d4", subtitle: undefined },
  { id: "blue", label: "hsl.range.blue", color: "#3b82f6", subtitle: undefined },
  { id: "purple", label: "hsl.range.purple", color: "#8b5cf6", subtitle: undefined },
  { id: "magenta", label: "hsl.range.magenta", color: "#d946ef", subtitle: undefined }
] as const satisfies ReadonlyArray<{ id: "all" | "red" | "orange" | "yellow" | "green" | "aqua" | "blue" | "purple" | "magenta"; label: MessageKey; color: string; subtitle?: MessageKey }>;
type HslRange = (typeof HSL_RANGES)[number]["id"];
type HslParams = Record<HslRange, HslAdjustment>;

export const hslRenderer: OpRenderer<HslParams> = {
  type: "hsl",
  Card({ params, disabled, onParamsChange }) {
    const { t, percent } = useI18n();
    const signedPercent = (value: number): string => `${value > 0 ? "+" : ""}${percent(value / 100)}`;
    function setAdjustment(range: HslRange, patch: Partial<HslAdjustment>): void {
      const current = params[range] ?? { hue: 0, sat: 0, lum: 0 };
      onParamsChange({ [range]: { ...current, ...patch } } as Partial<HslParams>);
    }
    return (
      <div className="hsl-panel">
        <div className="hsl-grid">
        {HSL_RANGES.map((range) => {
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
                    max={180}
                    min={-180}
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
                    max={100}
                    min={-100}
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
                    max={100}
                    min={-100}
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
