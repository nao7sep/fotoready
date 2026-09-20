// @vitest-environment jsdom

/**
 * What an op's canvas overlay draws for a task that refuses edits. The main process
 * accepts a pipeline change only for a `not-saved` task, so an overlay that still
 * offers a drag handle promises an edit that fails behind the pointer. React-konva's
 * nodes are host strings, so rendering an overlay to static markup shows its handles
 * plainly: a draggable node, or the transformer that carries the resize anchors.
 */

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOpRenderer, listOpRenderers, type OverlayContext } from "@renderer/ops";
import { getOpDefinition } from "@core/ops/catalog";
import { DEFAULT_CONCEAL_REGION } from "@shared/types/conceal";

const mocks = vi.hoisted(() => ({ aspectRatio: vi.fn<() => Promise<number>>() }));
vi.mock("@renderer/ipc/client", () => ({ api: { assets: { aspectRatio: mocks.aspectRatio } } }));

const ctx: OverlayContext = {
  imageSize: { width: 1000, height: 800 },
  longEdge: 1000,
  imageBounds: { maxX: 1, maxY: 0.8 },
  placement: { x: 0, y: 0, width: 1000, height: 800, scale: 1 },
  stageSize: { width: 1000, height: 800 },
  originalAspectRatio: 1.25,
  samplePixel: () => ({ r: 128, g: 128, b: 128 })
};

/** Params that give each overlay something to draw; the op's own defaults otherwise. */
const DRAWN_PARAMS: Record<string, Record<string, unknown>> = {
  cover: { rects: [DEFAULT_CONCEAL_REGION] },
  blur: { rects: [DEFAULT_CONCEAL_REGION] },
  mosaic: { rects: [DEFAULT_CONCEAL_REGION] },
  stamp: { assetPath: "/tmp/stamp.png" },
  "watermark-image": { assetPath: "/tmp/mark.png" },
  "watermark-text": { text: "Sample" },
  "white-balance": { samplePoint: [0.5, 0.5] }
};

/** The ops whose overlay is a control rather than an outline or a marker. */
const OPS_WITH_HANDLES = ["crop", "cover", "blur", "mosaic", "stamp", "watermark-image", "watermark-text"];

beforeEach(() => {
  mocks.aspectRatio.mockReset().mockResolvedValue(1);
});

describe("op overlays on a task that refuses edits", () => {
  it("draws no handle for any op", () => {
    const overlays = listOpRenderers().filter((renderer) => renderer.Overlay);
    expect(overlays.length).toBeGreaterThan(0);

    for (const renderer of overlays) {
      const markup = overlayMarkup(renderer.type, false);
      expect(markup, `${renderer.type} handle`).not.toContain("draggable");
      expect(markup, `${renderer.type} anchors`).not.toContain("<transformer");
    }
  });

  it("draws them again once the task is editable", () => {
    // The guard above is worth its run only because these same overlays do carry
    // handles when the task takes edits.
    for (const type of OPS_WITH_HANDLES) {
      expect(overlayMarkup(type, true), `${type} handle`).toContain("draggable");
    }
  });
});

function overlayMarkup(type: string, editable: boolean): string {
  return renderToStaticMarkup(overlayElement(type, editable));
}

function overlayElement(type: string, editable: boolean): ReactElement {
  const renderer = getOpRenderer(type)!;
  const params = { ...getOpDefinition(type)!.defaultParams, ...DRAWN_PARAMS[type] };
  return createElement(renderer.Overlay!, {
    params,
    opId: `${type}-op`,
    editable,
    ctx,
    onParamsChange: () => undefined
  });
}
