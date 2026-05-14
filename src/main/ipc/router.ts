import path from "node:path";
import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import type { AppPaths } from "@main/paths";
import type { ProjectSession } from "@main/project/session";
import type { AppLogger } from "@main/logging/logger";
import type { GlobalSettings } from "@shared/types/settings";
import { APP_NAME } from "@shared/constants";
import { listOpDefinitions } from "@core/ops/catalog";
import { saveSettings } from "@main/persistence/settings-io";
import { clearCaches, getCacheSizes } from "@main/persistence/cache-admin";
import { listLuts } from "@main/luts/lut-catalog";
import { normalizeGlobalSettings } from "@shared/validation/settings";
import { isRecord } from "@shared/validation/common";

export type RouterContext = {
  paths: AppPaths;
  settings: GlobalSettings;
  projectSession: ProjectSession;
  logger: AppLogger;
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
  const publishResult = async <T>(work: Promise<T> | T): Promise<T> => {
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
  ipcMain.handle("system.log", async (_event, level: "warn" | "error", message: string, detail?: string | null) => {
    ctx.logger[level]({ mod: "renderer", detail: detail ?? null }, message);
  });
  ipcMain.handle("system.revealInFolder", async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
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
    const nextCandidate = isRecord(patch) ? { ...ctx.settings, ...patch } : ctx.settings;
    const { settings, issues } = normalizeGlobalSettings(nextCandidate, ctx.settings);
    Object.assign(ctx.settings, settings);
    for (const issue of issues) {
      ctx.logger.warn({ mod: "main.ipc", issue }, "settings patch contained invalid data");
    }
    await saveSettings(ctx.paths.settingsPath, ctx.settings);
    return ctx.settings;
  });
  ipcMain.handle("settings.hasGeminiApiKey", async () => ctx.projectSession.hasGeminiApiKey());
  ipcMain.handle("settings.setGeminiApiKey", async (_event, apiKey: string) => ctx.projectSession.setGeminiApiKey(apiKey));

  ipcMain.handle("project.current", async () => ctx.projectSession.snapshot());
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
  ipcMain.handle("project.clearOutputDir", async () => publishResult(ctx.projectSession.setOutputDir("")));
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
  ipcMain.handle("project.addOriginals", async (_event, sourcePaths: string[]) => publishResult(ctx.projectSession.addOriginals(sourcePaths)));
  ipcMain.handle("project.removeOriginal", async (_event, originalId: string) => publishResult(ctx.projectSession.removeOriginal(originalId)));
  ipcMain.handle("project.selectOriginal", async (_event, originalId: string) => publishResult(ctx.projectSession.selectOriginal(originalId)));

  ipcMain.handle("task.select", async (_event, taskId: string) => publishResult(ctx.projectSession.selectTask(taskId)));
  ipcMain.handle("task.fork", async (_event, taskId: string) => publishResult(ctx.projectSession.forkTask(taskId)));
  ipcMain.handle("task.delete", async (_event, taskId: string, options?: { deleteStagedOutput?: boolean; deleteFinalOutput?: boolean }) =>
    publishResult(ctx.projectSession.deleteTask(taskId, options))
  );
  ipcMain.handle("task.dismissError", async (_event, taskId: string) => publishResult(ctx.projectSession.dismissTaskError(taskId)));
  ipcMain.handle("task.retry", async (_event, taskId: string) => publishResult(ctx.projectSession.retryTask(taskId)));
  ipcMain.handle("task.save", async (_event, taskId: string) => publishResult(ctx.projectSession.enqueueSave(taskId)));
  ipcMain.handle("task.saveAll", async () => publishResult(ctx.projectSession.enqueueSaveAll()));
  ipcMain.handle("task.cancel", async (_event, taskId: string) => publishResult(ctx.projectSession.cancelTask(taskId)));
  ipcMain.handle("task.cancelAll", async () => publishResult(ctx.projectSession.cancelAll()));
  ipcMain.handle("task.addOp", async (_event, taskId: string, opType: string) => publishResult(ctx.projectSession.addOp(taskId, opType)));
  ipcMain.handle("task.removeOp", async (_event, taskId: string, opIndex: number) => publishResult(ctx.projectSession.removeOp(taskId, opIndex)));
  ipcMain.handle("task.setOpEnabled", async (_event, taskId: string, opIndex: number, enabled: boolean) => publishResult(ctx.projectSession.setOpEnabled(taskId, opIndex, enabled)));
  ipcMain.handle("task.updateOpParam", async (_event, taskId: string, opIndex: number, key: string, value: unknown) => publishResult(ctx.projectSession.updateOpParam(taskId, opIndex, key, value)));
  ipcMain.handle("task.updateOpParams", async (_event, taskId: string, opIndex: number, patch: Record<string, unknown>) =>
    publishResult(ctx.projectSession.updateOpParams(taskId, opIndex, patch))
  );
  ipcMain.handle("task.undo", async (_event, taskId: string) => publishResult(ctx.projectSession.undoTaskEdit(taskId)));
  ipcMain.handle("task.setAnalyzeContent", async (_event, taskId: string, analyzeContent: boolean) => publishResult(ctx.projectSession.setAnalyzeContent(taskId, analyzeContent)));
  ipcMain.handle("task.setCustomSlug", async (_event, taskId: string, customSlug: string | null) => publishResult(ctx.projectSession.setCustomSlug(taskId, customSlug)));
  ipcMain.handle("task.updateOutput", async (_event, taskId: string, key: string, value: unknown) => publishResult(ctx.projectSession.updateOutput(taskId, key, value)));

  ipcMain.handle("ops.list", async () =>
    listOpDefinitions().map(({ type, label, category, defaultParams }) => ({ type, label, category, defaultParams }))
  );
  ipcMain.handle("preview.render", async (_event, taskId: string, options?: { truncateOpsAt?: number | null }) =>
    ctx.projectSession.renderPreview(taskId, options)
  );
  ipcMain.handle("preview.originalThumbnail", async (_event, originalId: string) => ctx.projectSession.renderOriginalThumbnail(originalId));
  ipcMain.handle("vision.runForTask", async (_event, taskId: string) => publishResult(ctx.projectSession.runVision(taskId)));
  ipcMain.handle("rename.preview", async (_event, templateId?: string, taskIds?: string[]) => ctx.projectSession.previewRename(templateId, taskIds));
  ipcMain.handle("rename.run", async (_event, templateId?: string, taskIds?: string[]) => publishResult(ctx.projectSession.runRename(templateId, taskIds)));
  ipcMain.handle("luts.list", async () => listLuts(ctx.settings.lutFolder, path.dirname(ctx.paths.dataDir)));
  ipcMain.handle("caches.sizes", async () => getCacheSizes(ctx.paths));
  ipcMain.handle("caches.clear", async () => {
    await clearCaches(ctx.paths);
    return getCacheSizes(ctx.paths);
  });
  ipcMain.handle("queues.snapshot", async () => ctx.projectSession.queueSnapshot());
}
