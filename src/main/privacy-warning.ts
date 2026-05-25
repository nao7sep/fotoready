import type { Original, Task } from "@shared/types/project";
import type { PrivacyWarning } from "@shared/types/ipc";
import { metadataPolicy } from "@main/metadata-policy";

export function computePrivacyWarning(task: Task, original: Original): PrivacyWarning | null {
  const policy = metadataPolicy(task);
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
  if (!record) return false;
  return Object.values(record).some((value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.some((item) => Boolean(item));
    return value !== undefined && value !== null;
  });
}
