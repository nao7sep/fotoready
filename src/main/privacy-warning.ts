import type { Original, Task } from "@shared/types/project";
import type { GlobalSettings } from "@shared/types/settings";
import type { PrivacyWarning } from "@shared/types/ipc";
import { metadataPolicy } from "@main/metadata-policy";

export function computePrivacyWarning(task: Task, original: Original, settings: GlobalSettings): PrivacyWarning | null {
  const policy = metadataPolicy(task, settings);
  const summary = original.metadataSummary;
  const kept: PrivacyWarning["kept"] = [];

  // No strip card → all source metadata is preserved (minus always-stale fields).
  // Strip card present → only the explicitly kept groups survive.
  const editorialKept = !policy.stripActive || policy.keep.includes("editorial");
  const datesKept = !policy.stripActive || policy.keep.includes("dates");
  const gpsKept = !policy.stripActive || policy.keep.includes("gps");

  if (editorialKept && hasAny(summary.editorial)) kept.push("editorial");
  if (datesKept && hasAny(summary.dates)) kept.push("dates");
  if (gpsKept && hasAny(summary.gps)) kept.push("gps");

  return kept.length === 0 ? null : { kept };
}

function hasAny(record: Record<string, unknown> | undefined): boolean {
  return !!record && Object.keys(record).length > 0;
}
