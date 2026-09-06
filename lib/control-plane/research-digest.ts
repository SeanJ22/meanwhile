/**
 * **THE RESEARCH DIGEST — the lines the runner prints and the rows the admin
 * page renders, from `ResearchMetrics`.** (Work Item 5 and 6, 2026-09-02;
 * plain meanings added for the 9.4.26 evening feedback, ADM-11.)
 *
 * Pure functions over the metrics record. `researchDigestLines` returns the
 * markdown-shaped lines `scripts/pilot-runner.mts` and the cycle script print
 * into the digest; `researchDigestRows` returns typed rows the admin research
 * page's panels render. Neither reads anything; a number that is not on the
 * metrics record does not appear here.
 *
 * Every number is printed WITH its denominator or rule, and an unmeasured
 * value prints as its named gap — never as zero and never as a dash.
 *
 * Every row also carries a MEANING (ADM-11): one plain sentence saying what
 * the number is and why the owner would care, before the rule. His words on
 * "model share, trailing window 9.1%": *"I don't even know what that number
 * represents."* The denominator column stays — it is why the number can be
 * trusted — but it cannot be the only explanation.
 */

import type { CacheHitRate, ResearchMetrics } from "./research-metrics.ts";

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

/**
 * The cache lines for one role (2026-09-06): the rate with its three counts,
 * uncached input per Attempt, the batch share, and the dollar effect of
 * caching — each with its denominator. A role whose rows all predate the cache
 * fields prints NOT MEASURED and says why.
 */
export function cacheRoleLines(r: CacheHitRate): string[] {
  const head = `  cache hit rate     ${r.role} `;
  /* A row computed before 2026-09-06 (a persisted metrics record) carries none of the ledger columns; it prints as it always did. */
  if (typeof r.measuredRows !== "number") {
    return [
      `${head}${pct(r.hitRate)} (read ${r.cacheRead} · write ${r.cacheWrite} · uncached ${r.uncachedInput}` +
        (r.repeatedPrefixTurns === null ? "; per-turn misses NOT INSTRUMENTED on these results" : `; repeated-prefix turns with zero reads ${r.repeatedPrefixMisses} of ${r.repeatedPrefixTurns}`) +
        `; ${r.attempts} Attempt(s); computed before the ledger carried cache fields — per-Attempt uncached, batch share and saving NOT MEASURED)`,
    ];
  }
  if (r.measuredRows === 0) {
    return [
      `${head}NOT MEASURED — ${r.attempts} ledger row(s), ${r.predatingRows} predate the cache fields` +
        (r.unreportedRows > 0 ? `, ${r.unreportedRows} reported no usage` : "") +
        "; a row written before the fields existed says nothing about its cache behaviour",
    ];
  }
  const perAttempt = r.uncachedPerAttempt === null ? "UNMEASURED" : `mean ${Math.round(r.uncachedPerAttempt.mean)} · max ${r.uncachedPerAttempt.max}`;
  return [
    `${head}${pct(r.hitRate)} (read ${r.cacheRead} · write ${r.cacheWrite} · uncached ${r.uncachedInput}` +
      (r.repeatedPrefixTurns === null
        ? "; per-turn columns NOT INSTRUMENTED on these results"
        : `; zero-read turns ${r.repeatedPrefixMisses} of ${r.repeatedPrefixTurns}; stationary-breakpoint turns ${r.stationaryTurns ?? 0}`) +
      `; ${r.denominator})`,
    `                     ${r.role} uncached input per Attempt ${perAttempt} over ${r.measuredRows} measured row(s)` +
      ` · batch share ${pct(r.batchShare)} of requests` +
      ` · caching saved ${usd(r.savedUsd)} (read tokens × (base − read price))` +
      (r.aggregatePricedRows > 0 ? ` · ${r.aggregatePricedRows} row(s) priced the cache write from the aggregate at the requested TTL (no split on the response)` : ""),
  ];
}

/* ------------------------------------------------------------------ rows */

export interface DigestRow {
  readonly label: string;
  readonly value: string;
  readonly denominator: string;
  /** One plain sentence: what this number is, and why it matters (ADM-11). */
  readonly meaning: string;
}

