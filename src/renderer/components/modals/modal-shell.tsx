import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { isTopModalLayer, pushModalLayer, removeModalLayer } from "./modal-stack";
import { acquireScrollLock, releaseScrollLock } from "./scroll-lock";
import { trapTabFocus } from "./focus-trap";
import { isComposingKeyboardEvent } from "@renderer/utils/ime-guard";

export type ModalSize = "default" | "small" | "wide";

/**
 * Shared chrome for every in-app modal: backdrop, pinned header, scrollable body,
 * pinned footer. Use `footer` for action buttons; omit it for header-only dialogs.
 *
 * The shell owns the layer mechanics so feature modals don't repeat them:
 *  - registers itself on the modal stack so Escape and Tab act only on the topmost layer,
 *  - traps Tab/Shift+Tab inside the topmost modal so focus never reaches the window behind it,
 *  - moves focus into the modal on open (unless a child claimed it via `autoFocus`) and restores
 *    focus to the previously focused element on close.
 *
 * All close paths — Escape, backdrop click, the header close button, programmatic — flow through
 * `onClose`, which decides whether to close, block, or confirm.
 */
export function ModalShell({
  title,
  size = "default",
  tall = false,
  onClose,
  footer,
  children
}: {
  title: string;
  size?: ModalSize;
  tall?: boolean;
  onClose(): void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const layerIdRef = useRef<symbol | null>(null);
  layerIdRef.current ??= Symbol("modal-layer");
  const layerId = layerIdRef.current;
  const modalRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Capture the element focused *before* this modal opened, during the first render — that is,
  // before a child's `autoFocus` (which runs at commit time) can pull focus into the modal. Focus
  // returns here on close so the trigger control is reselected.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const focusCapturedRef = useRef(false);
  if (!focusCapturedRef.current) {
    focusCapturedRef.current = true;
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;
  }

  useEffect(() => {
    // The shell owns both layer registration and the background scroll lock for its lifetime.
    // Reference counting in scroll-lock means the body unlocks only when the *last* modal closes,
    // staying correct under stacking and out-of-order unmount.
    pushModalLayer(layerId);
    acquireScrollLock();
    return () => {
      removeModalLayer(layerId);
      releaseScrollLock();
    };
  }, [layerId]);

  useEffect(() => {
    const modal = modalRef.current;
    // Only claim focus if a child didn't already (e.g. a primary button with `autoFocus`).
    if (modal && !modal.contains(document.activeElement)) modal.focus();
    return () => {
      const restore = restoreFocusRef.current;
      if (restore && restore.isConnected) restore.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!isTopModalLayer(layerId)) return;
      if (event.key === "Escape") {
        // During an IME composition, Escape cancels the pending candidate and belongs to the IME.
        // Closing the modal here would swallow that cancel and dismiss the dialog out from under
        // the user. Native handler, so read composition off the key event itself.
        if (isComposingKeyboardEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        trapTabFocus(event, modalRef.current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layerId, onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`modal modal-${size}${tall ? " modal-tall" : ""}`} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button compact" type="button" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-actions">{footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}
