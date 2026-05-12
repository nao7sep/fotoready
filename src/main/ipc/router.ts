import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import type { AppPaths } from "@main/paths";
import type { ProjectSession } from "@main/project/session";
import type { GlobalSettings } from "@shared/types/settings";
import { APP_NAME } from "@shared/constants";

export type RouterContext = {
  paths: AppPaths;
  settings: GlobalSettings;
  projectSession: ProjectSession;
  version: string;
};

export function registerIpcHandlers(ctx: RouterContext): void {
  ipcMain.handle("system.getInfo", async () => ({
    appName: APP_NAME,
    version: ctx.version,
    dataDir: ctx.paths.dataDir
  }));

  ipcMain.handle("settings.get", async () => ctx.settings);
  ipcMain.handle("project.current", async () => ctx.projectSession.snapshot());
  ipcMain.handle("project.new", async (_event, name?: string) => ctx.projectSession.newProject(name));
  ipcMain.handle("project.addOriginalsFromDialog", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Add Originals",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "avif", "heic", "gif", "tif", "tiff"] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return ctx.projectSession.snapshot();
    }

    return ctx.projectSession.addOriginals(result.filePaths);
  });
  ipcMain.handle("project.selectOriginal", async (_event, originalId: string) => ctx.projectSession.selectOriginal(originalId));
  ipcMain.handle("task.select", async (_event, taskId: string) => ctx.projectSession.selectTask(taskId));
  ipcMain.handle("task.fork", async (_event, taskId: string) => ctx.projectSession.forkTask(taskId));
  ipcMain.handle("task.save", async (_event, taskId: string) => ctx.projectSession.saveTask(taskId));
  ipcMain.handle("task.saveAll", async () => ctx.projectSession.saveAllPending());
  ipcMain.handle("queues.snapshot", async () => ctx.projectSession.queueSnapshot());
}
