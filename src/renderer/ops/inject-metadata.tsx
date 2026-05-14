import React from "react";
import type { OpRenderer } from "./op-renderer";

type InjectMetadataParams = { fields: Record<string, string> };

const KNOWN_FIELDS = ["author", "copyright", "description", "credit"] as const;

export const injectMetadataRenderer: OpRenderer<InjectMetadataParams> = {
  type: "inject-metadata",
  Card({ params, disabled, onParamChange }) {
    const fields = params.fields ?? {};
    return (
      <div className="field-grid">
        {KNOWN_FIELDS.map((field) => (
          <label className="stacked-field" key={field}>
            {field}
            <input
              disabled={disabled}
              type="text"
              value={fields[field] ?? ""}
              onChange={(e) => onParamChange("fields", { ...fields, [field]: e.currentTarget.value })}
            />
          </label>
        ))}
      </div>
    );
  }
};
