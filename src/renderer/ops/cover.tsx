import React from "react";
import type { ConcealRegion } from "@shared/types/conceal";
import type { OpRenderer } from "./op-renderer";
import { ConcealCard } from "./_conceal-card";
import { ConcealOverlay } from "./_conceal-overlay";

type CoverParams = { rects: ConcealRegion[]; color: string; opacity: number };

export const coverRenderer: OpRenderer<CoverParams> = {
  type: "cover",
  Card(props) {
    const { params, disabled, onParamChange } = props;
    return (
      <ConcealCard {...props}>
        <label className="conceal-color-row">
          <span>Color</span>
          <input disabled={disabled} type="color" value={params.color} onChange={(e) => onParamChange("color", e.currentTarget.value)} />
        </label>
        <label className="slider-row">
          <span>Opacity</span>
          <input disabled={disabled} max={1} min={0} step={0.01} type="range" value={params.opacity} onChange={(e) => onParamChange("opacity", e.currentTarget.valueAsNumber)} />
          <span className="slider-value">{`${Math.round(params.opacity * 100)}%`}</span>
        </label>
      </ConcealCard>
    );
  },
  Overlay: ConcealOverlay
};
