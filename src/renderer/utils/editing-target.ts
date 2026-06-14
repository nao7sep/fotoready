const TEXT_INPUT_TYPES = new Set([
  "",
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

export type EditingTargetLike = {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
  readonly parentElement?: EditingTargetLike | null;
};

export function isTextEditingShortcutTarget(target: EventTarget | null): boolean {
  let current: EditingTargetLike | null = isEditingTargetLike(target) ? target : null;
  while (current) {
    if (isTextEditingTargetLike(current)) return true;
    current = isEditingTargetLike(current.parentElement) ? current.parentElement : null;
  }
  return false;
}

export function isTextEditingTargetLike(target: EditingTargetLike): boolean {
  if (target.isContentEditable) return true;
  const tagName = target.tagName?.toUpperCase();
  if (tagName === "TEXTAREA") return true;
  if (tagName !== "INPUT") return false;
  return TEXT_INPUT_TYPES.has((target.type ?? "").toLowerCase());
}

function isEditingTargetLike(value: unknown): value is EditingTargetLike {
  return typeof value === "object" && value !== null;
}
