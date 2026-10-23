/** A process-local byte-bounded LRU. Copies keep cached pixels private from mutable consumers. */
export class BitmapCache<T extends { data: Buffer }> {
  #entries = new Map<string, T>();
  #bytes = 0;
  #budget: number;

  constructor(bytes: number) {
    this.#budget = checkedBudget(bytes);
  }

  get byteSize(): number {
    return this.#bytes;
  }

  get(key: string): T | null {
    const bitmap = this.#entries.get(key);
    if (!bitmap) return null;
    this.#entries.delete(key);
    this.#entries.set(key, bitmap);
    return this.#clone(bitmap);
  }

  set(key: string, bitmap: T): void {
    const previous = this.#entries.get(key);
    if (previous) {
      this.#bytes -= previous.data.byteLength;
      this.#entries.delete(key);
    }
    // A bitmap larger than the whole allowance is useful for this call, but cannot be retained.
    if (bitmap.data.byteLength > this.#budget) return;
    this.#entries.set(key, this.#clone(bitmap));
    this.#bytes += bitmap.data.byteLength;
    this.#evict();
  }

  setBudget(bytes: number): void {
    this.#budget = checkedBudget(bytes);
    this.#evict();
  }

  #evict(): void {
    while (this.#bytes > this.#budget) {
      const oldest = this.#entries.entries().next().value!;
      this.#entries.delete(oldest[0]);
      this.#bytes -= oldest[1].data.byteLength;
    }
  }

  #clone(bitmap: T): T {
    return { ...bitmap, data: Buffer.from(bitmap.data) };
  }
}

function checkedBudget(bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Bitmap cache budget must be a nonnegative safe integer.");
  return bytes;
}
