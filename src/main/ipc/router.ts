import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import type { AppPaths } from "@main/paths";
import type { ProjectSession } from "@main/project/session";
import type { GlobalSettings } from "@shared/types/settings";
import { APP_NAME, PROJECT_EXTENSION } from "@shared/constants";
import { listOpDefinitions } from "@core/ops/catalog";
import { saveSettings } from "@main/persistence/settings-io";
import { clearCaches, getCacheSizes } from "@main/persistence/cache-admin";

export type RouterContext = {
  paths: AppPaths;
  settings: GlobalSettings;
  projectSession: ProjectSession;
  version: string;
};

export function registerIpcHandlers(ctx: RouterContext): void {
  const publishSnapshots = () => {
    const project = ctx.projectSession.snapshot();
    const queue = ctx.projectSession.queueSnapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("project.snapshot", project);
      win.webContents.send("queue.snapshot", queue);
    }
  };
  const publishResult = async <T>(work: Promise<T>): Promise<T> => {
    const result = await work;
    publishSnapshots();
    return result;
  };

  ctx.projectSession.setSnapshotListener(async () => {
    publishSnapshots();
  });

  ipcMain.handle("system.getInfo", async () => ({
    appName: APP_NAME,
    version: ctx.version,
    dataDir: ctx.paths.dataDir
  }));
  ipcMain.handle("system.pickFile", async (event, options: { title: string; extensions: string[] }) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: options.title,
      properties: ["openFile"],
      filters: [
        { name: "Supported files", extensions: options.extensions },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("settings.get", async () => ctx.settings);
  ipcMain.handle("settings.update", async (_event, patch: Partial<GlobalSettings>) => {
    Object.assign(ctx.settings, patch);
    await saveSettings(ctx.paths.settingsPath, ctx.settings);
    return ctx.settings;
  });
  ipcMain.handle("settings.setGeminiApiKey", async (_event, apiKey: string) => ctx.projectSession.setGeminiApiKey(apiKey));
  ipcMain.handle("project.current", async () => ctx.projectSession.snapshot());
  ipcMain.handle("project.new", async (_event, name?: string) => publishResult(ctx.projectSession.newProject(name)));
  ipcMain.handle("project.openFromDialog", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Open FotoReady Project",
      properties: ["openFile"],
      filters: [
        { name: "FotoReady Project", extensions: ["fotoready.json"] },
        { name: "JSON", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return ctx.projectSession.snapshot();
    }
    const snapshot = await ctx.projectSession.open(result.filePaths[0]);
    ctx.settings.lastProjectPath = result.filePaths[0];
    await saveSettings(ctx.paths.settingsPath, ctx.settings);
    publishSnapshots();
    return snapshot;
  });
  ipcMain.handle("project.saveAsFromDialog", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const result = owner
      ? await dialog.showSaveDialog(owner, {
        title: "Save FotoReady Project",
        defaultPath: `untitled${PROJECT_EXTENSION}`,
        filters: [{ name: "FotoReady Project", extensions: ["fotoready.json"] }]
      })
      : await dialog.showSaveDialog({
        title: "Save FotoReady Project",
        defaultPath: `untitled${PROJECT_EXTENSION}`,
        filters: [{ name: "FotoReady Project", extensions: ["fotoready.json"] }]
      });
    if (result.canceled || !result.filePath) {
      return ctx.projectSession.snapshot();
    }
    const projectPath = result.filePath.endsWith(PROJECT_EXTENSION) ? result.filePath : `${result.filePath}${PROJECT_EXTENSION}`;
    const snapshot = await ctx.projectSession.saveAs(projectPath);
    ctx.settings.lastProjectPath = projectPath;
    await saveSettings(ctx.paths.settingsPath, ctx.settings);
    publishSnapshots();
    return snapshot;
  });
  ipcMain.handle("project.setOutputDirFromDialog", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: "Choose Output Directory",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return ctx.projectSession.snapshot();
    }
    return publishResult(ctx.projectSession.setOutputDir(result.filePaths[0]));
  });
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

    return publishResult(ctx.projectSession.addOriginals(result.filePaths));
  });
  ipcMain.handle("project.selectOriginal", async (_event, originalId: string) => publishResult(ctx.projectSession.selectOriginal(originalId)));
  ipcMain.handle("task.select", async (_event, taskId: string) => publishResult(ctx.projectSession.selectTask(taskId)));
  ipcMain.handle("task.fork", async (_event, taskId: string) => publishResult(ctx.projectSession.forkTask(taskId)));
  ipcMain.handle("task.delete", async (_event, taskId: string) => publishResult(ctx.projectSession.deleteTask(taskId)));
  ipcMain.handle("task.retry", async (_event, taskId: string) => publishResult(ctx.projectSession.retryTask(taskId)));
  ipcMain.handle("task.save", async (_event, taskId: string) => publishResult(ctx.projectSession.saveTask(taskId)));
  ipcMain.handle("task.saveAll", async () => publishResult(ctx.projectSession.saveAllPending()));
  ipcMain.handle("task.addOp", async (_event, taskId: string, opType: string) => publishResult(ctx.projectSession.addOp(taskId, opType)));
  ipcMain.handle("task.removeOp", async (_event, taskId: string, opIndex: number) => publishResult(ctx.projectSession.removeOp(taskId, opIndex)));
  ipcMain.handle("task.setOpEnabled", async (_event, taskId: string, opIndex: number, enabled: boolean) => publishResult(ctx.projectSession.setOpEnabled(taskId, opIndex, enabled)));
  ipcMain.handle("task.updateOpParam", async (_event, taskId: string, opIndex: number, key: string, value: unknown) => publishResult(ctx.projectSession.updateOpParam(taskId, opIndex, key, value)));
  ipcMain.handle("task.setAnalyzeContent", async (_event, taskId: string, analyzeContent: boolean) => publishResult(ctx.projectSession.setAnalyzeContent(taskId, analyzeContent)));
  ipcMain.handle("task.setCustomSlug", async (_event, taskId: string, customSlug: string | null) => publishResult(ctx.projectSession.setCustomSlug(taskId, customSlug)));
  ipcMain.handle("task.updateOutput", async (_event, taskId: string, key: string, value: unknown) => publishResult(ctx.projectSession.updateOutput(taskId, key, value)));
  ipcMain.handle("ops.list", async () =>
    listOpDefinitions()
      .filter((op) => op.visible)
      .map(({ type, label, category, defaultParams, visible }) => ({ type, label, category, defaultParams, visible }))
  );
  ipcMain.handle("preview.render", async (_event, taskId: string) => ctx.projectSession.renderPreview(taskId));
  ipcMain.handle("preview.originalThumbnail", async (_event, originalId: string) => ctx.projectSession.renderOriginalThumbnail(originalId));
  ipcMain.handle("vision.runForTask", async (_event, taskId: string) => publishResult(ctx.projectSession.runVision(taskId)));
  ipcMain.handle("rename.preview", async (_event, templateId?: string, taskIds?: string[]) => ctx.projectSession.previewRename(templateId, taskIds));
  ipcMain.handle("rename.run", async (_event, templateId?: string, taskIds?: string[]) => publishResult(ctx.projectSession.runRename(templateId, taskIds)));
  ipcMain.handle("caches.sizes", async () => getCacheSizes(ctx.paths));
  ipcMain.handle("caches.clear", async () => {
    await clearCaches(ctx.paths);
    return getCacheSizes(ctx.paths);
  });
  ipcMain.handle("queues.snapshot", async () => ctx.projectSession.queueSnapshot());
}
