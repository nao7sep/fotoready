import { useI18n } from "@renderer/i18n/I18nContext";
import type { ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { ConcealCard } from "./_conceal-card";
import { ConcealOverlay } from "./_conceal-overlay";
import { formatPercent, fractionToPercentSteps, percentStepsToFraction } from "./_slider-units";

type MosaicParams = { rects: ConcealRegion[]; blockSize: number };

export const mosaicRenderer: OpRenderer<MosaicParams> = {
  type: "mosaic",
  Card(props) {
    const { params, disabled, onParamChange } = props;
    const { t, percent } = useI18n();
    return (
      <ConcealCard {...props}>
        <label className="slider-row">
          <span>{t("mosaic.cellSize")}</span>
          <input
            disabled={disabled}
            max={fractionToPercentSteps(0.05)}
            min={fractionToPercentSteps(0.002)}
            step={1}
            type="range"
            value={fractionToPercentSteps(params.blockSize)}
            onChange={(e) => onParamChange("blockSize", percentStepsToFraction(e.currentTarget.valueAsNumber))}
          />
          <span className="slider-value">{formatPercent(params.blockSize, percent)}</span>
        </label>
      </ConcealCard>
    );
  },
  Overlay: ConcealOverlay
};
