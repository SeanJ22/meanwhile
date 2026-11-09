import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface ElectionResultsTurn {
  readonly checkedAt: string;
  readonly nextCheckAt: string | null;
}

/** A host-local clock hint skips database polls between due checks. It contains no source or ballot data. */
export async function runElectionResultsWhenDue<T extends { readonly nextCheckAt: string | null }>(input: {
  readonly path: string;
  readonly now: string;
  readonly requestedAt?: string;
  readonly run: () => Promise<T | null>;
}): Promise<T | null> {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("Election result turn requires a valid time");
  let clock: ElectionResultsTurn | null = null;
  try {
    const value: unknown = JSON.parse(await readFile(input.path, "utf8"));
    if (value && typeof value === "object" && "checkedAt" in value && typeof value.checkedAt === "string"
      && "nextCheckAt" in value && (value.nextCheckAt === null || typeof value.nextCheckAt === "string")) {
      clock = value as ElectionResultsTurn;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const checkedMs = Date.parse(clock?.checkedAt ?? "");
  const nextMs = Date.parse(clock?.nextCheckAt ?? "");
  const requestedMs = Date.parse(input.requestedAt ?? "");
  if (clock && Number.isFinite(checkedMs) && checkedMs <= nowMs && !(requestedMs > checkedMs)
    && (clock.nextCheckAt === null || Number.isFinite(nextMs) && nextMs > nowMs)) return null;
  const result = await input.run();
  if (result === null) return null;
  await mkdir(dirname(input.path), { recursive: true });
  const temporary = `${input.path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ checkedAt: input.now, nextCheckAt: result.nextCheckAt }), "utf8");
  await rename(temporary, input.path);
  return result;
}

/** Election results are their own step of the routine turn, on the turn's deadline rather than the fact-maintenance budget.
 * A turn with no time left records the skip (`skipped`) and leaves the clock alone, so the next turn is due again. */
export function runElectionResultsStep<T extends { readonly nextCheckAt: string | null }>(input: {
  readonly path: string;
  readonly deadlineMs: number;
  readonly now?: () => number;
  readonly requestedAt?: string;
  readonly run: () => Promise<T | null>;
  readonly skipped: (detail: string) => void;
}): Promise<T | null> {
  const now = input.now ?? Date.now;
  return runElectionResultsWhenDue({ path: input.path, now: new Date(now()).toISOString(), requestedAt: input.requestedAt,
    run: () => {
      if (now() < input.deadlineMs) return input.run();
      input.skipped("ELECTION_RESULTS_TURN_DEADLINE_PASSED: the turn ran out of time before election results were due; they are checked again next turn");
      return Promise.resolve(null);
    } });
}
