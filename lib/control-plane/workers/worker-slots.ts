/** One process count shared across the runner's lanes, derived by the existing budget/provider capacity. */
export interface WorkerProcessSlots {
  acquire(): Promise<() => void>;
}

export function workerProcessSlots(capacity: () => number): WorkerProcessSlots {
  let active = 0;
  const waiting: Array<(release: () => void) => void> = [];
  const drain = (): void => {
    const maximum = capacity();
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error("LEASE_WORKER_CAPACITY_INVALID");
    while (active < maximum && waiting.length) {
      const resolve = waiting.shift()!;
      active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active--;
        drain();
      });
    }
  };
  return { acquire: () => new Promise<() => void>(resolve => { waiting.push(resolve); drain(); }) };
}
