import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/**
 * The app's in-app menu layer: a trigger plus a popup list of commands that
 * behaves like a real menu. The trigger is the single tab stop (aria-haspopup /
 * aria-expanded); opening moves focus into the menu and closing returns it to the
 * trigger; Up/Down move between items (stopping at the ends), Home/End jump,
 * type-ahead jumps by label, and Escape / Tab / outside click close. Items are
 * `menuitem`s navigated by the arrows, never by Tab.
 *
 * Controlled (open / onOpenChange) because the open state lives in the editor
 * store and is also closed by keyboard shortcuts elsewhere. Hand-rolled on the
 * renderer's own focus handling — fotoready's own menu, not shared across apps.
 */
type TriggerProps = {
  ref: (el: HTMLButtonElement | null) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  onClick: () => void;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
  /** Class on the popup container (e.g. the existing `app-menu`). */
  className?: string;
};

const MenuContext = createContext<{ close: () => void } | null>(null);

export function Menu({ open, onOpenChange, label, trigger, children, className }: Props) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const items = (): HTMLElement[] =>
    contentRef.current
      ? Array.from(contentRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      : [];

  const close = (focusTrigger = true) => {
    onOpenChange(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  // On open, move focus into the menu (first item).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => items()[0]?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Outside click closes without yanking focus back (a pointer interaction).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (contentRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onOpenChange(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    if (all.length === 0) return;
    const current = Math.max(0, all.indexOf(document.activeElement as HTMLElement));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      all[Math.min(current + 1, all.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      all[Math.max(current - 1, 0)]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      all[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      all[all.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const ch = e.key.toLowerCase();
      const order = [...all.slice(current + 1), ...all.slice(0, current + 1)];
      order.find((el) => el.textContent?.trim().toLowerCase().startsWith(ch))?.focus();
    }
  };

  return (
    <>
      {trigger({
        ref: (el) => {
          triggerRef.current = el;
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => onOpenChange(!open),
      })}
      {open ? (
        <div ref={contentRef} role="menu" aria-label={label} onKeyDown={onKeyDown} className={className}>
          <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
        </div>
      ) : null}
    </>
  );
}

/**
 * One command in a {@link Menu}: a `menuitem` reachable only by the menu's arrow
 * navigation (never its own tab stop). Activating it runs the action and closes
 * the menu, returning focus to the trigger.
 */
export function MenuItem({
  onSelect,
  children,
  className,
}: {
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        ctx?.close();
        onSelect();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
