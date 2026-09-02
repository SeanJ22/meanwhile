/**
 * **THE RESEARCH DIGEST — the lines the runner prints and the rows the admin
 * page renders, from `ResearchMetrics`.** (Work Item 5 and 6, 2026-09-02.)
 *
 * Pure functions over the metrics record. `researchDigestLines` returns the
 * markdown-shaped lines `scripts/pilot-runner.mts` and the cycle script print
 * into the digest; `researchDigestRows` returns typed rows the admin research
 * page's panels render. Neither reads anything; a number that is not on the
 * metrics record does not appear here.
 *
 * Every number is printed WITH its denominator or rule, and an unmeasured
 * value prints as its named gap — never as zero and never as a dash.
 */

import type { ResearchMetrics } from "./research-metrics.ts";

const pct = (v: number | null): string => (v === null ? "UNMEASURED" : `${(v * 100).toFixed(1)}%`);
const usd = (v: number | null): string => (v === null ? "UNMEASURED" : `$${v.toFixed(4)}`);

export function researchDigestLines(m: ResearchMetrics): string[] {
  const c = m.capacity;
  const lines: string[] = [
    "RESEARCH METRICS (RULING 229 ordering · RULING 244 efficiency)",
    `  capacity           ${c.attemptsPerDayAtCap === null ? "UNMEASURED — no measured Scout Attempt in the window" : `${c.attemptsPerDayAtCap} Attempt(s)/day at the $${c.ceilingUsd} ceiling`}` +
      ` · mean ${usd(c.meanUsdPerAttempt)}/Attempt over ${c.denominator}`,
  ];
  if (m.ordering === null) {
    lines.push("  queue by band      NOT ORDERED this cycle (no model-class work was due, or the order was not computed)");
  } else {
    const o = m.ordering;
    lines.push(
      `  queue by band      band 1 ${o.bands[1]} · band 2 ${o.bands[2]} · band 3 ${o.bands[3]} (${o.appliesTo}; ${o.rule})`,
      `  ordering inputs    readerImpactAt; ${o.inputs.pilotJurisdictions}; open red reader questions ${o.inputs.openRedQuestions.count}` +
        (o.inputs.openRedQuestions.zips.length > 0 ? ` (ZIPs ${o.inputs.openRedQuestions.zips.join(", ")})` : "") +
        (o.inputs.openRedQuestions.run ? ` from ${o.inputs.openRedQuestions.run}` : "") +
        `; universe providers ${o.inputs.universeProviders.join(", ")}; tie-break ${o.inputs.tieBreak}`,
    );
  }
  lines.push(`  funnel             ${m.funnel.stages.map((s) => `${s.stage} ${s.count}`).join(" -> ")} (pipeline stages: ${m.funnel.pipelineSource})`);
  const s = m.share;
  lines.push(
    `  model share        this cycle ${pct(s.thisCycle.modelShare)} (${s.thisCycle.model} model / ${s.thisCycle.deterministic} deterministic)` +
      ` · trailing window ${pct(s.window.modelShare)} over ${s.window.cycles} cycle(s)${s.window.since ? ` since ${s.window.since}` : ""}` +
      ` · delta ${s.delta === null ? "UNMEASURED" : `${s.delta >= 0 ? "+" : ""}${(s.delta * 100).toFixed(1)} pt`}`,
  );
  if (m.cacheByRole.length === 0) {
    lines.push("  cache hit rate     NOT MEASURED — no Scout result reports usage");
  } else {
    for (const r of m.cacheByRole) {
      lines.push(
        `  cache hit rate     ${r.role} ${pct(r.hitRate)} (read ${r.cacheRead} · write ${r.cacheWrite} · uncached ${r.uncachedInput}` +
          (r.repeatedPrefixTurns === null
            ? "; per-turn misses NOT INSTRUMENTED on these results"
            : `; repeated-prefix turns with zero reads ${r.repeatedPrefixMisses} of ${r.repeatedPrefixTurns}`) +
          `; ${r.attempts} Attempt(s))`,
      );
    }
  }
  lines.push(
    `  cache defects      ${m.cacheDefects.defective} of ${m.cacheDefects.instrumented} instrumented result(s) recorded a repeated-prefix turn with zero cache reads`,
    `  cost per outcome   ${m.costPerOutcome.map((o) => `${o.outcome} ${usd(o.usdPerOutcome)} (${o.count})`).join(" · ")}`,
    `                     ${m.costPerOutcome[0]?.denominator ?? "no outcome recorded"}`,
  );
  return lines;
}

/* ------------------------------------------------------------------ rows */

export interface DigestRow {
  readonly label: string;
  readonly value: string;
  readonly denominator: string;
}

export interface ResearchDigestRows {
  readonly capacity: readonly DigestRow[];
  readonly queueBands: readonly DigestRow[];
  readonly funnel: readonly DigestRow[];
  readonly share: readonly DigestRow[];
  readonly cache: readonly DigestRow[];
  readonly costPerOutcome: readonly DigestRow[];
}

/** Typed rows for the admin research page's panels. One row per number, each with its denominator. */
export function researchDigestRows(m: ResearchMetrics): ResearchDigestRows {
  const c = m.capacity;
  const capacity: DigestRow[] = [
    {
      label: "Attempts per day the ceiling supports",
      value: c.attemptsPerDayAtCap === null ? "UNMEASURED" : String(c.attemptsPerDayAtCap),
      denominator: `$${c.ceilingUsd} ceiling at the measured mean cost; ${c.denominator}`,
    },
    { label: "Mean cost per Attempt", value: usd(c.meanUsdPerAttempt), denominator: c.denominator },
  ];
  const queueBands: DigestRow[] =
    m.ordering === null
      ? [{ label: "Queue by band", value: "NOT ORDERED", denominator: "no model-class work was due this cycle, or the order was not computed" }]
      : ([1, 2, 3] as const).map((b) => ({
          label: `Band ${b}`,
          value: String(m.ordering?.bands[b] ?? 0),
          denominator: m.ordering?.rule ?? "",
        }));
  const funnel: DigestRow[] = m.funnel.stages.map((s) => ({ label: s.stage, value: String(s.count), denominator: s.source }));
  const s = m.share;
  const share: DigestRow[] = [
    { label: "Model share this cycle", value: pct(s.thisCycle.modelShare), denominator: `${s.thisCycle.model} model of ${s.thisCycle.model + s.thisCycle.deterministic} dispatched this cycle` },
    { label: "Model share, trailing window", value: pct(s.window.modelShare), denominator: `${s.window.model} model of ${s.window.model + s.window.deterministic} dispatched over ${s.window.cycles} cycle(s)` },
  ];
  const cache: DigestRow[] =
    m.cacheByRole.length === 0
      ? [{ label: "Cache hit rate", value: "NOT MEASURED", denominator: "no Scout result reports usage" }]
      : m.cacheByRole.map((r) => ({ label: `Cache hit rate · ${r.role}`, value: pct(r.hitRate), denominator: r.denominator }));
  cache.push({
    label: "Cache defects",
    value: `${m.cacheDefects.defective} of ${m.cacheDefects.instrumented}`,
    denominator: "results carrying per-turn steps that recorded a repeated-prefix turn with zero cache reads",
  });
  const costPerOutcome: DigestRow[] = m.costPerOutcome.map((o) => ({
    label: `Cost per ${o.outcome}`,
    value: `${usd(o.usdPerOutcome)} (${o.count})`,
    denominator: o.denominator,
  }));
  return { capacity, queueBands, funnel, share, cache, costPerOutcome };
}
