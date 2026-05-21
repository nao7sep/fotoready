import React from "react";
import { METADATA_FIELDS, type MetadataField } from "@shared/types/settings";
import type { OpRenderer } from "./op-renderer";

type StripMetadataParams = { keep: MetadataField[] };

export const stripMetadataRenderer: OpRenderer<StripMetadataParams> = {
  type: "strip-metadata",
  Card({ params, disabled, onParamChange }) {
    const keep = Array.isArray(params.keep) ? params.keep : [];
    return (
      <div className="field-grid">
        {METADATA_FIELDS.map((field) => (
          <label className="toggle-row" key={field}>
            <input
              disabled={disabled}
              type="checkbox"
              checked={keep.includes(field)}
              onChange={(e) => onParamChange("keep", e.currentTarget.checked ? [...keep, field] : keep.filter((item) => item !== field))}
            />
            Keep {field}
          </label>
        ))}
      </div>
    );
  }
};
