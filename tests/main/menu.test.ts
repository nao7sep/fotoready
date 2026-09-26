import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";

vi.mock("electron", () => ({ Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() } }));

import { buildApplicationMenuTemplate } from "@main/menu";
import { createTranslator } from "@shared/i18n/translate";

function titles(template: MenuItemConstructorOptions[]): string[] {
  return template.map((item) => item.label ?? "");
}

function submenu(template: MenuItemConstructorOptions[], role: string): MenuItemConstructorOptions[] {
  const menu = template.find((item) => item.role === role);
  return (menu?.submenu ?? []) as MenuItemConstructorOptions[];
}

describe("application menu", () => {
  it("titles every menu in the interface language, the Edit menu included", () => {
    const de = buildApplicationMenuTemplate(createTranslator("de"), "darwin");
    const en = buildApplicationMenuTemplate(createTranslator("en"), "darwin");

    expect(titles(en)).toEqual(["FotoReady", "File", "Edit", "View", "Window"]);
    expect(titles(de).slice(1)).toEqual([
      createTranslator("de").t("nativeMenu.file"),
      createTranslator("de").t("nativeMenu.edit"),
      createTranslator("de").t("nativeMenu.view"),
      createTranslator("de").t("nativeMenu.window"),
    ]);
  });

  it("keeps the system's roles, so macOS supplies the actions and its own Edit items", () => {
    const template = buildApplicationMenuTemplate(createTranslator("ja"), "darwin");

    expect(template.map((item) => item.role)).toEqual(["appMenu", "fileMenu", "editMenu", "viewMenu", "windowMenu"]);
    expect(submenu(template, "editMenu").map((item) => item.role ?? item.type ?? "submenu")).toEqual([
      "undo", "redo", "separator", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll", "separator", "submenu",
    ]);
    expect(submenu(template, "appMenu").map((item) => item.role).filter(Boolean)).toContain("services");
    expect(submenu(template, "windowMenu").map((item) => item.role)).toContain("front");
    for (const item of template.flatMap((menu) => (menu.submenu ?? []) as MenuItemConstructorOptions[])) {
      if (item.type !== "separator") expect(item.label, String(item.role)).toBeTruthy();
    }
  });

  it("has no app menu on Windows, and quits from File", () => {
    const template = buildApplicationMenuTemplate(createTranslator("en"), "win32");

    expect(titles(template)).toEqual(["File", "Edit", "View", "Window"]);
    expect(submenu(template, "fileMenu")).toEqual([{ role: "quit", label: "Exit" }]);
    expect(submenu(template, "windowMenu").map((item) => item.role)).toEqual(["minimize", "zoom", "close"]);
  });
});
