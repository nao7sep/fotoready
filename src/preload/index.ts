import { contextBridge, ipcRenderer } from "electron";
import type { FotoReadyApi } from "@shared/types/ipc";

const api: FotoReadyApi = {
  system: {
    getInfo: () => ipcRenderer.invoke("system.getInfo")
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get")
  },
  queues: {
    snapshot: () => ipcRenderer.invoke("queues.snapshot")
  }
};

contextBridge.exposeInMainWorld("api", api);
