/**
 * **RL-2 / RL-3 — a genuine change to a reader-bound holding takes the
 * sanctioned proof path, and a change that cannot be proved is refused by
 * name.** (The author's refresh-liveness addendum, 2026-09-05.)
 *
 * These are the PURE parts of `scripts/refresh-reader-renewal.mts`: which
 * committed holdings the refreshed tree changed, which refresh sources those
 * paths belong to, and the record the orchestrator writes into
 * `docs/refresh-run.json` for the gate to read. Nothing here touches Git, the
 * network or the proof machinery; `tests/refresh-renewal.test.ts` pins it.
 */
import type { RefreshSource } from "./refresh-cadence.ts";
import type { RefreshRenewal, RefreshRenewalStep } from "./refresh-report.ts";

export interface HoldingDigest {
  readonly path: string;
  readonly sha256: string;
}

/**
 * Canonical holdings whose bytes differ between the committed closure census
 * and the current tree. A holding present on only one side counts as changed:
 * a holding that appeared or vanished is exactly what a closure proof binds.
 */
export function changedHoldings(proved: readonly HoldingDigest[], current: readonly HoldingDigest[]): string[] {
  const before = new Map(proved.map((h) => [h.path, h.sha256]));
  const after = new Map(current.map((h) => [h.path, h.sha256]));
  return [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path)).sort();
}

/** The refresh sources whose governed prefixes cover a changed holding, with the paths each owns. */
export function sourcesTouchingHoldings(
  sources: readonly RefreshSource[],
  holdings: readonly string[],
): { id: string; paths: string[] }[] {
  return sources
    .map((source) => ({
      id: source.id,
      paths: holdings.filter((path) => source.governs.some((prefix) => (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix))),
    }))
    .filter((entry) => entry.paths.length > 0);
}

/** Changed holdings no refresh source governs: a change the refresh did not make and may not carry. */
export function unownedHoldings(sources: readonly RefreshSource[], holdings: readonly string[]): string[] {
  const owned = new Set(sourcesTouchingHoldings(sources, holdings).flatMap((entry) => entry.paths));
  return holdings.filter((path) => !owned.has(path));
}

export function notNeededRenewal(exactHead: string, ranAt: string): RefreshRenewal {
  return { verdict: "NOT_NEEDED", ranAt, exactHead, changedHoldings: [], prefix: null, steps: [], refusedSources: [], failure: null };
}

export function renewedRenewal(input: { exactHead: string; ranAt: string; changedHoldings: string[]; prefix: string; steps: RefreshRenewalStep[] }): RefreshRenewal {
  return { verdict: "RENEWED", ranAt: input.ranAt, exactHead: input.exactHead, changedHoldings: input.changedHoldings, prefix: input.prefix, steps: input.steps, refusedSources: [], failure: null };
}

/**
 * A failed renewal refuses every source whose changed paths include a holding,
 * and says which step stopped it. Sources that changed only non-holding paths
 * are not refused here: the suite still gates them.
 */
export function failedRenewal(input: {
  exactHead: string;
  ranAt: string;
  changedHoldings: string[];
  prefix: string | null;
  steps: RefreshRenewalStep[];
  failure: string;
  sources: readonly RefreshSource[];
}): RefreshRenewal {
  const touching = sourcesTouchingHoldings(input.sources, input.changedHoldings);
  const failedStep = [...input.steps].reverse().find((step) => !step.ok)?.name ?? "renewal";
  return {
    verdict: "FAILED",
    ranAt: input.ranAt,
    exactHead: input.exactHead,
    changedHoldings: input.changedHoldings,
    prefix: input.prefix,
    steps: input.steps,
    refusedSources: touching.map((entry) => ({
      id: entry.id,
      paths: entry.paths,
      why:
        `the Reader proof renewal could not prove this source's change to ${entry.paths.join(", ")} at ${failedStep}: ${input.failure} — ` +
        "its governed paths are back at HEAD and it is owed until it lands",
    })),
    failure: input.failure,
  };
}

/** One line per step for the run report and the job log. */
export function renewalSummary(renewal: RefreshRenewal): string[] {
  const lines = [`Reader proof renewal: ${renewal.verdict} at ${renewal.ranAt} on ${renewal.exactHead.slice(0, 8)}`];
  if (renewal.changedHoldings.length) lines.push(`  changed holdings: ${renewal.changedHoldings.join(", ")}`);
  for (const step of renewal.steps) lines.push(`  ${step.ok ? "ok  " : "FAIL"} ${step.name} (${step.secs}s)${step.detail ? ` — ${step.detail}` : ""}`);
  for (const refused of renewal.refusedSources) lines.push(`  refused ${refused.id}: ${refused.why}`);
  if (renewal.failure) lines.push(`  failure: ${renewal.failure}`);
  return lines;
}
