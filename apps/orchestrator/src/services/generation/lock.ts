export class KeyedLock {
  private readonly queues = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const chain = previous.then(() => current);
    this.queues.set(key, chain);
    await previous;
    try { return await task(); } finally {
      release();
      if (this.queues.get(key) === chain) this.queues.delete(key);
    }
  }
}
