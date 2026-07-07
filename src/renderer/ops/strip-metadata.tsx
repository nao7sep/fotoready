import React from "react";
import { METADATA_KEEP_GROUPS, type MetadataKeepGroup } from "@shared/types/settings";
import type { SourceMetadataSummary } from "@shared/types/project";
import { metadataFieldLabel } from "@renderer/metadata-field-label";
import type { OpRenderer } from "./op-renderer";

type StripMetadataParams = { keep: MetadataKeepGroup[] };

const keepGroupLabels: Record<MetadataKeepGroup, { label: string; empty: string }> = {
  editorial: { label: "Editorial", empty: "No editorial fields found." },
  dates: { label: "Time", empty: "No time fields found." },
  gps: { label: "GPS", empty: "No GPS fields found." }
};

export const stripMetadataRenderer: OpRenderer<StripMetadataParams> = {
  type: "strip-metadata",
  Card({ params, disabled, ctx, onParamChange }) {
    const keep = Array.isArray(params.keep) ? params.keep : [];
    const summary = ctx.originalMetadataSummary;
    return (
      <div className="geometry-controls">
        <div className="row-detail">Strips everything except selected groups.</div>
        {METADATA_KEEP_GROUPS.map((group) => (
          <section className="metadata-keep-section" key={group}>
            <label className="toggle-row">
              <input
                disabled={disabled}
                type="checkbox"
                checked={keep.includes(group)}
                onChange={(e) => onParamChange("keep", e.currentTarget.checked ? [...keep, group] : keep.filter((item) => item !== group))}
              />
              <span>{keepGroupLabels[group].label}</span>
            </label>
            <MetadataGroupSummary group={group} summary={summary} />
          </section>
        ))}
      </div>
    );
  }
};

function MetadataGroupSummary({
  group,
  summary
}: {
  group: MetadataKeepGroup;
  summary: SourceMetadataSummary | null;
}): React.JSX.Element {
  const items = metadataSummaryItems(group, summary);
  if (items.length === 0) {
    return <div className="row-detail">{keepGroupLabels[group].empty}</div>;
  }
  return (
    <div className="metadata-summary-list">
      {items.map(([label, value]) => (
        <div className="metadata-summary-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function metadataSummaryItems(group: MetadataKeepGroup, summary: SourceMetadataSummary | null): Array<[string, string]> {
  if (!summary) return [];
  if (group === "editorial") {
    return Object.entries(summary.editorial).flatMap(([key, value]) => value ? [[metadataFieldLabel(key as keyof typeof summary.editorial), value]] : []);
  }
  return Object.entries(summary[group]).filter((entry): entry is [string, string] => Boolean(entry[1]));
}
