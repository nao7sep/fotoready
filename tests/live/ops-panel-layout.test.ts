// Real Chromium geometry in an invisible, disposable Electron window; no running user app is used.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { OpsPanel } from "@renderer/components/panels/ops-panel";
import { applyLayoutVariables } from "@renderer/layout/layout-variables";
import { CHROME, PANE_MINS, computeMinWindowHeight, computeMinWindowWidth } from "@shared/layout/workspace-metrics";
import { buildGridTemplateColumns } from "@renderer/layout/workspace-layout";
import { I18nProvider } from "@renderer/i18n/I18nContext";
import { loadCatalogue } from "@shared/i18n/catalogues";
import type { Language } from "@shared/i18n/languages";
import { defaultPipeline } from "@shared/defaults";
import type { Task } from "@shared/types/project";
import { message } from "@shared/i18n/translate";
import { ownLiveChild } from "../helpers/live-child";

vi.mock("@renderer/ipc/client", () => ({ api: {} }));

const scenarios: Array<{ language: Language; zoom: number; font: string }> = [
  { language: "en", zoom: 1, font: "system-ui" },
  { language: "de", zoom: 1, font: "system-ui" },
  { language: "ja", zoom: 1, font: "system-ui" },
  { language: "de", zoom: 1.25, font: "Georgia, serif" }
];