export interface ResearchDigestRows {
  readonly capacity: readonly DigestRow[];
  readonly queueBands: readonly DigestRow[];
  readonly funnel: readonly DigestRow[];
  readonly share: readonly DigestRow[];
  readonly cache: readonly DigestRow[];
  readonly costPerOutcome: readonly DigestRow[];
}

/** What each group of measures is FOR, in one sentence, for the section lead. */
export const METRIC_GROUP_MEANING: Readonly<Record<keyof ResearchDigestRows, string>> = {
  capacity: "How much scouting the daily budget buys: at what each scout attempt has been costing, this is how many attempts a day the ceiling allows.",
  queueBands: "What is waiting, sorted by who it helps first: band 1 feeds a pilot ZIP or an open red reader question, band 2 completes a source universe, band 3 is everything else.",
  funnel: "How far found records have travelled toward being trusted: scouted, then confirmed, verified, audited and approved; beside it, how many scout-found methods were validated and admitted into the toolbox.",
  share: "How much of the work needed a paid model versus plain code: a low model share means the fleet is mostly running cheap deterministic routes.",
  cache: "How much of what the model reads is a repeat it already cached: a high hit rate means the same prefix is being reused instead of paid for again.",
  costPerOutcome: "What each useful result has cost: the whole measured scout spend divided by how many results of each kind it produced.",
};

const FUNNEL_MEANING: Readonly<Record<string, string>> = {
  SCOUTED: "Obligations where a scout found something real — a route or evidence — rather than refusing.",
  CONFIRMED: "Scouted records a second, independent step confirmed.",
  VERIFIED: "Confirmed records a verifier checked against the contract and an outside authority.",
  AUDITED: "Verified records an adversarial auditor tried and failed to break.",
  APPROVED: "Audited records approved for the nightly window to promote to readers.",
  VALIDATED: "Scout-proposed methods that passed validation and await a session's admission into the method store.",
  ADMITTED: "Methods a session admitted; deterministic code can now walk that route without a model.",
  DETERMINISTIC_REPLAYS: "Times plain code re-walked a route an admitted method taught it — the payoff of the funnel.",
};

