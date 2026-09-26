// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, documentTranslator } from "@renderer/i18n/I18nContext";
import { OwnedFailureList } from "@renderer/components/owned-failure-list";
import { message } from "@shared/i18n/translate";
import type { Language } from "@shared/i18n/languages";

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

async function render(language: Language): Promise<void> {
  await act(async () => {
    const list = createElement(OwnedFailureList, { failures: { save: message("failure.saveAll") }, onDismiss: () => undefined });
    root.render(createElement(I18nProvider, { language, locale: language, children: list }));
  });
}

describe("interface language provider", () => {
  it("rewrites text already on screen when the language changes, and declares it on <html>", async () => {
    await render("en");
    expect(document.body.textContent).toContain("The tasks could not be queued for saving.");
    expect(document.documentElement.lang).toBe("en");

    await render("de");
    expect(document.body.textContent).toContain("Die Aufgaben konnten nicht zum Speichern eingereiht werden.");
    expect(document.querySelector("button")?.getAttribute("aria-label")).toBe("Aktionsergebnis schließen");
    expect(document.documentElement.lang).toBe("de");
  });

  it("lets a surface outside the provider speak the language the document last declared", async () => {
    await render("ja");
    expect(documentTranslator().t("common.reload")).toBe("再読み込み");
  });
});
