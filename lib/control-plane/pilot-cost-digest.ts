/**
 * **THE DIGEST'S COST SECTION — from the run record, never recomputed.**
 * (Prompt-caching session, 2026-09-06; extracted from `scripts/pilot-runner.mts`
 * so the section can be rendered over any run record and tested.)
 *
 * Read from the run record's own digest lines and its research block, so the
 * console, the run record and the mirrored digest cannot disagree about what
 * a cycle spent — three surfaces, one derivation. The cache lines come from
 * the cost LEDGER: the cycle computes `research.cacheThisCycle` from its own
 * ledger rows through the same function the window metrics use
 * (`cacheHitRateByRole`), and this section prints them through the same
 * renderer the RESEARCH METRICS section uses (`cacheRoleLines`). A record
 * written before the cycle computed them says so by name; a lane whose rows
 * predate the cache fields prints NOT MEASURED by name. `0%` is never printed
 * for a measurement nobody took.
 */

import { cacheRoleLines } from "./research-digest.ts";
import type { CacheHitRate } from "./research-metrics.ts";
import type { PrewarmOutcome } from "./scheduler/shadow-loop.ts";

/** The slice of a cycle's run record this section reads. */
export interface CostDigestRecord {
  readonly digest?: readonly string[];
  readonly research?: {
    readonly lanes?: { readonly model?: { readonly prewarm?: PrewarmOutcome | null } } | null;
    readonly cacheThisCycle?: readonly CacheHitRate[] | null;
    readonly scouts?: readonly { readonly cost: { readonly usd?: number | null } | null }[];
  };
}

export interface CostLines {
  readonly lines: readonly string[];
}

export function costSection(record: CostDigestRecord): CostLines {
  const digest = record.digest ?? [];
  const grab = (needle: string): string[] => digest.filter((l) => l.includes(needle)).map((l) => l.trim());

  const lines: string[] = [];
  lines.push("## COST");
  lines.push("");
  const cost = grab("cost               ");
  const lanes = digest.filter((l) => /^ {6}(DETERMINISTIC|BOUNDED_MODEL_WORKER)/.test(l)).map((l) => l.trim());
  lines.push(cost.length > 0 ? `- TOTAL — ${cost[0].replace(/^cost\s+/, "")}` : "- TOTAL — the cycle recorded no cost line, which is a defect in the run record and not a zero");
  /*
   * BY ROLE is READ from the record, never asserted. Before Level 1 this line
   * stated that no SCOUT ran, as a constant; a constant cannot notice the day
   * it stops being true.
   */
  const scouts = record.research?.scouts ?? [];
  const scoutUsd = scouts.reduce((n, s) => n + (s.cost?.usd ?? 0), 0);
  const unmeasured = scouts.filter((s) => s.cost?.usd === null || s.cost?.usd === undefined).length;
  lines.push(
    scouts.length === 0
      ? "- BY ROLE — every Attempt this cycle opened under role ACQUIRER (deterministic); no SCOUT Attempt ran this cycle" +
          (record.research ? "" : " (a record written before Level 1 carries no research section)")
      : `- BY ROLE — SCOUT ${scouts.length} Attempt(s), $${scoutUsd.toFixed(4)} measured` +
          (unmeasured > 0 ? ` (${unmeasured} unmeasured — NOT zero)` : "") +
          `; the rest ACQUIRER (deterministic)`,
  );
  for (const lane of lanes) lines.push(`- BY MODEL — ${lane}`);
  /*
   * THE CACHE LINES, FROM THE LEDGER (2026-09-06). `AttemptCost` now carries
   * cacheReadInputTokens, cacheCreationInputTokens (with its 5m/1h split),
   * uncachedInputTokens and batch, and the cycle computes the rows below from
   * its own ledger rows through the same function the window metrics use. A
   * lane whose rows all predate the fields prints NOT MEASURED by name; a
   * record written before the cycle computed the rows says so.
   */
  const cache = record.research?.cacheThisCycle;
  if (cache === undefined) {
    lines.push("- CACHE HIT RATE — NOT MEASURED: this record was written before the cycle computed cache rows from the cost ledger (2026-09-06)");
  } else if (cache === null) {
    lines.push("- CACHE HIT RATE — NOT MEASURED: the cost ledger could not be re-read at cycle end");
  } else if (cache.length === 0) {
    lines.push("- CACHE HIT RATE — no model request left a cost-ledger row this cycle");
  } else {
    for (const r of cache) for (const line of cacheRoleLines(r)) lines.push(`- ${line.trim().replace(/^cache hit rate\s+/, "CACHE HIT RATE — ")}`);
  }
  const prewarm = record.research?.lanes?.model?.prewarm;
  if (prewarm === undefined) lines.push("- PRE-WARM — not recorded on this record (the cycle predates the pre-warm, 2026-09-06)");
  else if (prewarm === null) lines.push("- PRE-WARM — none: no Scout was admitted this cycle, so nothing was warmed");
  else if (prewarm.status === "FAILED") lines.push(`- PRE-WARM — FAILED at ${prewarm.at}: ${prewarm.detail}; the Attempts ran without it`);
  else if (prewarm.status === "SKIPPED") lines.push(`- PRE-WARM — SKIPPED at ${prewarm.at} for ${prewarm.model} (${prewarm.code}): ${prewarm.detail}`);
  else
    lines.push(
      `- PRE-WARM — the static prefix (tools + system) at ${prewarm.at}: wrote ${prewarm.cacheCreationInputTokens ?? "UNMEASURED"} · read ${prewarm.cacheReadInputTokens ?? "UNMEASURED"} · ` +
        `uncached ${prewarm.uncachedInputTokens ?? "UNMEASURED"} · $${prewarm.usd === null ? "UNMEASURED" : prewarm.usd.toFixed(4)} in ${prewarm.durationMs}ms`,
    );
  return { lines };
}
