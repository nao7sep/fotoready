// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Identifying text that takes one line must still do so once every rule in the stylesheet applies:
// a more specific rule meant for its neighbours can otherwise let it wrap again.

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync(resolve("src/renderer/styles/app.css"), "utf8");
  document.head.append(style);
});

const SITES: Array<[string, string, string]> = [
  ["an op card's title", '<div class="pipeline-op-card"><div class="op-card-header"><label class="toggle-row"><input type="checkbox"><span class="op-card-title">1. Strip metadata</span></label></div></div>', ".op-card-title"],
  ["an op card's asset name", '<div class="pipeline-op-card"><div class="geometry-controls"><div class="asset-source-row asset-source-row-value-only"><span class="asset-source-value">warm.cube</span></div></div></div>', ".asset-source-value"],
  ["an Originals row's name", '<div class="list-row"><button class="row-main-action"><span class="row-copy"><span class="row-title">photo.jpg</span><span class="row-detail">1600×1067 · JPEG</span></span></button></div>', ".row-title"],
  ["the preview toolbar's name", '<div class="preview-toolbar"><span class="preview-detail"><span class="preview-name">photo.jpg</span></span></div>', ".preview-name"],
  ["a menu item", '<div class="app-menu"><button>Keyboard shortcuts</button></div>', ".app-menu button"]
];

describe("identifying text on one line", () => {
  it.each(SITES)("keeps %s on one line with an ellipsis", (_name, markup, selector) => {
    document.body.innerHTML = markup;
    const text = getComputedStyle(document.querySelector(selector)!);
    expect(text.whiteSpace).toBe("nowrap");
    expect(text.textOverflow).toBe("ellipsis");
  });
});

describe("op card layout", () => {
  it("never lets a field's own width widen a card, and lines up every slider row in a card", () => {
    document.body.innerHTML = '<div class="pipeline-op-card"><div class="geometry-controls"><label class="slider-row"><span>X</span><input type="range"><span class="slider-value">2.5%</span></label></div></div>';
    expect(getComputedStyle(document.querySelector(".pipeline-op-card")!).gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(getComputedStyle(document.querySelector(".geometry-controls")!).gridTemplateColumns).toBe("max-content minmax(0, 1fr) max-content");
    expect(getComputedStyle(document.querySelector(".slider-row")!).gridTemplateColumns).toBe("subgrid");
  });
});
