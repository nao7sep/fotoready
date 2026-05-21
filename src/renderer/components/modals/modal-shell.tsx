import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ModalSize = "default" | "small" | "wide";

const modalStack: symbol[] = [];

/**
 * Shared chrome for every in-app modal: backdrop, pinned header, scrollable body,
 * pinned footer. Use `footer` for action buttons; omit it for header-only dialogs.
 * All modal close paths should flow through `onClose`, including Escape,
 * backdrop click, and the explicit header close button.
 */
export function ModalShell({
  title,
  size = "default",
  onClose,
  footer,
  children
}: {
  title: string;
  size?: ModalSize;
  onClose(): void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const modalIdRef = useRef(Symbol("modal"));
  const modalRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  function requestClose(): void {
    onClose();
  }

  useEffect(() => {
    const modalId = modalIdRef.current;
    modalStack.push(modalId);
    return () => {
      const index = modalStack.indexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    const autoFocusTarget = modal?.querySelector<HTMLElement>("[autofocus]");
    (autoFocusTarget ?? modal)?.focus();
    return () => {
      if (previousFocus && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && modalStack.at(-1) === modalIdRef.current) {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section className={`modal modal-${size}`} ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button compact" type="button" aria-label="Close" title="Close" onClick={requestClose}>
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
