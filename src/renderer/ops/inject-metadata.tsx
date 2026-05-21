import React from "react";
import { EDITABLE_METADATA_FIELDS, type MetadataFields } from "@shared/types/settings";
import type { OpRenderer } from "./op-renderer";

type InjectMetadataParams = { fields: MetadataFields };

export const injectMetadataRenderer: OpRenderer<InjectMetadataParams> = {
  type: "inject-metadata",
  Card({ params, disabled, onParamChange }) {
    const fields = params.fields ?? {};
    return (
      <div className="geometry-controls">
        <div className="field-grid">
          {EDITABLE_METADATA_FIELDS.map((field) => (
            <label className="stacked-field" key={field}>
              {fieldLabel(field)}
              <input
                disabled={disabled}
                type={field === "contactEmail" ? "email" : field === "contactUrl" || field === "webStatement" ? "url" : "text"}
                value={fields[field] ?? ""}
                onChange={(e) => onParamChange("fields", updateMetadataField(fields, field, e.currentTarget.value))}
              />
            </label>
          ))}
        </div>
      </div>
    );
  }
};

function updateMetadataField(fields: MetadataFields, field: keyof MetadataFields, value: string): MetadataFields {
  const next = { ...fields };
  if (value.length === 0) {
    delete next[field];
  } else {
    next[field] = value;
  }
  return next;
}

function fieldLabel(field: keyof MetadataFields): string {
  if (field === "webStatement") return "Rights URL";
  if (field === "usageTerms") return "Usage terms";
  if (field === "contactEmail") return "Contact email";
  if (field === "contactUrl") return "Contact URL";
  return field.replace(/^./, (letter) => letter.toUpperCase());
}
