import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("native inactive focus styling", () => {
  it("mutes the retained keyboard outline to ordinary chrome", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/styles/app.css"), "utf8");
    expect(css).toMatch(/\[data-window-inactive\] :focus-visible\s*{[^}]*outline-color:\s*var\(--border-strong-color\)/s);
  });
});
