/** A lane child ends its own turn, exit 0, after this long with nothing claimed; the runner starts it again. Well under the runner's 10-minute no-progress limit, which only a child holding work without progress should meet. */
export const IDLE_TURN_MS = 5 * 60_000;

/** The turn's end, asked by the runner's release drain or reached when idle. Each minute `beat` prints the lane's counts; the lane is busy while they change. */
export function laneTurn(line: () => string, now: () => number = Date.now) {
  let asked = false, last = line(), changedAt = now();
  return {
    ask: () => { asked = true; },
    asked: () => asked,
    stop: () => asked || now() - changedAt >= IDLE_TURN_MS,
    beat: (print: (line: string) => void = console.log) => { const next = line(); if (next !== last) { last = next; changedAt = now(); } print(next); },
  };
}

/** The runner's release drain and SIGTERM both ask the turn to finish what it holds and end. */
export function askOnRelease(ask: () => void): void {
  process.on("SIGTERM", ask);
  process.on("message", message => { if (message && typeof message === "object" && "kind" in message && message.kind === "RUNTIME_RELEASE_DRAIN") ask(); });
}

/** A drain that lands while the turn waits for its memory slot ends it with nothing claimed: a finish, not a failure. */
export async function slotOrLeave(slot: Promise<() => void>): Promise<() => void> {
  try { return await slot; } catch (error) { if (String(error).includes("RUNTIME_RELEASE_DRAINED")) process.exit(0); throw error; }
}
