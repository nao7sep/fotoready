import { useId } from "react";

/**
 * A field where the user types a number. It shows the text exactly as typed and, under it, what the
 * field accepts when the text is not that; the caller reads the text and commits only a valid value.
 */
export function NumberField({
  className,
  disabled,
  error,
  inputMode = "numeric",
  label,
  text,
  onTextChange
}: {
  className: string;
  disabled?: boolean;
  error: string | null;
  inputMode?: "numeric" | "decimal";
  label: string;
  text: string;
  onTextChange(text: string): void;
}): React.JSX.Element {
  const errorId = useId();
  return (
    <label className={className}>
      {label}
      <input
        aria-describedby={error === null ? undefined : errorId}
        aria-invalid={error === null ? undefined : true}
        disabled={disabled}
        inputMode={inputMode}
        type="text"
        value={text}
        onChange={(event) => onTextChange(event.currentTarget.value)}
      />
      {error === null ? null : <span className="field-error" id={errorId}>{error}</span>}
    </label>
  );
}
