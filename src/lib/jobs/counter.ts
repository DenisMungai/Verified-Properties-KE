import type { JobName } from "./types";

/** Tallies a job's outcomes; `failed` items are logged by id and error name and retried next run. */
export class Counter {
  readonly counts: Record<string, number> = {};

  constructor(private readonly job: JobName) {}

  add(key: string, n = 1): void {
    if (n === 0) return;
    this.counts[key] = (this.counts[key] ?? 0) + n;
  }

  /** Runs `fn` for one item; a thrown error is counted as `failed` and the run carries on. */
  async each<T>(items: readonly T[], idOf: (item: T) => string, fn: (item: T) => Promise<void>): Promise<void> {
    for (const item of items) {
      try {
        await fn(item);
      } catch (error) {
        this.add("failed");
        console.error(`[jobs] ${this.job} item failed id=${idOf(item)} error=${error instanceof Error ? error.name : "unknown"}`);
      }
    }
  }
}
