import { count as thousands, plainCode, usdCents } from "./plain-words.ts";
import { PIPELINE_STAGES, type CacheHitRate, type ResearchMetrics } from "./research-metrics.ts";

const pct = (v: number | null): string => (v === null ? "UNMEASURED" : `${(v * 100).toFixed(1)}%`);
/** The runner's own digest keeps four places; it is a machine record, not a face. */
const usd = (v: number | null): string => (v === null ? "UNMEASURED" : `$${v.toFixed(4)}`);
/** Dollars to the cent, with the sentinel preserved for the gap. */
const money = (v: number | null | undefined): string => (v === null || v === undefined ? "UNMEASURED" : usdCents(v));

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

export interface DigestRow {
  readonly label: string;
  readonly value: string;
  /** How it is counted, in ordinary English. Never a code path. */
  readonly denominator: string;
  /** One plain sentence: what this number is, and why it matters. */
  readonly meaning: string;
  /** The instrument's own words for the denominator, for the disclosure; present only where the plain sentence replaced them. */
  readonly technical?: string;
}

export interface ResearchDigestRows {
  readonly capacity: readonly DigestRow[];
  readonly queueBands: readonly DigestRow[];
  readonly funnel: readonly DigestRow[];
  readonly share: readonly DigestRow[];
  readonly cache: readonly DigestRow[];
  readonly costPerOutcome: readonly DigestRow[];
}

export const METRIC_GROUP_MEANING: Readonly<Record<keyof ResearchDigestRows, string>> = {
  /* What a group is for, never changing; `metricGroupLead` says what it currently reads. Band definitions live only in the lead. */
  capacity: "Why this matters: it is the ceiling on how much genuinely new ground the fleet can cover in a day, and it moves when the cost of an attempt moves.",
  queueBands: "Why the order matters: only a handful of paid attempts run each day, so which ones go first decides what a reader can see next.",
  funnel: "How far found records have travelled toward being trusted: scouted, then confirmed, verified, audited and approved; beside it, how many scout-found methods were validated and admitted into the toolbox.",
  share: "How much of the work needed a paid model versus plain code: a low model share means the fleet is mostly running cheap deterministic routes.",
  cache: "How much of what the model reads is a repeat it already cached: a high hit rate means the same prefix is being reused instead of paid for again.",
  costPerOutcome: "What each useful result has cost: the whole measured scout spend divided by how many results of each kind it produced.",
};

/** Why a stage stands at zero, in plain English. */
/** Each useful outcome as the thing it is, so the cost row is not "Cost per ROUTE_CANDIDATE". */
export const OUTCOME_LABEL: Readonly<Record<string, string>> = {
  ROUTE_CANDIDATE: "new way in",
  EVIDENCE_FOUND: "document obtained",
  CONFIRMED: "confirmed record",
  GRADUATED_ROUTE: "method added to the toolbox",
};

export const FUNNEL_LABEL: Readonly<Record<string, string>> = {
  SCOUTED: "Found by a hunter",
  CONFIRMED: "Confirmed a second time",
  VERIFIED: "Checked against the source",
  AUDITED: "Survived an audit",
  APPROVED: "Cleared to publish",
  VALIDATED: "Methods that passed validation",
  ADMITTED: "Methods admitted to the toolbox",
  DETERMINISTIC_REPLAYS: "Repeat runs without a model",
};

const FUNNEL_DENOMINATOR: Readonly<Record<string, string>> = {
  SCOUTED: "counted from the separate jobs where a hunter came back with something real rather than a refusal",
  CONFIRMED: "counted by the promotion pipeline once it is connected to this view",
  VERIFIED: "counted by the promotion pipeline once it is connected to this view",
  AUDITED: "counted by the promotion pipeline once it is connected to this view",
  APPROVED: "counted by the promotion pipeline once it is connected to this view",
  VALIDATED: "counted from the methods hunters proposed and validators passed",
  ADMITTED: "counted from the methods a work session admitted into the toolbox",
  DETERMINISTIC_REPLAYS: "counted from the cycles where ordinary code re-walked a route an admitted method taught it",
};

/** A pipeline stage whose counter has never reported is disconnected, not empty. */
function stageDisconnected(stage: string, source: string): boolean {
  return (PIPELINE_STAGES as readonly string[]).includes(stage) && /none recorded/i.test(source);
}

/** Why this stage stands at the number it stands at. Empty when the number is not zero. */
function funnelWhyZero(stage: string, count: number, source: string, m: ResearchMetrics): string {
  if (count !== 0) return "";
  if (stageDisconnected(stage, source)) {
    return " Not counted yet — this stage's data is not connected to this view, so the zero is a missing connection and not a finding that nothing passed.";
  }
  if (stage === "SCOUTED") return " Zero because no hunter has yet come back from one of these jobs with a usable result.";
  if (stage === "ADMITTED") {
    const validated = m.funnel.stages.find((s) => s.stage === "VALIDATED")?.count ?? 0;
    return validated > 0
      ? ` Zero because admitting a method into the toolbox is a work session's decision, and none of the ${validated} that passed validation has been admitted yet.`
      : " Zero because nothing has passed validation yet, so there is nothing to admit.";
  }
  if (stage === "DETERMINISTIC_REPLAYS") {
    const admitted = m.funnel.stages.find((s) => s.stage === "ADMITTED")?.count ?? 0;
    return admitted === 0
      ? " Zero because no method has been admitted, so there is nothing for ordinary code to replay."
      : " Zero because no cycle has re-walked one of those routes since the method was admitted.";
  }
  return " Zero: nothing has reached this stage yet.";
}

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

