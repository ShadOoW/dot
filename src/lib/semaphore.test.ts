import { describe, expect, test } from "bun:test";
import { Semaphore } from "./semaphore.ts";

describe("Semaphore", () => {
  test("throws on max < 1", () => {
    expect(() => new Semaphore(0)).toThrow("Semaphore max must be >= 1");
    expect(() => new Semaphore(-3)).toThrow();
  });

  test("limits concurrency to max", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        sem.with(async () => {
          running++;
          peak = Math.max(peak, running);
          await Bun.sleep(5);
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(running).toBe(0);
  });

  test("wakes waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    await sem.acquire();
    const waiters = [1, 2, 3].map((n) => sem.acquire().then(() => order.push(n)));
    sem.release();
    await waiters[0];
    sem.release();
    await waiters[1];
    sem.release();
    await waiters[2];
    sem.release();
    expect(order).toEqual([1, 2, 3]);
  });

  test("with() releases on throw", async () => {
    const sem = new Semaphore(1);
    await expect(sem.with(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // slot must be free again
    let ran = false;
    await sem.with(async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
