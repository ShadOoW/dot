export class Semaphore {
  private queue: Array<() => void> = [];
  private count: number;

  constructor(max: number) {
    if (max < 1) throw new Error(`Semaphore max must be >= 1, got ${max}`);
    this.count = max;
  }

  acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    return new Promise((r) => this.queue.push(r));
  }

  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.count++;
  }

  async with<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