export function researchDigestRows(m: ResearchMetrics): ResearchDigestRows {
  const c = m.capacity;
  const capacity: DigestRow[] = [
    {
      label: "Attempts per day the ceiling supports",
      value: c.attemptsPerDayAtCap === null ? "UNMEASURED" : String(c.attemptsPerDayAtCap),
      denominator: `the $${c.ceilingUsd} daily limit divided by what a scout attempt has been costing`,
      technical: `$${c.ceilingUsd} ceiling at the measured mean cost; ${c.denominator}`,
      meaning: `How many scout attempts a day the $${c.ceilingUsd} daily ceiling buys at what an attempt has been costing. More means the budget goes further; the number moves when the mean cost moves.`,
    },
    {
      label: "Mean cost per Attempt",
      value: money(c.meanUsdPerAttempt),
      denominator: `averaged over the ${c.measuredAttempts} scout attempt(s) in the last ${c.windowHours} hours that reported a cost; ${c.unmeasuredAttempts} reported none and are counted beside them, never as free`,
      technical: c.denominator,
      meaning: "What one scout attempt has cost on average, over the attempts that reported a dollar figure in the trailing day. Attempts that reported no cost are counted beside it, never as free.",
    },
  ];
  const queueBands: DigestRow[] =
    m.ordering === null
      ? [{ label: "Queue by band", value: "NOT ORDERED", denominator: "no model-class work was due this cycle, or the order was not computed", meaning: "Nothing model-class was due this cycle, so there was no queue to sort." }]
      : /* Band definitions are stated once, in the group's lead. */
        ([1, 2, 3] as const).map((b) => ({
          label: `Band ${b}`,
          value: String(m.ordering?.bands[b] ?? 0),
          denominator: "counted from the work that was due when the last cycle sorted its queue",
          technical: m.ordering === null ? "" : `${m.ordering.rule} — ${m.ordering.scope}`,
          meaning:
            b === 1
              ? "How much of the waiting work a reader is actually held up by. This is what the next cycle starts on."
              : b === 2
                ? "How much of the waiting work finishes a whole class of source rather than one record inside it."
                : "Everything else that is waiting. It moves only once the two bands above it are clear.",
        }));
  const funnel: DigestRow[] = m.funnel.stages.map((s) => {
    const stated = FUNNEL_DENOMINATOR[s.stage];
    return {
      label: FUNNEL_LABEL[s.stage] ?? s.stage.toLowerCase().replaceAll("_", " "),
      value: String(s.count),
      denominator: stated === undefined ? s.source : stated,
      meaning:
        (FUNNEL_MEANING[s.stage] ?? `How many records have reached the ${s.stage.toLowerCase().replaceAll("_", " ")} step of the pipeline.`) +
        funnelWhyZero(s.stage, s.count, s.source, m),
      technical: `${s.stage} — ${s.source}`,
    };
  });
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
      ? [{ label: "Cache hit rate", value: "NOT MEASURED", denominator: "no paid model request was billed in this window, so there is nothing to divide", technical: "no cost-ledger row for a model role in the window", meaning: "No model request has been billed in this window, so there is nothing to compute a hit rate from. That is a missing measurement, not a rate of zero." }]
      : m.cacheByRole.flatMap((r) => {
          /* A persisted row without the ledger columns: the rate row only. */
          const metered = typeof r.measuredRows === "number";
          const who = plainCode(r.role);
          const rate: DigestRow = {
            label: `Cache hit rate · ${who}`,
            value: metered && r.measuredRows === 0 ? "NOT MEASURED" : pct(r.hitRate),
            denominator:
              metered && r.measuredRows === 0
                ? `all ${r.attempts} billed request(s) for this role were recorded before the cache was measured, or reported no usage`
                : "cached input tokens over every input token this role sent to the model",
            technical: r.denominator,
            meaning: `Of every input token ${who} workers sent to the model, the share served from the prompt cache. Cached tokens cost about a tenth of fresh ones, so higher is cheaper.`,
          };
          if (!metered) return [rate];
          return [
            rate,
            {
              label: `Uncached input per attempt · ${who}`,
              value: r.uncachedPerAttempt === null || r.uncachedPerAttempt === undefined ? "NOT MEASURED" : `mean ${Math.round(r.uncachedPerAttempt.mean)} · max ${r.uncachedPerAttempt.max}`,
              denominator: `averaged over the ${r.measuredRows} billed request(s) whose usage was reported`,
              meaning: "How many tokens each attempt paid for at the full price. With the moving breakpoint working this is a few tokens per turn; a growing number is the conversation being re-sent.",
            },
            {
              label: `Caching saved · ${who}`,
              value: money(r.savedUsd ?? null),
              denominator: "what the cached tokens would have cost at full price, minus what they cost as cache reads",
              technical: "read tokens × (base input price − cache read price) at the role's model rate",
              meaning: "What the cache reads would have cost at the full input price, minus what they cost as reads. The dollar effect of caching in this window.",
            },
            {
              label: `Batch share · ${who}`,
              value: pct(r.batchShare ?? null),
              denominator: "requests sent the cheaper batched way, over every request whose usage was reported",
              technical: "requests served through the Message Batches API, over requests, on measured rows",
              meaning: "The share of this role's requests that went through the half-price Batches API. Zero until a lane's batch flag is switched on.",
            },
          ];
        });
  cache.push({
    label: "Cache defects",
    value: `${m.cacheDefects.defective} of ${m.cacheDefects.instrumented}` + (m.cacheDefects.stationary === undefined ? "" : ` (stationary ${m.cacheDefects.stationary}, zero-read ${m.cacheDefects.zeroRead ?? 0})`),
    denominator: "attempts whose step-by-step record shows a turn that paid twice for text it had already sent",
    technical: "results carrying per-turn steps that recorded a stationary-breakpoint turn or a zero-read turn",
    meaning: "Attempts where a later turn should have hit the cache and did not — each one is money spent twice on the same text. Zero is the goal.",
  });
  const costPerOutcome: DigestRow[] = m.costPerOutcome.map((o) => ({
    label: `Cost per ${OUTCOME_LABEL[o.outcome] ?? o.outcome.toLowerCase().replaceAll("_", " ")}`,
    value: o.count === 0 ? "none of these yet" : `${money(o.usdPerOutcome)} each, over ${o.count}`,
    denominator:
      o.count === 0
        ? "nothing of this kind has been produced yet, so there is nothing to divide the spend by"
        : "the whole measured scout spend divided by how many of this kind came out of it",
    technical: o.denominator,
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

/** The sentence above each group, computed from the numbers. */
export function metricGroupLead(m: ResearchMetrics): Readonly<Record<keyof ResearchDigestRows, string | null>> {
  const c = m.capacity;
  const capacity =
    c.attemptsPerDayAtCap === null || c.meanUsdPerAttempt === null
      ? `Not measured yet: none of the ${c.measuredAttempts + c.unmeasuredAttempts} scout attempt(s) in the last ${c.windowHours} hours reported what it cost, so the daily limit cannot be turned into a number of attempts. It is not that the budget buys nothing.`
      : `The ${usdCents(c.ceilingUsd)} daily budget buys about ${thousands(c.attemptsPerDayAtCap)} scout attempts at ${usdCents(c.meanUsdPerAttempt)} each.`;

  const bands =
    m.ordering === null
      ? "Nothing that needs a model was due this cycle, so there was no queue to sort."
      : "Band 1 is work a reader is waiting on. Band 2 finishes a whole class of source. Band 3 is everything else. Inside a band, the oldest thing due goes first.";

  const thisCycleTotal = m.share.thisCycle.model + m.share.thisCycle.deterministic;
  const share =
    thisCycleTotal === 0
      ? "0% model work this cycle — nothing was dispatched at all, so there was nothing to split between a paid model and plain code."
      : m.share.thisCycle.model === 0
        ? `0% model work this cycle — all ${thousands(thisCycleTotal)} job(s) ran as plain code, which is the cheap path and the point of the funnel.`
        : `${((m.share.thisCycle.model / thisCycleTotal) * 100).toFixed(1)}% of this cycle's ${thousands(thisCycleTotal)} job(s) needed a paid model; the rest ran as plain code.`;

  const disconnected = m.funnel.stages.filter((s) => stageDisconnected(s.stage, s.source)).length;
  const scouted = m.funnel.stages.find((s) => s.stage === "SCOUTED")?.count ?? 0;
  const funnel =
    disconnected === 0
      ? `${thousands(scouted)} job(s) have produced something real; every stage below is counted from a connected source.`
      : `${thousands(scouted)} job(s) have produced something real. ${disconnected} of the stages below are not connected to this view yet, so their zeros mean "not counted here", not "nothing got through".`;

  const cache =
    m.cacheByRole.length === 0
      ? "No paid model request has been billed in this window, so there is no hit rate to compute. That is a missing measurement, not a rate of zero."
      : null;

  const priced = m.costPerOutcome.filter((o) => o.usdPerOutcome !== null).length;
  const costPerOutcome =
    priced === 0
      ? "Nothing useful has been produced and priced yet, so there is no cost per outcome to show. Every row below says which of the two it is."
      : null;

  return { capacity, queueBands: bands, funnel, share, cache, costPerOutcome };
}
