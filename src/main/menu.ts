import { Menu, type MenuItemConstructorOptions } from "electron";
import { APP_NAME } from "@shared/constants";
import type { Translator } from "@shared/i18n/translate";

// The application menu: Electron's default menu, rebuilt from the catalogue so every title and item
// speaks the interface language (localization-conventions). Each item keeps its role, so the
// standard actions and shortcuts are the system's own, and the Edit menu is titled in the interface
// language because macOS adds its own items to it whatever its title (app-chrome-conventions).
// Electron's default Help menu linked to Electron's own website and is left out.
export function buildApplicationMenuTemplate(
  { t }: Pick<Translator, "t">,
  platform: NodeJS.Platform
): MenuItemConstructorOptions[] {
  const isMac = platform === "darwin";
  const app = { app: APP_NAME };

  const appMenu: MenuItemConstructorOptions = {
    role: "appMenu",
    label: APP_NAME,
    submenu: [
      { role: "about", label: t("nativeMenu.about", app) },
      { type: "separator" },
      { role: "services", label: t("nativeMenu.services") },
      { type: "separator" },
      { role: "hide", label: t("nativeMenu.hide", app) },
      { role: "hideOthers", label: t("nativeMenu.hideOthers") },
      { role: "unhide", label: t("nativeMenu.showAll") },
      { type: "separator" },
      { role: "quit", label: t("nativeMenu.quit", app) }
    ]
  };

  const fileMenu: MenuItemConstructorOptions = {
    role: "fileMenu",
    label: t("nativeMenu.file"),
    submenu: [
      isMac
        ? { role: "close", label: t("nativeMenu.closeWindow") }
        : { role: "quit", label: t("nativeMenu.exit") }
    ]
  };

  const editMenu: MenuItemConstructorOptions = {
    role: "editMenu",
    label: t("nativeMenu.edit"),
    submenu: [
      { role: "undo", label: t("nativeMenu.undo") },
      { role: "redo", label: t("nativeMenu.redo") },
      { type: "separator" },
      { role: "cut", label: t("nativeMenu.cut") },
      { role: "copy", label: t("nativeMenu.copy") },
      { role: "paste", label: t("nativeMenu.paste") },
      ...(isMac
        ? ([
            { role: "pasteAndMatchStyle", label: t("nativeMenu.pasteAndMatchStyle") },
            { role: "delete", label: t("nativeMenu.delete") },
            { role: "selectAll", label: t("nativeMenu.selectAll") },
            { type: "separator" },
            {
              label: t("nativeMenu.speech"),
              submenu: [
                { role: "startSpeaking", label: t("nativeMenu.startSpeaking") },
                { role: "stopSpeaking", label: t("nativeMenu.stopSpeaking") }
              ]
            }
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { role: "delete", label: t("nativeMenu.delete") },
            { type: "separator" },
            { role: "selectAll", label: t("nativeMenu.selectAll") }
          ] satisfies MenuItemConstructorOptions[]))
    ]
  };

  const viewMenu: MenuItemConstructorOptions = {
    role: "viewMenu",
    label: t("nativeMenu.view"),
    submenu: [
      { role: "reload", label: t("nativeMenu.reload") },
      { role: "forceReload", label: t("nativeMenu.forceReload") },
      { role: "toggleDevTools", label: t("nativeMenu.toggleDevTools") },
      { type: "separator" },
      { role: "resetZoom", label: t("nativeMenu.actualSize") },
      { role: "zoomIn", label: t("nativeMenu.zoomIn") },
      { role: "zoomOut", label: t("nativeMenu.zoomOut") },
      { type: "separator" },
      { role: "togglefullscreen", label: t("nativeMenu.toggleFullScreen") }
    ]
  };

  const windowMenu: MenuItemConstructorOptions = {
    role: "windowMenu",
    label: t("nativeMenu.window"),
    submenu: [
      { role: "minimize", label: t("nativeMenu.minimize") },
      { role: "zoom", label: t("nativeMenu.zoom") },
      ...(isMac
        ? ([
            { type: "separator" },
            { role: "front", label: t("nativeMenu.bringAllToFront") }
          ] satisfies MenuItemConstructorOptions[])
        : ([{ role: "close", label: t("nativeMenu.close") }] satisfies MenuItemConstructorOptions[]))
    ]
  };

  return [...(isMac ? [appMenu] : []), fileMenu, editMenu, viewMenu, windowMenu];
}

/** Sets the application menu in the given language; called at startup and on each language change. */
export function installApplicationMenu(translator: Pick<Translator, "t">): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(translator, process.platform)));
}
