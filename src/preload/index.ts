import { contextBridge, ipcRenderer } from "electron";
import type { FotoReadyApi } from "@shared/types/ipc";

const api: FotoReadyApi = {
  system: {
    getInfo: () => ipcRenderer.invoke("system.getInfo")
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get")
  },
  project: {
    current: () => ipcRenderer.invoke("project.current"),
    newProject: (name?: string) => ipcRenderer.invoke("project.new", name),
    addOriginalsFromDialog: () => ipcRenderer.invoke("project.addOriginalsFromDialog"),
    selectOriginal: (originalId) => ipcRenderer.invoke("project.selectOriginal", originalId)
  },
  task: {
    select: (taskId) => ipcRenderer.invoke("task.select", taskId),
    fork: (taskId) => ipcRenderer.invoke("task.fork", taskId),
    save: (taskId) => ipcRenderer.invoke("task.save", taskId),
    saveAll: () => ipcRenderer.invoke("task.saveAll")
  },
  queues: {
    snapshot: () => ipcRenderer.invoke("queues.snapshot")
  }
};

contextBridge.exposeInMainWorld("api", api);
