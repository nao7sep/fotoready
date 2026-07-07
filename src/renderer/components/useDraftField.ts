import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";

/**
 * Backs a free-text input or textarea with a synchronous local draft, for fields
 * whose value updates only after an async round-trip (an op-param or task edit
 * goes through IPC and the snapshot returns on a later tick). Binding such a
 * field's `value` directly to that async source resets the field between
 * keystrokes — dropping fast typing and, worse, tearing down IME composition so
 * かきくけこ comes out as ｋあｋいｋうｋえｋお. The draft shows the user's keystrokes
 * immediately and decouples display from the round-trip.
 *
 * The external value is adopted when the field identity changes (switching
 * task/op/field) or when this field is not the one being edited, so the async
 * echo of the user's own typing never snaps the field back mid-edit. See the
 * text input and IME conventions.
 */
export function useDraftField<T extends HTMLInputElement | HTMLTextAreaElement>(
  external: string,
  push: (value: string) => void,
  identity: string,
): {
  ref: RefObject<T | null>;
  value: string;
  onChange: (event: ChangeEvent<T>) => void;
} {
  const ref = useRef<T>(null);
  const identityRef = useRef(identity);
  const [draft, setDraft] = useState(external);

  useEffect(() => {
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      setDraft(external);
      return;
    }
    if (document.activeElement !== ref.current) setDraft(external);
  }, [external, identity]);

  return {
    ref,
    value: draft,
    onChange: (event) => {
      const next = event.currentTarget.value;
      setDraft(next);
      push(next);
    },
  };
}
