import { describe, expect, it } from "vitest";
import { chordBelongsToTextField, modifierLabel } from "@renderer/utils/platform-keys";

describe("the shown modifier word", () => {
  it("is Cmd on macOS and until the platform is known, Ctrl on Windows and Linux", () => {
    expect(modifierLabel("darwin")).toBe("Cmd");
    expect(modifierLabel(null)).toBe("Cmd");
    expect(modifierLabel("win32")).toBe("Ctrl");
    expect(modifierLabel("linux")).toBe("Ctrl");
  });
});

describe("a chord inside a text field", () => {
  const ctrl = { ctrlKey: true, metaKey: false };
  const cmd = { ctrlKey: false, metaKey: true };

  it("belongs to the text system on macOS when only Ctrl is held", () => {
    expect(chordBelongsToTextField("darwin", ctrl, true)).toBe(true);
    expect(chordBelongsToTextField(null, ctrl, true)).toBe(true);
    expect(chordBelongsToTextField("darwin", { ctrlKey: true, metaKey: true }, true)).toBe(false);
    expect(chordBelongsToTextField("darwin", cmd, true)).toBe(false);
    expect(chordBelongsToTextField("darwin", ctrl, false)).toBe(false);
  });

  it("stays the app's shortcut on Windows and Linux, where Ctrl is the binding", () => {
    expect(chordBelongsToTextField("win32", ctrl, true)).toBe(false);
    expect(chordBelongsToTextField("linux", ctrl, true)).toBe(false);
  });
});
