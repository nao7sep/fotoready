import React from "react";
import type { ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { ConcealCard } from "./_conceal-card";
import { ConcealOverlay } from "./_conceal-overlay";

type BlurParams = { rects: ConcealRegion[]; radius: number };

export const blurRenderer: OpRenderer<BlurParams> = {
  type: "blur",
  Card(props) {
    const { params, disabled, onParamChange } = props;
    return (
      <ConcealCard {...props}>
        <label className="slider-row">
          <span>Radius</span>
          <input disabled={disabled} max={40} min={1} step={1} type="range" value={params.radius} onChange={(e) => onParamChange("radius", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{params.radius.toFixed(0)}</span>
        </label>
      </ConcealCard>
    );
  },
  Overlay: ConcealOverlay
};
