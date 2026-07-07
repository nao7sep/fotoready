import { describe, expect, it } from "vitest";
import { isTextEditingTargetLike, isTextEditingShortcutTarget, type EditingTargetLike } from "@renderer/utils/editing-target";

function element(tagName: string, options: Partial<EditingTargetLike> = {}): EditingTargetLike {
  return { tagName, ...options };
}

describe("isTextEditingTargetLike", () => {
  it("accepts text-like inputs and textareas", () => {
    expect(isTextEditingTargetLike(element("input", { type: "text" }))).toBe(true);
    expect(isTextEditingTargetLike(element("input", { type: "number" }))).toBe(true);
    expect(isTextEditingTargetLike(element("input", { type: "password" }))).toBe(true);
    expect(isTextEditingTargetLike(element("textarea"))).toBe(true);
  });

  it("rejects non-text inputs and buttons", () => {
    expect(isTextEditingTargetLike(element("input", { type: "range" }))).toBe(false);
    expect(isTextEditingTargetLike(element("input", { type: "checkbox" }))).toBe(false);
    expect(isTextEditingTargetLike(element("button"))).toBe(false);
  });

  it("accepts contenteditable elements", () => {
    expect(isTextEditingTargetLike(element("div", { isContentEditable: true }))).toBe(true);
  });
});

describe("isTextEditingShortcutTarget", () => {
  it("walks up from children inside a contenteditable host", () => {
    const host = element("div", { isContentEditable: true });
    const child = element("span", { parentElement: host });
    expect(isTextEditingShortcutTarget(child as EventTarget)).toBe(true);
  });

  it("does not classify non-editable controls as text editing targets", () => {
    expect(isTextEditingShortcutTarget(element("input", { type: "range" }) as EventTarget)).toBe(false);
    expect(isTextEditingShortcutTarget(element("button") as EventTarget)).toBe(false);
    expect(isTextEditingShortcutTarget(null)).toBe(false);
  });
});
