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
            <label className="stacked-field span-two" key={field}>
              {fieldLabel(field)}
              <MetadataFieldTextArea
                disabled={disabled}
                value={fields[field] ?? ""}
                onChange={(value) => onParamChange("fields", updateMetadataField(fields, field, value))}
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

function MetadataFieldTextArea({
  disabled,
  value,
  onChange
}: {
  disabled: boolean;
  value: string;
  onChange(value: string): void;
}): React.JSX.Element {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.max(node.scrollHeight, 28)}px`;
  }, [value]);

  return (
    <textarea
      disabled={disabled}
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function fieldLabel(field: keyof MetadataFields): string {
  if (field === "webStatement") return "Rights URL";
  if (field === "usageTerms") return "Usage terms";
  if (field === "contactEmail") return "Contact email";
  if (field === "contactUrl") return "Contact URL";
  return field.replace(/^./, (letter) => letter.toUpperCase());
}
