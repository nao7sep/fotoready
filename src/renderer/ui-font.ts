/** Blank restores the stylesheet default; CSS resolves the configured family and its fallback. */
export function applyUiFontFamily(family: string): void {
  const configured = family.trim();
  const root = document.documentElement;
  if (configured) root.style.setProperty("--font-ui", configured);
  else root.style.removeProperty("--font-ui");
}
