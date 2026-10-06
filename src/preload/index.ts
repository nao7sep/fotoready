import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FotoReadyApi } from "@shared/types/ipc";
import { WINDOW_ACTIVITY_CHANNEL } from "@shared/window-activity";
import { LANGUAGE_CHANGED_CHANNEL } from "@shared/language-channel";
import { RECORDS_CHANGED_CHANNEL } from "@shared/records";
import { isIpcFailure } from "@shared/ipc-failure";

// Every request goes through here: a main-authored IpcFailure is rethrown as the
// plain object itself, since contextBridge copies it intact but drops an Error's own fields.
async function invoke(channel: string, ...args: unknown[]): Promise<any> {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (isIpcFailure(result)) throw result;
  return result;
}

const api: FotoReadyApi = {
  language: {
    current: () => invoke("language.current"),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, language: Parameters<typeof callback>[0]) => callback(language);
      ipcRenderer.on(LANGUAGE_CHANGED_CHANNEL, listener);
      return () => ipcRenderer.off(LANGUAGE_CHANGED_CHANNEL, listener);
    }
  },
  system: {
    getInfo: () => invoke("system.getInfo"),
    filePathForFile: (file) => webUtils.getPathForFile(file),
    log: (entry) => invoke("system.log", entry),
    openExternal: (url) => invoke("system.openExternal", url),
    pickFile: (options) => invoke("system.pickFile", options),
    pickFiles: (options) => invoke("system.pickFiles", options),
    pickDirectory: (options) => invoke("system.pickDirectory", options),
    revealInFolder: (filePath) => invoke("system.revealInFolder", filePath)
  },
  settings: {
    get: () => invoke("settings.get"),
    update: (settings) => invoke("settings.update", settings),
    hasGeminiApiKey: () => invoke("settings.hasGeminiApiKey"),
    setGeminiApiKey: (apiKey) => invoke("settings.setGeminiApiKey", apiKey),
    clearGeminiApiKey: () => invoke("settings.clearGeminiApiKey")
  },
  state: {
    get: () => invoke("state.get"),
    update: (patch) => invoke("state.update", patch)
  },
  project: {
    current: () => invoke("project.current"),
    setOutputDirFromDialog: () => invoke("project.setOutputDirFromDialog"),
    clearOutputDir: () => invoke("project.clearOutputDir"),
    addOriginals: (sourcePaths) => invoke("project.addOriginals", sourcePaths),
    addOriginalsFromDialog: () => invoke("project.addOriginalsFromDialog"),
    removeOriginal: (originalId) => invoke("project.removeOriginal", originalId),
    selectOriginal: (originalId) => invoke("project.selectOriginal", originalId)
  },
  task: {
    select: (taskId) => invoke("task.select", taskId),
    fork: (taskId) => invoke("task.fork", taskId),
    delete: (taskId) => invoke("task.delete", taskId),
    deleteSavedOutput: (taskId) => invoke("task.deleteSavedOutput", taskId),
    dismissError: (taskId) => invoke("task.dismissError", taskId),
    retry: (taskId) => invoke("task.retry", taskId),
    save: (taskId) => invoke("task.save", taskId),
    saveAll: () => invoke("task.saveAll"),
    cancel: (taskId) => invoke("task.cancel", taskId),
    cancelAll: () => invoke("task.cancelAll"),
    addOp: (taskId, opType) => invoke("task.addOp", taskId, opType),
    removeOp: (taskId, opId) => invoke("task.removeOp", taskId, opId),
    moveOp: (taskId, opId, toIndex) => invoke("task.moveOp", taskId, opId, toIndex),
    setOpEnabled: (taskId, opId, enabled) => invoke("task.setOpEnabled", taskId, opId, enabled),
    updateOpParam: (taskId, opId, key, value, options) => invoke("task.updateOpParam", taskId, opId, key, value, options),
    updateOpParams: (taskId, opId, patch, options) => invoke("task.updateOpParams", taskId, opId, patch, options),
    undo: (taskId) => invoke("task.undo", taskId),
    setGenerateDescription: (taskId, generateDescription) => invoke("task.setGenerateDescription", taskId, generateDescription),
    setGenerateSlug: (taskId, generateSlug) => invoke("task.setGenerateSlug", taskId, generateSlug),
    setCustomSlug: (taskId, customSlug) => invoke("task.setCustomSlug", taskId, customSlug),
    clearVision: (taskId) => invoke("task.clearVision", taskId),
    updateOutput: (taskId, key, value, options) => invoke("task.updateOutput", taskId, key, value, options)
  },
  ops: {
    list: () => invoke("ops.list")
  },
  assets: {
    aspectRatio: (assetPath) => invoke("assets.aspectRatio", assetPath),
    thumbnail: (assetPath, longEdge) => invoke("assets.thumbnail", assetPath, longEdge)
  },
  preview: {
    render: (taskId, options) => invoke("preview.render", taskId, options),
    originalThumbnail: (originalId) => invoke("preview.originalThumbnail", originalId)
  },
  vision: {
    runForTask: (taskId, options) => invoke("vision.runForTask", taskId, options)
  },
  rename: {
    preview: (templateId, taskIds) => invoke("rename.preview", templateId, taskIds),
    run: (templateId, taskIds) => invoke("rename.run", templateId, taskIds)
  },
  luts: {
    list: () => invoke("luts.list"),
    import: (filePaths) => invoke("luts.import", filePaths),
    delete: (filePaths) => invoke("luts.delete", filePaths),
    preview: (taskId, options, strength, previewLongEdge) => invoke("luts.preview", taskId, options, strength, previewLongEdge)
  },
  stamps: {
    list: () => invoke("stamps.list"),
    import: (filePaths) => invoke("stamps.import", filePaths),
    delete: (filePaths) => invoke("stamps.delete", filePaths)
  },
  queues: {
    snapshot: () => invoke("queues.snapshot")
  },
  records: {
    open: () => invoke("records.open"),
    page: (query) => invoke("records.page", query),
    detail: (kind, id) => invoke("records.detail", kind, id),
    sources: () => invoke("records.sources"),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on(RECORDS_CHANGED_CHANNEL, listener);
      return () => ipcRenderer.off(RECORDS_CHANGED_CHANNEL, listener);
    }
  },
  lifecycle: {
    approveClose: (allow) => invoke("lifecycle.approveClose", allow),
    onCloseRequest: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, request: Parameters<typeof callback>[0]) => callback(request);
      ipcRenderer.on("lifecycle.close-requested", listener);
      return () => ipcRenderer.off("lifecycle.close-requested", listener);
    },
    onWindowActivityChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, active: unknown) => {
        if (typeof active === "boolean") callback(active);
      };
      ipcRenderer.on(WINDOW_ACTIVITY_CHANNEL, listener);
      return () => ipcRenderer.off(WINDOW_ACTIVITY_CHANNEL, listener);
    }
  },
  events: {
    onProjectSnapshot: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
      ipcRenderer.on("project.snapshot", listener);
      return () => ipcRenderer.off("project.snapshot", listener);
    },
    onQueueSnapshot: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof callback>[0]) => callback(snapshot);
      ipcRenderer.on("queue.snapshot", listener);
      return () => ipcRenderer.off("queue.snapshot", listener);
    }
  }
};

contextBridge.exposeInMainWorld("api", api);
