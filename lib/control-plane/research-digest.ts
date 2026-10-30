import { type CacheHitRate, type ResearchMetrics } from "./research-metrics.ts";

const pct = (v: number | null): string => (v === null ? "UNMEASURED" : `${(v * 100).toFixed(1)}%`);
/** The runner's own digest keeps four places; it is a machine record, not a face. */
const usd = (v: number | null): string => (v === null ? "UNMEASURED" : `$${v.toFixed(4)}`);

export function researchDigestLines(m: ResearchMetrics): string[] {
  const c = m.capacity;
  const lines: string[] = [
    "RESEARCH METRICS (ordering · efficiency)",
    `  capacity           ${c.attemptsPerDayAtCap === null ? "UNMEASURED — no measured Scout Attempt in the window" : `${c.attemptsPerDayAtCap} Attempt(s)/day at the $${c.ceilingUsd} ceiling`}` +
      ` · mean ${usd(c.meanUsdPerAttempt)}/Attempt over ${c.denominator}`,
  ];
  if (m.ordering === null) {
    lines.push("  queue by band      NOT ORDERED this cycle (no model-class work was due, or the order was not computed)");
  } else {
    const o = m.ordering;
    lines.push(
      `  queue by band      band 1 ${o.bands[1]} · band 2 ${o.bands[2]} · band 3 ${o.bands[3]} (${o.appliesTo}; ${o.rule})`,
      `  ordering inputs    ${o.inputs.readerImpactAt}; ` +
        `universe providers ${o.inputs.universeProviders.join(", ")}; tie-break ${o.inputs.tieBreak}`,
    );
  }
  lines.push(`  funnel             ${m.funnel.stages.map((s) => `${s.stage} ${s.count}`).join(" -> ")} (pipeline stages: ${m.funnel.pipelineSource})`);
  const s = m.share;
  lines.push(
    `  model share        this cycle ${pct(s.thisCycle.modelShare)} (${s.thisCycle.model} model / ${s.thisCycle.deterministic} deterministic)` +
      ` · trailing window ${pct(s.window.modelShare)} over ${s.window.cycles} cycle(s)${s.window.since ? ` since ${s.window.since}` : ""}` +
      ` · delta ${s.delta === null ? "UNMEASURED" : `${s.delta >= 0 ? "+" : ""}${(s.delta * 100).toFixed(1)} pt`}`,
  );
  const window = m.cacheWindow ? ` in the window ${m.cacheWindow.sinceIso ?? "(open)"} → ${m.cacheWindow.untilIso ?? "(now)"}` : "";
  if (m.cacheByRole.length === 0) {
    lines.push(`  cache hit rate     NOT MEASURED — no cost-ledger row for a model role${window}`);
  } else {
    for (const r of m.cacheByRole) lines.push(...cacheRoleLines(r));
  }
  const d = m.cacheDefects;
  lines.push(
    `  cache defects      ${d.defective} of ${d.instrumented} instrumented result(s) recorded a cache defect` +
      (d.stationary === undefined ? "" : ` (stationary breakpoint ${d.stationary}; zero reads ${d.zeroRead ?? 0})`),
    `  cost per outcome   ${m.costPerOutcome.map((o) => `${o.outcome} ${usd(o.usdPerOutcome)} (${o.count})`).join(" · ")}`,
    `                     ${m.costPerOutcome[0]?.denominator ?? "no outcome recorded"}`,
  );
  return lines;
}

/** Each figure with its denominator. A role whose rows predate the cache fields prints the rate row only. */
export function cacheRoleLines(r: CacheHitRate): string[] {
  const head = `  cache hit rate     ${r.role} `;
  /* A persisted row without the ledger columns prints as before. */
  if (typeof r.measuredRows !== "number") {
    return [
      `${head}${pct(r.hitRate)} (read ${r.cacheRead} · write ${r.cacheWrite} · uncached ${r.uncachedInput}` +
        (r.repeatedPrefixTurns === null ? "; per-turn misses NOT INSTRUMENTED on these results" : `; repeated-prefix turns with zero reads ${r.repeatedPrefixMisses} of ${r.repeatedPrefixTurns}`) +
        `; ${r.attempts} Attempt(s); computed before the ledger carried cache fields — per-Attempt uncached, batch share and saving NOT MEASURED)`,
    ];
  }
  if (r.measuredRows === 0) {
    return [
      `${head}NOT MEASURED — ${r.attempts} ledger row(s), ${r.predatingRows ?? 0} predate the cache fields` +
        ((r.unreportedRows ?? 0) > 0 ? `, ${r.unreportedRows} reported no usage` : "") +
        "; a row written before the fields existed says nothing about its cache behaviour",
    ];
  }
  const per = r.uncachedPerAttempt ?? null;
  const perAttempt = per === null ? "UNMEASURED" : `mean ${Math.round(per.mean)} · max ${per.max}`;
  const aggregatePriced = r.aggregatePricedRows ?? 0;
  return [
    `${head}${pct(r.hitRate)} (read ${r.cacheRead} · write ${r.cacheWrite} · uncached ${r.uncachedInput}` +
      (r.repeatedPrefixTurns === null
        ? "; per-turn columns NOT INSTRUMENTED on these results"
        : `; zero-read turns ${r.repeatedPrefixMisses} of ${r.repeatedPrefixTurns}; stationary-breakpoint turns ${r.stationaryTurns ?? 0}`) +
      `; ${r.denominator})`,
    `                     ${r.role} uncached input per Attempt ${perAttempt} over ${r.measuredRows} measured row(s)` +
      ` · batch share ${pct(r.batchShare ?? null)} of requests` +
      ` · caching saved ${usd(r.savedUsd ?? null)} (read tokens × (base − read price))` +
      (aggregatePriced > 0 ? ` · ${aggregatePriced} row(s) priced the cache write from the aggregate at the requested TTL (no split on the response)` : ""),
  ];
}

