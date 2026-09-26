import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import { useImeGuard, type ImeCompositionProps } from "@renderer/utils/ime-guard";

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
  const { ref, draft, setDraft } = useDraft<T>(external, identity, (field) => document.activeElement === field);
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

/**
 * A draft field that commits once, on Enter or when focus leaves, instead of on every keystroke —
 * for a value whose every change writes a file. Enter that ends an IME composition accepts the
 * candidate and does not commit.
 *
 * Only a draft the user has typed into since it last adopted the external value is pending: it is
 * the one thing that commits, and the only thing that holds off the external value. An untouched
 * draft follows the external value even while focused, so a value that changes elsewhere (an AI
 * result) is shown, and focusing and leaving the field never writes a stale value back over it.
 */
export function useCommitDraftField<T extends HTMLInputElement | HTMLTextAreaElement>(
  external: string,
  commit: (value: string) => void,
  identity: string,
): {
  ref: RefObject<T | null>;
  value: string;
  onChange: (event: ChangeEvent<T>) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<T>) => void;
} & ImeCompositionProps {
  const edited = useRef(false);
  const { ref, draft, setDraft } = useDraft<T>(external, identity, () => edited.current, () => {
    edited.current = false;
  });
  const ime = useImeGuard();
  const commitDraft = () => {
    if (!edited.current) return;
    edited.current = false;
    if (draft !== external) commit(draft);
  };
  return {
    ref,
    value: draft,
    ...ime.compositionProps,
    onChange: (event) => {
      edited.current = true;
      setDraft(event.currentTarget.value);
    },
    onBlur: commitDraft,
    onKeyDown: (event) => {
      if (event.key !== "Enter" || ime.isComposing(event)) return;
      event.preventDefault();
      commitDraft();
    },
  };
}

/**
 * The draft adopts the external value when the field identity changes (the pending edit, if any,
 * belongs to the field being left) or when `isEditing` says the draft holds no edit in progress.
 */
function useDraft<T extends HTMLInputElement | HTMLTextAreaElement>(
  external: string,
  identity: string,
  isEditing: (field: T | null) => boolean,
  onAdopt: () => void = () => {},
): { ref: RefObject<T | null>; draft: string; setDraft: Dispatch<SetStateAction<string>> } {
  const ref = useRef<T>(null);
  const identityRef = useRef(identity);
  const [draft, setDraft] = useState(external);

  useEffect(() => {
    if (identityRef.current !== identity) {
      identityRef.current = identity;
    } else if (isEditing(ref.current)) {
      return;
    }
    onAdopt();
    setDraft(external);
  }, [external, identity]);

  return { ref, draft, setDraft };
}
