export interface RendererWindowContentTarget {
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string): Promise<void>;
}

/** Keep Chromium's document load rejectable until the startup owner settles it. */
export function loadRendererWindowContent(
  win: RendererWindowContentTarget,
  rendererUrl: string | undefined,
  rendererFile: string,
): Promise<void> {
  return rendererUrl ? win.loadURL(rendererUrl) : win.loadFile(rendererFile);
}
