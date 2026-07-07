export function revealInScrollContainer(container: HTMLElement | null, element: HTMLElement | null): void {
  if (!container || !element) return;
  const padding = 8;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const targetTop = container.scrollTop + elementRect.top - containerRect.top - padding;
  const targetBottom = container.scrollTop + elementRect.bottom - containerRect.bottom + padding;

  if (elementRect.height + padding * 2 >= containerRect.height) {
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    return;
  }

  if (elementRect.top < containerRect.top + padding) {
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    return;
  }

  if (elementRect.bottom > containerRect.bottom - padding) {
    container.scrollTo({ top: Math.max(0, targetBottom), behavior: "smooth" });
  }
}
