export const BUILTIN_STAMP_GROUPS = [
  { id: "cover", label: "Cover" },
  { id: "marks", label: "Marks" },
  { id: "bubbles", label: "Bubbles" },
  { id: "reactions", label: "Reactions" },
  { id: "cute", label: "Cute" },
  { id: "stories", label: "Stories" },
  { id: "seasonal", label: "Seasonal" }
] as const;

export type BuiltinStampGroupId = (typeof BUILTIN_STAMP_GROUPS)[number]["id"];
export type StampGroupId = BuiltinStampGroupId | "imported";
export type StampGroupFilterId = "all" | StampGroupId;

export const STAMP_GROUP_FILTERS: ReadonlyArray<{ id: StampGroupFilterId; label: string }> = [
  { id: "all", label: "All" },
  ...BUILTIN_STAMP_GROUPS,
  { id: "imported", label: "Imported" }
];

const BUILTIN_STAMP_GROUP_IDS = new Set<string>(BUILTIN_STAMP_GROUPS.map((group) => group.id));

export function isBuiltinStampGroupId(value: string): value is BuiltinStampGroupId {
  return BUILTIN_STAMP_GROUP_IDS.has(value);
}
