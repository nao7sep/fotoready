import { STAMP_GROUP_FILTERS, type StampGroupFilterId } from "@shared/stamp-groups";
import type { StampEntry } from "@shared/types/ipc";

export function filterStampsByGroup(stamps: readonly StampEntry[], groupId: StampGroupFilterId): StampEntry[] {
  return groupId === "all" ? [...stamps] : stamps.filter((stamp) => stamp.groupId === groupId);
}

export function initialStampGroupFilter(stamps: readonly StampEntry[], selectedPath: string): StampGroupFilterId {
  const selected = stamps.find((stamp) => stamp.path === selectedPath);
  if (selected) return selected.groupId;
  return STAMP_GROUP_FILTERS
    .map((group) => group.id)
    .find((groupId) => groupId !== "all" && stamps.some((stamp) => stamp.groupId === groupId)) ?? "all";
}
