/**
 * Resolves once `holds` returns true: at once when it already does, otherwise after the change to the
 * document that makes it so. It waits on the document's own change events, with no deadline.
 */
export function whenDocument(holds: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (holds()) {
      resolve();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!holds()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}
