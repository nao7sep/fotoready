import { BrowserWindow } from "electron";

export interface PlainMessageDialogOptions {
  title: string;
  message: string;
  detail?: string;
}

const CLOSE_URL = "https://fotoready-dialog.invalid/close";

/** App-authored message shell without native severity/application artwork. */
export async function showPlainMessageDialog(options: PlainMessageDialogOptions): Promise<void> {
  const parent = BrowserWindow.getFocusedWindow() ?? undefined;
  const win = new BrowserWindow({
    parent,
    modal: Boolean(parent),
    show: false,
    width: 520,
    height: 260,
    minWidth: 420,
    minHeight: 220,
    maxWidth: 680,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: options.title,
    backgroundColor: "#f5f5f4",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const close = (): void => {
      if (settled) return;
      settled = true;
      resolve();
      if (!win.isDestroyed()) win.close();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
      if (!win.isDestroyed()) win.close();
    };
    win.on("closed", close);
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== CLOSE_URL) return;
      event.preventDefault();
      close();
    });
    win.webContents.on("before-input-event", (event, input) => {
      if (input.key !== "Escape") return;
      event.preventDefault();
      close();
    });
    win.webContents.once("dom-ready", async () => {
      try {
        const height = await win.webContents.executeJavaScript(
          "document.getElementById('dialog-header').offsetHeight + document.getElementById('dialog-body').scrollHeight + document.getElementById('dialog-footer').offsetHeight",
          true,
        ) as number;
        if (settled || win.isDestroyed()) return;
        const displayHeight = parent?.getBounds().height ?? 900;
        win.setContentSize(520, Math.min(Math.max(Math.ceil(height), 220), Math.floor(displayHeight * 0.85)));
        win.show();
        try {
          await win.webContents.executeJavaScript("document.getElementById('close')?.focus()", true);
        } catch (error) {
          // The dialog is already visible and usable. Focus is an enhancement,
          // so preserve the recovery surface and keep the cause in diagnostics.
          console.error("[fotoready] Could not focus the message dialog button:", error);
        }
      } catch (error) {
        fail(error);
      }
    });
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderPlainMessageDialogHtml(options))}`).catch(fail);
  });
}

export function renderPlainMessageDialogHtml(options: PlainMessageDialogOptions): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{color-scheme:light;font:14px/1.5 system-ui,-apple-system,sans-serif;background:#f5f5f4;color:#1c1917}
    *{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden}.dialog{height:100vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
    .header{padding:24px 24px 12px}.body{min-height:0;overflow:auto;padding:0 24px;display:flex;flex-direction:column;gap:12px}
    h1{font-size:18px;line-height:1.3;margin:0}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.detail{color:#57534e}
    .actions{display:flex;justify-content:flex-end;padding:12px 24px 24px}.button{color:white;border:1px solid #1d4ed8;border-radius:6px;padding:7px 16px;background:#2563eb;font:inherit}.button:hover,.button:focus{background:#1d4ed8;outline:2px solid #60a5fa;outline-offset:2px}
  </style></head><body><main class="dialog"><header class="header" id="dialog-header"><h1>${escapeHtml(options.title)}</h1></header><section class="body" id="dialog-body"><p>${escapeHtml(options.message)}</p>${options.detail ? `<p class="detail">${escapeHtml(options.detail)}</p>` : ""}</section><footer class="actions" id="dialog-footer"><button id="close" class="button" type="button" onclick="location.href='${CLOSE_URL}'">OK</button></footer></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