it("keeps localized Output scrollable at the supported shell minimum and captures a real renderer termination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fotoready-ops-layout-"));
  let owned: ReturnType<typeof ownLiveChild> | undefined;
  try {
    const css = await readFile(resolve("src/renderer/styles/app.css"), "utf8");
    const variables: string[] = [];
    applyLayoutVariables({ style: { setProperty: (name: string, value: string) => variables.push(`${name}:${value}`) } } as unknown as HTMLElement);
    const fixtures: Array<{ html: string; zoom: number; language: Language; font: string }> = [];
    for (const scenario of scenarios) {
      await loadCatalogue(scenario.language);
      const panel = createElement(OpsPanel, {
        activeTask: savedTask(), activeOriginal: {
          id: "original-1", sourcePath: "/fixtures/photo.jpg", sourceHash: "source", size: 2000000,
          format: "jpeg", jpegQualityEstimate: 90, width: 1600, height: 1200,
          metadataSummary: { editorial: {}, dates: {}, gps: {} }, addedAt: "2026-10-23T00:00:00.000Z"
        }, addOpsWidth: PANE_MINS.addOps,
        hasGeminiApiKey: false, luts: [], opCatalog: [], originalSize: { width: 1600, height: 1200 },
        pendingRevealOpId: null, selectedOpId: "rotate", settings: null, stamps: [],
        visionGenerating: false, visionGenerationMode: null,
        opFailures: {}, outputFailures: { output: message("failure.outputSetting") },
        onAddOp: vi.fn(), onClearVision: vi.fn(), onCustomSlugChange: vi.fn(), onDismissFailure: vi.fn(),
        onGenerateDescriptionChange: vi.fn(), onGenerateSlugChange: vi.fn(), onGenerateVision: vi.fn(),
        onMoveOp: vi.fn(), onOpenSettings: vi.fn(), onOpEnabledChange: vi.fn(), onOpParamChange: vi.fn(),
        onOpParamsChange: vi.fn(), onOutputChange: vi.fn(), onReloadLuts: vi.fn(async () => {}),
        onReloadStamps: vi.fn(async () => {}), onRemoveOp: vi.fn(), onRevealOpHandled: vi.fn(), onSelectOp: vi.fn()
      });
      const markup = renderToStaticMarkup(createElement(I18nProvider, { language: scenario.language, locale: scenario.language, children: panel }));
      const html = join(dir, `fixture-${fixtures.length}.html`);
      const tracks = buildGridTemplateColumns(PANE_MINS, { showOps: true, showOriginals: true, showTasks: true });
      // Reproduce App's scrollable viewport and computed CSS floor. Native zoom leaves the physical
      // window minimum unchanged; the CSS floor remains reachable through viewport scrolling.
      await writeFile(html, `<!doctype html><html lang="${scenario.language}" style="${variables.join(";")};--font-ui:${scenario.font}"><head><meta charset="utf-8"><style>${css}</style></head><body><div class="app-viewport"><main class="app-shell" style="min-width:${computeMinWindowWidth()}px;min-height:${computeMinWindowHeight()}px"><div></div><section class="workspace" style="grid-template-columns:${tracks}"><div></div><div></div><div></div><div></div><div></div><div></div>${markup}</section><div></div></main></div></body></html>`);
      fixtures.push({ html, ...scenario });
    }
    const result = join(dir, "measurements.json");
    const main = join(dir, "probe.cjs");
    await writeFile(main, `
      const { app, BrowserWindow } = require('electron');
      const fs = require('node:fs');
      console.error('probe: main loaded');
      if (process.platform === 'darwin') app.setActivationPolicy('accessory');
      app.setPath('userData', ${JSON.stringify(join(dir, "profile"))});
      app.disableHardwareAcceleration();
      app.whenReady().then(async () => {
        console.error('probe: app ready');
        const window = new BrowserWindow({ show: false, frame: false, useContentSize: true, width: ${computeMinWindowWidth()}, height: ${computeMinWindowHeight()}, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
        try {
          const measurements = [];
          for (const fixture of ${JSON.stringify(fixtures)}) {
            await window.loadFile(fixture.html);
            window.webContents.setZoomFactor(fixture.zoom);
            const geometry = await window.webContents.executeJavaScript(
              '(' + ${JSON.stringify(measureLayout.toString())} + ')()'
            );
            measurements.push({ ...fixture, geometry });
          }
          const termination = await new Promise((resolve) => {
            window.webContents.once('render-process-gone', (_event, details) => resolve({ reason: details.reason, exitCode: details.exitCode }));
            window.webContents.forcefullyCrashRenderer();
          });
          fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ measurements, termination }));
          console.error('probe: measured');
          window.destroy();
          app.quit();
        } catch (error) { console.error(error); app.exit(1); }
      }).catch((error) => { console.error(error); app.exit(1); });
    `);
    const electron = createRequire(import.meta.url)("electron") as string;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    owned = ownLiveChild(spawn(electron, ["--headless", main], { env, stdio: ["pipe", "pipe", "pipe"] }), "Ops layout Electron probe");
    await owned.waitClosed();
    expect(owned.child.exitCode).toBe(0);
    const { measurements, termination } = JSON.parse(await readFile(result, "utf8")) as {
      measurements: Array<{ language: Language; zoom: number; font: string; geometry: ReturnType<typeof measureLayout> }>;
      termination: { reason: string; exitCode: number };
    };
    expect(measurements).toHaveLength(scenarios.length);
    const workspaceMinimum = computeMinWindowHeight() - CHROME.topBar - CHROME.statusBar;
    for (const { geometry: measured, ...scenario } of measurements) {
      expect(measured.paneHeight, JSON.stringify(scenario)).toBeCloseTo(workspaceMinimum, 0);
      expect(measured.outputHeight).toBeLessThanOrEqual(measured.paneHeight / 2 + 1);
      expect(measured.opsHeight).toBeGreaterThanOrEqual(measured.paneHeight / 2 - 1);
      expect(measured.outputScrollTop).toBeGreaterThan(0);
      expect(measured.opsScrollTop).toBeGreaterThan(0);
      expect(measured.outputAtEnd).toBe(true);
      expect(measured.lastControlVisible).toBe(true);
      expect(measured.outputWithinPane).toBe(true);
      expect(measured.visionScrolls).toBe(true);
      expect(measured.hasJpegQualityControl).toBe(true);
      expect(measured.hasMissingKeyWarning).toBe(true);
      expect(measured.fontFamily).toContain(scenario.font.split(",")[0]);
      expect(measured.clippedButtonCaptions, JSON.stringify(scenario)).toEqual([]);
      if (scenario.zoom > 1) expect(measured.viewportScrolls).toBe(true);
    }
    expect(["killed", "crashed"]).toContain(termination.reason);
    expect(Number.isInteger(termination.exitCode)).toBe(true);
    process.stdout.write(`${JSON.stringify({ scenarios: measurements.map(({ language, zoom, geometry }) => ({ language, zoom, paneHeight: geometry.paneHeight, outputHeight: geometry.outputHeight, overflowingOutputButtons: geometry.overflowingOutputButtons })), termination })}\n`);
  } finally {
    await owned?.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

function measureLayout() {
  const pane = document.querySelector<HTMLElement>(".ops-edit-pane")!;
  const ops = document.querySelector<HTMLElement>(".current-ops-section")!;
  const list = document.querySelector<HTMLElement>(".current-ops")!;
  const output = document.querySelector<HTMLElement>(".output-section")!;
  const vision = document.querySelector<HTMLElement>(".vision-description")!;
  const viewport = document.querySelector<HTMLElement>(".app-viewport")!;
  output.scrollTop = output.scrollHeight;
  list.scrollTop = list.scrollHeight;
  const paneBox = pane.getBoundingClientRect();
  const outputBox = output.getBoundingClientRect();
  const lastControl = output.querySelector<HTMLElement>(".output-controls > :last-child")!.getBoundingClientRect();
  return {
    paneHeight: paneBox.height, outputHeight: outputBox.height, opsHeight: ops.getBoundingClientRect().height,
    outputScrollTop: output.scrollTop, opsScrollTop: list.scrollTop,
    outputAtEnd: Math.abs(output.scrollHeight - output.clientHeight - output.scrollTop) <= 1,
    lastControlVisible: lastControl.top >= outputBox.top && lastControl.bottom <= outputBox.bottom + 1,
    outputWithinPane: outputBox.top >= paneBox.top && outputBox.bottom <= paneBox.bottom + 1,
    visionScrolls: vision.scrollHeight > vision.clientHeight && getComputedStyle(vision).overflowY === "auto",
    hasJpegQualityControl: output.querySelectorAll("select").length >= 2,
    hasMissingKeyWarning: output.querySelector(".modal-warning button") !== null,
    fontFamily: getComputedStyle(pane).fontFamily,
    overflowingOutputButtons: [...output.querySelectorAll("button")].filter((button) => button.getBoundingClientRect().right > outputBox.right + 1).map((button) => button.textContent),
    clippedButtonCaptions: [...output.querySelectorAll("button")].filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent),
    viewportScrolls: viewport.scrollWidth > viewport.clientWidth && viewport.scrollHeight > viewport.clientHeight
  };
}

