// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { OriginalsPanel } from "@renderer/components/panels/originals-panel";
import { I18nProvider } from "@renderer/i18n/I18nContext";
import { loadCatalogue } from "@shared/i18n/catalogues";
import type { Language } from "@shared/i18n/languages";

it("formats pending imports in the interface locale and restores the empty state when none remain", async () => {
  const render = async (language: Language, pendingImportFiles: number) => {
    await loadCatalogue(language);
    const panel = createElement(OriginalsPanel, {
      pendingImportFiles, activeOriginalId: null, originals: [], thumbnails: {}, feedback: null, failures: {},
      onAdd: vi.fn(), onDismissFeedback: vi.fn(), onDismissFailure: vi.fn(), onDropFiles: vi.fn(),
      onRemove: vi.fn(), onSelect: vi.fn()
    });
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(I18nProvider, { language, locale: language, children: panel }));
    return host;
  };
  const english = await render("en", 1234);
  expect(english.querySelector('[role="status"]')?.textContent).toBe("Importing… 1,234");
  expect(english.querySelector(".empty-state")).toBeNull();
  const german = await render("de", 1234);
  expect(german.querySelector('[role="status"]')?.textContent).toBe("Wird importiert\u00a0… 1.234");
  const finished = await render("en", 0);
  expect(finished.querySelector('[role="status"]')).toBeNull();
  expect(finished.querySelector(".empty-state")).not.toBeNull();
});
