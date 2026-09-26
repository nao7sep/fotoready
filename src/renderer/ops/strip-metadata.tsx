import { useI18n } from "@renderer/i18n/I18nContext";
import React from "react";
import { METADATA_KEEP_GROUPS, type MetadataKeepGroup } from "@shared/types/settings";
import type { CaptureTimeField, LocationField, SourceMetadataSummary } from "@shared/types/project";
import type { MessageKey } from "@shared/i18n/catalogues";
import { metadataFieldLabel } from "@renderer/metadata-field-label";
import type { OpRenderer } from "./op-renderer";

type StripMetadataParams = { keep: MetadataKeepGroup[] };

const keepGroupLabels: Record<MetadataKeepGroup, { label: MessageKey; empty: MessageKey }> = {
  editorial: { label: "strip.group.editorial", empty: "strip.empty.editorial" },
  dates: { label: "strip.group.dates", empty: "strip.empty.dates" },
  gps: { label: "strip.group.gps", empty: "strip.empty.gps" }
};

export const stripMetadataRenderer: OpRenderer<StripMetadataParams> = {
  type: "strip-metadata",
  Card({ params, disabled, ctx, onParamChange }) {
    const { t } = useI18n();
    const keep = Array.isArray(params.keep) ? params.keep : [];
    const summary = ctx.originalMetadataSummary;
    return (
      <div className="geometry-controls">
        <div className="row-detail">{t("strip.detail")}</div>
        {METADATA_KEEP_GROUPS.map((group) => (
          <section className="metadata-keep-section" key={group}>
            <label className="toggle-row">
              <input
                disabled={disabled}
                type="checkbox"
                checked={keep.includes(group)}
                onChange={(e) => onParamChange("keep", e.currentTarget.checked ? [...keep, group] : keep.filter((item) => item !== group))}
              />
              <span>{t(keepGroupLabels[group].label)}</span>
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
  const { t } = useI18n();
  const items = metadataSummaryItems(group, summary);
  if (items.length === 0) {
    return <div className="row-detail">{t(keepGroupLabels[group].empty)}</div>;
  }
  return (
    <div className="metadata-summary-list">
      {items.map(([label, value]) => (
        <div className="metadata-summary-row" key={label}>
          <span>{t(label)}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

// Each value with the catalogue key that names it.
function metadataSummaryItems(group: MetadataKeepGroup, summary: SourceMetadataSummary | null): Array<[MessageKey, string]> {
  if (!summary) return [];
  if (group === "editorial") {
    return Object.entries(summary.editorial).flatMap(([key, value]): Array<[MessageKey, string]> => value ? [[metadataFieldLabel(key as keyof typeof summary.editorial), value]] : []);
  }
  return Object.entries(summary[group]).flatMap(([field, value]): Array<[MessageKey, string]> =>
    value ? [[`metadataSummary.${field as CaptureTimeField | LocationField}`, value]] : []);
}
