import { ipcMain } from "electron";
import type { AppPaths } from "@main/paths";
import type { GlobalSettings } from "@shared/types/settings";
import { APP_NAME } from "@shared/constants";
import { emptyQueueSnapshot } from "@main/queues/snapshot";

export type RouterContext = {
  paths: AppPaths;
  settings: GlobalSettings;
  version: string;
};

export function registerIpcHandlers(ctx: RouterContext): void {
  ipcMain.handle("system.getInfo", async () => ({
    appName: APP_NAME,
    version: ctx.version,
    dataDir: ctx.paths.dataDir
  }));

  ipcMain.handle("settings.get", async () => ctx.settings);
  ipcMain.handle("queues.snapshot", async () => emptyQueueSnapshot());
}