function savedTask(): Task {
  return {
    id: "task-1", originalId: "original-1", generateDescription: false, generateSlug: false,
    customSlug: null, visionRunning: false, visionRunMode: null,
    pipeline: { ...defaultPipeline(), output: { ...defaultPipeline().output, format: "jpeg" }, ops: [
      { id: "rotate", type: "rotate", params: { degrees: 12, fillColor: "#ffffff" }, enabled: true },
      { id: "balance", type: "white-balance", params: { temperature: 10, tint: 5, samplePoint: null }, enabled: true }
    ] },
    status: "saved", error: null, everEdited: true,
    createdAt: "2026-10-23T00:00:00.000Z", updatedAt: "2026-10-23T00:00:00.000Z",
    output: {
      stagedPath: "/fixtures/photo.jpg", stagedParamsPath: "/fixtures/photo.json",
      stagedAt: "2026-10-23T00:00:00.000Z", outputHash: "hash", finalPath: null, finalParamsPath: null, renamedAt: null,
      vision: { description: "A fishing boat rests beside a wooden pier in a harbor at sunset. Warm light crosses the water, with houses and a wooded hillside visible behind the waterfront.", slugCandidates: ["harbor-at-sunset"], model: "fixture", ranAt: "2026-10-23T00:00:00.000Z" }
    }
  };
}
