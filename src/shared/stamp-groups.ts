// The renderer names each group from the catalogue by its id.
export const BUILTIN_STAMP_GROUPS = [
  { id: "cover" },
  { id: "marks" },
  { id: "bubbles" },
  { id: "reactions" },
  { id: "funny" },
  { id: "cute" },
  { id: "stories" },
  { id: "seasonal" }
] as const;

export type BuiltinStampGroupId = (typeof BUILTIN_STAMP_GROUPS)[number]["id"];
export type StampGroupId = BuiltinStampGroupId | "imported";
export type StampGroupFilterId = "all" | StampGroupId;

export const STAMP_GROUP_FILTERS: ReadonlyArray<{ id: StampGroupFilterId }> = [
  { id: "all" },
  ...BUILTIN_STAMP_GROUPS,
  { id: "imported" }
];

const BUILTIN_STAMP_GROUP_IDS = new Set<string>(BUILTIN_STAMP_GROUPS.map((group) => group.id));

export function isBuiltinStampGroupId(value: string): value is BuiltinStampGroupId {
  return BUILTIN_STAMP_GROUP_IDS.has(value);
}
