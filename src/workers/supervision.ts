import { setTimeout as wait } from 'node:timers/promises';

export async function superviseWorker(
  run: () => Promise<void>,
  signal: AbortSignal,
  onFailure: (error: unknown) => void,
): Promise<void> {
  let delay = 1000;
  while (!signal.aborted) {
    try {
      await run();
      delay = 1000;
    } catch (error) {
      onFailure(error);
      if (signal.aborted) return;
      try { await wait(delay, undefined, { signal }); }
      catch (error) { if (signal.aborted) return; throw error; }
      delay = Math.min(delay * 2, 30_000);
    }
  }
}