/** Typed rows for the admin research page's panels. One row per number, each with its denominator and meaning. */
export function researchDigestRows(m: ResearchMetrics): ResearchDigestRows {
  const c = m.capacity;
  const capacity: DigestRow[] = [
    {
      label: "Attempts per day the ceiling supports",
      value: c.attemptsPerDayAtCap === null ? "UNMEASURED" : String(c.attemptsPerDayAtCap),
      denominator: `$${c.ceilingUsd} ceiling at the measured mean cost; ${c.denominator}`,
      meaning: `How many scout attempts a day the $${c.ceilingUsd} daily ceiling buys at what an attempt has been costing. More means the budget goes further; the number moves when the mean cost moves.`,
    },
    {
      label: "Mean cost per Attempt",
      value: usd(c.meanUsdPerAttempt),
      denominator: c.denominator,
      meaning: "What one scout attempt has cost on average, over the attempts that reported a dollar figure in the trailing day. Attempts that reported no cost are counted beside it, never as free.",
    },
  ];
  const queueBands: DigestRow[] =
    m.ordering === null
      ? [{ label: "Queue by band", value: "NOT ORDERED", denominator: "no model-class work was due this cycle, or the order was not computed", meaning: "Nothing model-class was due this cycle, so there was no queue to sort." }]
      : ([1, 2, 3] as const).map((b) => ({
          label: `Band ${b}`,
          value: String(m.ordering?.bands[b] ?? 0),
          denominator: m.ordering?.rule ?? "",
          meaning:
            b === 1
              ? "Due work that feeds a pilot ZIP or an open red reader question — dispatched first, because a reader is waiting on it."
              : b === 2
                ? "Due work that completes a source universe (candidate enrichment, local jurisdictions, campaign finance) — dispatched second."
                : "Everything else that is due — the long tail, dispatched last.",
        }));
  const funnel: DigestRow[] = m.funnel.stages.map((s) => ({
    label: s.stage,
    value: String(s.count),
    denominator: s.source,
    meaning: FUNNEL_MEANING[s.stage] ?? `Records at the ${s.stage.toLowerCase()} stage.`,
  }));
  const s = m.share;
  const share: DigestRow[] = [
    {
      label: "Model share this cycle",
      value: pct(s.thisCycle.modelShare),
      denominator: `${s.thisCycle.model} model of ${s.thisCycle.model + s.thisCycle.deterministic} dispatched this cycle`,
      meaning: "Of everything the last cycle dispatched, the share that needed a paid model. The rest ran as plain code at no model cost.",
    },
    {
      label: "Model share, trailing window",
      value: pct(s.window.modelShare),
      denominator: `${s.window.model} model of ${s.window.model + s.window.deterministic} dispatched over ${s.window.cycles} cycle(s)`,
      meaning: `The same share over the last ${s.window.cycles} cycle(s), so one unusual cycle does not mislead. A falling share means learned methods are replacing model calls.`,
    },
  ];
  const cache: DigestRow[] =
    m.cacheByRole.length === 0
      ? [{ label: "Cache hit rate", value: "NOT MEASURED", denominator: "no cost-ledger row for a model role in the window", meaning: "No model request has left a cost-ledger row in this window, so there is nothing to compute a hit rate from." }]
      : m.cacheByRole.flatMap((r) => {
          /* A row computed before 2026-09-06 carries no ledger columns: the rate row only, as before. */
          const metered = typeof r.measuredRows === "number";
          const rate: DigestRow = {
            label: `Cache hit rate · ${r.role}`,
            value: metered && r.measuredRows === 0 ? "NOT MEASURED" : pct(r.hitRate),
            denominator: metered && r.measuredRows === 0 ? `${r.attempts} ledger row(s) predate the cache fields or reported no usage` : r.denominator,
            meaning: `Of every input token ${r.role} workers sent to the model, the share served from the prompt cache. Cached tokens cost about a tenth of fresh ones, so higher is cheaper.`,
          };
          if (!metered) return [rate];
          return [
            rate,
            {
              label: `Uncached input per Attempt · ${r.role}`,
              value: r.uncachedPerAttempt === null || r.uncachedPerAttempt === undefined ? "NOT MEASURED" : `mean ${Math.round(r.uncachedPerAttempt.mean)} · max ${r.uncachedPerAttempt.max}`,
              denominator: `${r.measuredRows} measured ledger row(s)`,
              meaning: "How many tokens each attempt paid for at the full price. With the moving breakpoint working this is a few tokens per turn; a growing number is the conversation being re-sent.",
            },
            {
              label: `Caching saved · ${r.role}`,
              value: usd(r.savedUsd ?? null),
              denominator: "read tokens × (base input price − cache read price) at the role's model rate",
              meaning: "What the cache reads would have cost at the full input price, minus what they cost as reads. The dollar effect of caching in this window.",
            },
            {
              label: `Batch share · ${r.role}`,
              value: pct(r.batchShare ?? null),
              denominator: "requests served through the Message Batches API, over requests, on measured rows",
              meaning: "The share of this role's requests that went through the half-price Batches API. Zero until a lane's batch flag is switched on.",
            },
          ];
        });
  cache.push({
    label: "Cache defects",
    value: `${m.cacheDefects.defective} of ${m.cacheDefects.instrumented}` + (m.cacheDefects.stationary === undefined ? "" : ` (stationary ${m.cacheDefects.stationary}, zero-read ${m.cacheDefects.zeroRead ?? 0})`),
    denominator: "results carrying per-turn steps that recorded a stationary-breakpoint turn or a zero-read turn",
    meaning: "Attempts where a later turn should have hit the cache and did not — each one is money spent twice on the same text. Zero is the goal.",
  });
  const costPerOutcome: DigestRow[] = m.costPerOutcome.map((o) => ({
    label: `Cost per ${o.outcome}`,
    value: `${usd(o.usdPerOutcome)} (${o.count})`,
    denominator: o.denominator,
    meaning:
      o.outcome === "ROUTE_CANDIDATE"
        ? "What each newly found route has cost, spreading the whole measured scout spend over the routes found."
        : o.outcome === "EVIDENCE_FOUND"
          ? "What each piece of found evidence has cost, over the whole measured scout spend."
          : o.outcome === "CONFIRMED"
            ? "What each confirmed record has cost. Not recorded until the promotion pipeline confirms something."
            : "What each method that graduated into the toolbox has cost — the spend that keeps paying back.",
  }));
  return { capacity, queueBands, funnel, share, cache, costPerOutcome };
}
