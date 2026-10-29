/** The runner's research clock: each pass launches a cycle or names its one hold; a failed cycle is followed by the next. */
export async function runResearchLoop<Owner>(ports: {
  readonly cycles: number;
  waitForOwner(): Promise<Owner>;
  /** A release to load ends the loop with the runner's exit code. */
  releaseExit(): Promise<number | null>;
  hold(): string | null;
  held(reason: string): Promise<void>;
  cycle(n: number, owner: Owner): Promise<{ readonly ok: boolean; readonly waitMs: () => Promise<number> }>;
  sleep(ms: number): Promise<void>;
  recover(error: unknown): Promise<void>;
}): Promise<{ readonly cycles: number; readonly exitCode: number | null }> {
  let cycle = 0;
  while (cycle < ports.cycles) {
    try {
      const owner = await ports.waitForOwner();
      const before = await ports.releaseExit();
      if (before !== null) return { cycles: cycle, exitCode: before };
      const reason = ports.hold();
      if (reason !== null) { await ports.held(reason); continue; }
      const result = await ports.cycle(++cycle, owner);
      const after = await ports.releaseExit();
      if (after !== null) return { cycles: cycle, exitCode: after };
      if (cycle < ports.cycles) await ports.sleep(await result.waitMs());
    } catch (error) { await ports.recover(error); }
  }
  return { cycles: cycle, exitCode: null };
}
