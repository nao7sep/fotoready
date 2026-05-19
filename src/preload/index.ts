import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FotoReadyApi } from "@shared/types/ipc";

const api: FotoReadyApi = {
  system: {
    getInfo: () => ipcRenderer.invoke("system.getInfo"),
    filePathForFile: (file) => webUtils.getPathForFile(file),
    log: (level, message, detail) => ipcRenderer.invoke("system.log", level, message, detail),
    openExternal: (url) => ipcRenderer.invoke("system.openExternal", url),
    pickFile: (options) => ipcRenderer.invoke("system.pickFile", options),
    pickDirectory: (options) => ipcRenderer.invoke("system.pickDirectory", options),
    revealInFolder: (filePath) => ipcRenderer.invoke("system.revealInFolder", filePath)
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get"),
    update: (patch) => ipcRenderer.invoke("settings.update", patch),
    hasGeminiApiKey: () => ipcRenderer.invoke("settings.hasGeminiApiKey"),
    setGeminiApiKey: (apiKey) => ipcRenderer.invoke("settings.setGeminiApiKey", apiKey)
  },
  state: {
    get: () => ipcRenderer.invoke("state.get"),
    update: (patch) => ipcRenderer.invoke("state.update", patch)
  },
  project: {
    current: () => ipcRenderer.invoke("project.current"),
    setOutputDirFromDialog: () => ipcRenderer.invoke("project.setOutputDirFromDialog"),
    clearOutputDir: () => ipcRenderer.invoke("project.clearOutputDir"),
    addOriginals: (sourcePaths) => ipcRenderer.invoke("project.addOriginals", sourcePaths),
    addOriginalsFromDialog: () => ipcRenderer.invoke("project.addOriginalsFromDialog"),
    removeOriginal: (originalId) => ipcRenderer.invoke("project.removeOriginal", originalId),
    selectOriginal: (originalId) => ipcRenderer.invoke("project.selectOriginal", originalId)
  },
  task: {
    select: (taskId) => ipcRenderer.invoke("task.select", taskId),
    fork: (taskId) => ipcRenderer.invoke("task.fork", taskId),
    delete: (taskId, options) => ipcRenderer.invoke("task.delete", taskId, options),
    deleteSavedOutput: (taskId) => ipcRenderer.invoke("task.deleteSavedOutput", taskId),
    dismissError: (taskId) => ipcRenderer.invoke("task.dismissError", taskId),
    retry: (taskId) => ipcRenderer.invoke("task.retry", taskId),
    save: (taskId) => ipcRenderer.invoke("task.save", taskId),
    saveAll: () => ipcRenderer.invoke("task.saveAll"),
    cancel: (taskId) => ipcRenderer.invoke("task.cancel", taskId),
    cancelAll: () => ipcRenderer.invoke("task.cancelAll"),
    addOp: (taskId, opType) => ipcRenderer.invoke("task.addOp", taskId, opType),
    removeOp: (taskId, opId) => ipcRenderer.invoke("task.removeOp", taskId, opId),
    moveOp: (taskId, opId, toIndex) => ipcRenderer.invoke("task.moveOp", taskId, opId, toIndex),
    setOpEnabled: (taskId, opId, enabled) => ipcRenderer.invoke("task.setOpEnabled", taskId, opId, enabled),
    updateOpParam: (taskId, opId, key, value) => ipcRenderer.invoke("task.updateOpParam", taskId, opId, key, value),
    updateOpParams: (taskId, opId, patch) => ipcRenderer.invoke("task.updateOpParams", taskId, opId, patch),
    undo: (taskId) => ipcRenderer.invoke("task.undo", taskId),
    setGenerateDescription: (taskId, generateDescription) => ipcRenderer.invoke("task.setGenerateDescription", taskId, generateDescription),
    setGenerateSlug: (taskId, generateSlug) => ipcRenderer.invoke("task.setGenerateSlug", taskId, generateSlug),
    setCustomSlug: (taskId, customSlug) => ipcRenderer.invoke("task.setCustomSlug", taskId, customSlug),
    updateOutput: (taskId, key, value) => ipcRenderer.invoke("task.updateOutput", taskId, key, value)
  },
  ops: {
    list: () => ipcRenderer.invoke("ops.list")
  },
  preview: {
    render: (taskId, options) => ipcRenderer.invoke("preview.render", taskId, options),
    originalThumbnail: (originalId) => ipcRenderer.invoke("preview.originalThumbnail", originalId)
  },
  vision: {
    runForTask: (taskId, options) => ipcRenderer.invoke("vision.runForTask", taskId, options)
  },
  rename: {
    preview: (templateId, taskIds) => ipcRenderer.invoke("rename.preview", templateId, taskIds),
    run: (templateId, taskIds) => ipcRenderer.invoke("rename.run", templateId, taskIds)
  },
  luts: {
    list: () => ipcRenderer.invoke("luts.list"),
    import: (filePath) => ipcRenderer.invoke("luts.import", filePath)
  },
  queues: {
    snapshot: () => ipcRenderer.invoke("queues.snapshot")
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
