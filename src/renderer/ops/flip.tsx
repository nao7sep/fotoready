import React from "react";
import type { OpRenderer } from "./op-renderer";

type FlipParams = {
  horizontal: boolean;
  vertical: boolean;
};

export const flipRenderer: OpRenderer<FlipParams> = {
  type: "flip",
  Card({ params, disabled, onParamChange }) {
    return (
      <div className="geometry-controls">
        <div className="field-grid">
          <label className="toggle-row span-two">
            <input
              checked={params.horizontal}
              disabled={disabled}
              type="checkbox"
              onChange={(event) => onParamChange("horizontal", event.currentTarget.checked)}
            />
            <span>Flip horizontally</span>
          </label>
          <label className="toggle-row span-two">
            <input
              checked={params.vertical}
              disabled={disabled}
              type="checkbox"
              onChange={(event) => onParamChange("vertical", event.currentTarget.checked)}
            />
            <span>Flip vertically</span>
          </label>
        </div>
      </div>
    );
  }
};
