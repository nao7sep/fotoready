import { BrowserWindow } from "electron";
import { windowBackground } from "./theme";

export interface PlainMessageDialogOptions {
  title: string;
  message: string;
  detail?: string;
  /** The buttons, in the order shown; the page's own words, like `detailsLabel`, are in the interface language. */
  buttons: string[];
  /** The button that takes focus; the first when omitted. */
  defaultId?: number;
  /** The answer that Escape, closing the window, and an ending session give; the default button when omitted. */
  cancelId?: number;
  /** A button that loses something, drawn as destructive. */
  destructiveId?: number;
  detailsLabel: string;
  lang: string;
}

const CHOICE_ORIGIN = "https://fotoready-dialog.invalid/choice/";

// Each open dialog's way to answer itself with its cancel choice.
const openDialogs = new Set<() => void>();

/**
 * Answers every open dialog with its cancel choice and closes it. An ending OS session calls this,
 * so no dialog holds it (modal-dialog-conventions).
 */
export function cancelOpenMessageDialogs(): void {
  for (const cancel of [...openDialogs]) cancel();
}

/** App-authored message shell without native severity/application artwork. Resolves with the chosen button's index. */
export async function showPlainMessageDialog(options: PlainMessageDialogOptions): Promise<number> {
  const defaultId = options.defaultId ?? 0;
  const cancelId = options.cancelId ?? defaultId;
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
    // The page follows prefers-color-scheme, which follows nativeTheme.themeSource (the OS when
    // startup failed before settings were read).
    backgroundColor: windowBackground(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  return await new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      openDialogs.delete(cancel);
      return true;
    };
    const choose = (choice: number): void => {
      if (!finish()) return;
      resolve(choice);
      if (!win.isDestroyed()) win.close();
    };
    const cancel = (): void => choose(cancelId);
    const fail = (error: unknown): void => {
      if (!finish()) return;
      reject(error);
      if (!win.isDestroyed()) win.close();
    };
    openDialogs.add(cancel);
    win.on("closed", cancel);
    win.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(CHOICE_ORIGIN)) return;
      event.preventDefault();
      const choice = Number(url.slice(CHOICE_ORIGIN.length));
      choose(Number.isInteger(choice) && choice >= 0 && choice < options.buttons.length ? choice : cancelId);
    });
    win.webContents.on("before-input-event", (event, input) => {
      if (input.key !== "Escape") return;
      event.preventDefault();
      cancel();
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
          await win.webContents.executeJavaScript(`document.getElementById('choice-${defaultId}')?.focus()`, true);
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
  const defaultId = options.defaultId ?? 0;
  const actions = options.buttons.map((label, index) => {
    const kind = index === options.destructiveId ? " destructive" : index === defaultId ? " primary" : "";
    return `<button id="choice-${index}" class="button${kind}" type="button" onclick="location.href='${CHOICE_ORIGIN}${index}'">${escapeHtml(label)}</button>`;
  }).join("");
  return `<!doctype html><html lang="${escapeHtml(options.lang)}"><head><meta charset="utf-8"><style>
    :root{color-scheme:light;font:14px/1.5 system-ui,-apple-system,sans-serif;background:#f5f5f4;color:#1c1917}
    *{box-sizing:border-box;scrollbar-width:auto;scrollbar-color:#78716c transparent}*::-webkit-scrollbar{width:16px;height:16px}*::-webkit-scrollbar-thumb{background:#78716c;background-clip:padding-box;border:3px solid transparent;border-radius:999px}
    body{margin:0;height:100vh;overflow:hidden}.dialog{height:100vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto}
    .header{padding:24px 24px 12px}.body{min-height:0;overflow:auto;padding:0 24px;display:flex;flex-direction:column;gap:12px}[role="region"]:focus-visible{outline:none}
    h1{font-size:18px;line-height:1.3;margin:0}p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.detail{color:#57534e}
    .actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:12px 24px 24px}.button{max-width:100%;overflow-wrap:anywhere;color:#1c1917;border:1px solid #a8a29e;border-radius:6px;padding:7px 16px;background:#fafaf9;font:inherit}.button:hover,.button:focus{background:#e7e5e4;outline:2px solid #78716c;outline-offset:2px}
    .primary{color:white;border-color:#1d4ed8;background:#2563eb}.primary:hover,.primary:focus{background:#1d4ed8;outline-color:#1d4ed8}.destructive{color:white;border-color:#991b1b;background:#b91c1c}.destructive:hover,.destructive:focus{background:#991b1b;outline-color:#991b1b}
    @media (prefers-color-scheme:dark){:root{color-scheme:dark;background:#161616;color:#fafafa}*{scrollbar-color:#999999 transparent}*::-webkit-scrollbar-thumb{background:#999999;background-clip:padding-box}.detail{color:#b0b0b0}.button{color:#fafafa;border-color:#737373;background:#262626}.button:hover,.button:focus{background:#404040;outline-color:#a3a3a3}.primary{color:white;border-color:#1d4ed8;background:#2563eb}.primary:hover,.primary:focus{background:#1d4ed8;outline-color:#60a5fa}.destructive{color:white;border-color:#991b1b;background:#b91c1c}.destructive:hover,.destructive:focus{background:#991b1b;outline-color:#f87171}}
  </style></head><body><main class="dialog"><header class="header" id="dialog-header"><h1>${escapeHtml(options.title)}</h1></header><section class="body" id="dialog-body" role="region" aria-label="${escapeHtml(options.detailsLabel)}" tabindex="0"><p>${escapeHtml(options.message)}</p>${options.detail ? `<p class="detail">${escapeHtml(options.detail)}</p>` : ""}</section><footer class="actions" id="dialog-footer">${actions}</footer></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
