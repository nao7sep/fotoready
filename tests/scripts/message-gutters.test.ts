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

describe("message gutters", () => {
  it("keeps shared pane empty-state copy away from narrow Windows pane edges", () => {
    const rule = declarations(".empty-state");

    expect(rule).toMatch(/padding:\s*10px/);
    expect(rule).toMatch(/text-align:\s*center/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
