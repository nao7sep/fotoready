import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/renderer/styles/app.css");
const css = readFileSync(cssPath, "utf8");

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  expect(matches.length, `missing CSS rule for ${selector}`).toBeGreaterThan(0);
  return matches.map((match) => match[1]).join("\n");
}

describe("modal result layout", () => {
  it("keeps modal actions fixed while the bounded body owns overflow", () => {
    expect(declarations(".modal")).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
    expect(declarations(".modal-body")).toMatch(/overflow:\s*auto/);
    expect(declarations(".modal-body")).toMatch(/min-height:\s*0/);
    expect(declarations(".modal-actions")).toMatch(/justify-content:\s*flex-end/);
  });

  it("keeps result rows at natural height and lets long messages wrap", () => {
    const result = declarations(".operation-result");

    expect(result).toMatch(/flex:\s*0 0 auto/);
    expect(result).toMatch(/max-width:\s*100%/);
    expect(result).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("expands histogram geometry for its retryable error result", () => {
    const normal = declarations(".histogram-overlay");
    const failed = declarations(".histogram-overlay.has-error");
    const normalHeight = Number(normal.match(/height:\s*(\d+)px/)?.[1]);
    const failedHeight = Number(failed.match(/height:\s*(\d+)px/)?.[1]);

    expect(failedHeight).toBeGreaterThan(normalHeight);
  });
});
