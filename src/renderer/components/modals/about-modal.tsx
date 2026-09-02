import React, { useState } from "react";
import type { SystemInfo } from "@shared/types/ipc";
import { api } from "@renderer/ipc/client";
import { ModalShell } from "./modal-shell";
import { OperationResult } from "../operation-result";
import { presentFailure } from "../../present-failure";

const APP_REPOSITORY_URL = "https://github.com/nao7sep/fotoready";
const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`;

interface Props {
  systemInfo: SystemInfo | null;
  onClose(): void;
}

export function AboutModal({ systemInfo, onClose }: Props): React.JSX.Element {
  const [linkFailure, setLinkFailure] = useState<string | null>(null);

  async function openProjectPage(url: string): Promise<void> {
    try {
      await api.system.openExternal(url);
      setLinkFailure(null);
    } catch (error) {
      setLinkFailure(presentFailure(
        error,
        "That page could not be opened. Check the default browser and try again.",
        "about link open failed",
        { url }
      ));
    }
  }

  return (
    <ModalShell
      title="About FotoReady"
      size="small"
      onClose={onClose}
      footer={<button className="toolbar-button" type="button" onClick={onClose}>Close</button>}
    >
      <div className="about-dialog">
        <div>
          <h3>FotoReady</h3>
          <p className="about-version">Version {systemInfo?.version ?? "unknown"}</p>
        </div>
        <p>
          A desktop photo editor for blogging and publication workflows, with queued image processing,
          metadata controls, rename previews, and optional Gemini-assisted descriptions and slugs.
        </p>
        <div className="about-links">
          <button className="toolbar-button" type="button" onClick={() => void openProjectPage(APP_REPOSITORY_URL)}>
            GitHub
          </button>
          <button className="toolbar-button" type="button" onClick={() => void openProjectPage(APP_ISSUES_URL)}>
            Issues
          </button>
        </div>
        {linkFailure ? (
          <OperationResult
            className="modal-error"
            severity="error"
            dismissLabel="Close link result"
            onDismiss={() => setLinkFailure(null)}
          >
            {linkFailure}
          </OperationResult>
        ) : null}
        <div className="settings-summary">
          <span>Developer</span>
          <code>Yoshinao Inoguchi</code>
        </div>
        <div className="settings-summary">
          <span>Copyright</span>
          <code>© 2026 Yoshinao Inoguchi</code>
        </div>
        <div className="settings-summary">
          <span>License</span>
          <code>MIT</code>
        </div>
      </div>
    </ModalShell>
  );
}
