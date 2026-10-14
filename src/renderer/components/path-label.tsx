// A character no translation uses, standing in for the path inside a translated sentence.
const SLOT = "\u{E000}";

/** Splits a path before its final segment, keeping a trailing separator with the segment it ends. */
export function splitPathTail(path: string): { head: string; tail: string } {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut < 0 ? { head: "", tail: path } : { head: path.slice(0, cut + 1), tail: path.slice(cut + 1) };
}

/**
 * A path, optionally inside a translated sentence, shown on one line. When it does not fit, it loses
 * its middle and keeps its final segment, because a path's beginning is usually shared
 * (interface-styling-conventions, Labels); the sentence around it is never shortened.
 */
export function PathLabel({ className, path, template }: {
  className?: string;
  path: string;
  template?: (slot: string) => string;
}): React.JSX.Element {
  const [before = "", after = ""] = (template ? template(SLOT) : SLOT).split(SLOT);
  const { head, tail } = splitPathTail(path);
  return (
    <span className={className}>
      {before ? <span className="path-fixed">{before}</span> : null}
      {head ? <span className="path-head">{head}</span> : null}
      <span className="path-tail">{tail}</span>
      {after ? <span className="path-fixed">{after}</span> : null}
    </span>
  );
}
