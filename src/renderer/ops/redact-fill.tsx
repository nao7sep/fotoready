import React from "react";
import type { OpRenderer } from "./op-renderer";
import { RedactOverlay } from "./_redact-overlay";
import type { FractionRect } from "./_overlay-primitives";

type RedactFillParams = { rects: FractionRect[]; color: string };

export const redactFillRenderer: OpRenderer<RedactFillParams> = {
  type: "redact-fill",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="field-grid">
        <label className="span-two">
          Color
          <input disabled={disabled} type="color" value={params.color} onChange={(e) => onParamChange("color", e.currentTarget.value)} />
        </label>
      </div>
    );
  },
  Overlay: RedactOverlay as never
};
