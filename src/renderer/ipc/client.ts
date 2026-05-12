import type { FotoReadyApi } from "@shared/types/ipc";

declare global {
  interface Window {
    api: FotoReadyApi;
  }
}

export const api = window.api;
