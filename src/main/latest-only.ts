/**
 * Runs one request at a time and keeps only the newest one waiting: a request that arrives while
 * another waits replaces it, and the replaced one resolves null without running. Previews use it, so
 * renders the window has already moved past never queue on the shared worker pool ahead of saves and
 * the current preview. A request already running is not interrupted; stopping a worker mid-render
 * would cost more than finishing it.
 */
export class LatestOnly {
  #running = false;
  #waiting: { work: () => Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void } | null = null;

  run<T>(work: () => Promise<T>): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      this.#waiting?.resolve(null);
      this.#waiting = { work, resolve: resolve as (value: unknown) => void, reject };
      this.#next();
    });
  }

  #next(): void {
    if (this.#running || this.#waiting === null) return;
    const { work, resolve, reject } = this.#waiting;
    this.#waiting = null;
    this.#running = true;
    void work().then(resolve, reject).finally(() => {
      this.#running = false;
      this.#next();
    });
  }
}
