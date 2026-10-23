// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watermarkTextRenderer } from "@renderer/ops/watermark-text";
import { I18nProvider } from "@renderer/i18n/I18nContext";
import { loadCatalogue } from "@shared/i18n/catalogues";
import { createTranslator } from "@shared/i18n/translate";
import { LANGUAGES, type Language } from "@shared/i18n/languages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.querySelector("#root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.documentElement.lang = "en";
});

describe("text watermark accessible fields", () => {
  it.each(LANGUAGES)("gives keyboard-focusable fields localized accessible names in %s", async (language) => {
    await render(language);
    const { t } = createTranslator(language);
    const names = [t("opName.watermarkText"), t("watermarkText.backgroundColor"), t("watermarkText.borderColor")];
    expect(fieldNames()).toEqual(names);
    for (const name of names) {
      const field = [...document.querySelectorAll<HTMLInputElement>("input")].find((input) => input.getAttribute("aria-label") === name)!;
      expect(field.disabled).toBe(false);
      expect(field.tabIndex).toBeGreaterThanOrEqual(0);
      await act(async () => field.focus());
      expect(document.activeElement).toBe(field);
    }
  });

  it("names the content and both custom color pickers, and updates their names with the language", async () => {
    await render("en");
    expect(fieldNames()).toEqual(["Text watermark", "Background color", "Border color"]);
    await render("de");
    expect(fieldNames()).toEqual(["Text-Wasserzeichen", "Hintergrundfarbe", "Rahmenfarbe"]);
  });
});

function fieldNames(): Array<string | null> {
  return [
    document.querySelector<HTMLInputElement>('.geometry-controls > input[type="text"]')!,
    ...document.querySelectorAll<HTMLInputElement>('.color-picker-button input[type="color"]')
  ].map((field) => field.getAttribute("aria-label"));
}

async function render(language: Language): Promise<void> {
  await loadCatalogue(language);
  const card = createElement(watermarkTextRenderer.Card, {
    params: {
      text: "Sample", x: 0.1, y: 0.1, w: 0.3, h: 0.1, rotation: 0, opacity: 1,
      fontFamily: "Arial", color: "#ffffff", backgroundColor: "#000000", backgroundOpacity: 0,
      bold: false, italic: false, underline: false, strikeThrough: false,
      paddingX: 0.01, paddingY: 0.01, cornerRadius: 0.01,
      borderColor: "#ffffff", borderOpacity: 0, borderWidth: 0
    },
    disabled: false,
    ctx: {
      activeTaskId: "task-1", opId: "op-1", assetPickerPreviewLongEdge: 128,
      luts: [], stamps: [], originalMetadataSummary: null,
      originalSize: { width: 1000, height: 800 }
    },
    onParamChange: vi.fn(),
    onParamsChange: vi.fn()
  });
  await act(async () => {
    root.render(createElement(I18nProvider, { language, locale: language, children: card }));
  });
}
