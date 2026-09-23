/**
 * `dispatch-work-dry-run` — WHAT SENDING THE FLEET TO A GEOGRAPHY WOULD CREATE,
 * READ FROM PRODUCTION AND WRITTEN NOWHERE. (MW-028, 2026-09-23.)
 *
 * Plans the MW-028 step (`lib/control-plane/expansion/dispatch-work.ts`) for
 * one or more county geographies exactly as the standing runner would, over
 * production's own data, and prints the receipt: created, reordered and
 * blocked, each with its denominator. Nothing is applied.
 *
 * READ-ONLY, enforced by the database: every statement runs inside a
 * `READ ONLY` transaction, on the production data plane
 * (`WTP_PRODUCTION_DATABASE_URL_READONLY`: the promoted operational-reference
 * registries and the published Census geography lookup) and on the control
 * plane (`WTP_CONTROL_PLANE_DATABASE_URL`: the obligation rows, the owner's
 * policy row, the research state). The committed Census unit territories are
 * read from the working tree. Variable NAMES only; no value is ever printed.
 *
 * ```
 *   node --env-file=<checkout>/.env.local --experimental-strip-types \
 *        scripts/dispatch-work-dry-run.mts [--county=04019] [--county=08013]
 * ```
 *
 * With no `--county`, it plans Pima County, Arizona (a registered state) and
 * Boulder County, Colorado (a state with no promoted registry).
 */

import { neon } from "@neondatabase/serverless";

import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import {
  installOperationalReferenceBundle,
  type OperationalReferenceBundle,
} from "../lib/civic-data/operational-references.ts";
import {
  dispatchWorkReading,
  dispatchWorkSentence,
  planDispatchWork,
  scopeWorkTarget,
  type DispatchWorkTarget,
  type DurableRowFacts,
} from "../lib/control-plane/expansion/dispatch-work.ts";
import type { PlannedScope } from "../lib/control-plane/expansion/membership.ts";
import { readTerritoryIndex } from "../lib/control-plane/expansion/runner-load.ts";
import { scopeKeyOf, type ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { fleetSpendCeilingOverrideUsd, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { resolveRollingCeiling } from "../lib/control-plane/fleet-safety.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import {
  UNREAD_MEETING_PARTITIONS,
  trackedStatesFromOperationalReference,
} from "../lib/control-plane/scheduler/provider-inputs.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { meetingsDiscoveryProvider } from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import { OWNER_DISPATCH } from "../lib/control-plane/scheduler/obligation.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const NOW = new Date().toISOString();
const redact = (s: string): string => s.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection string redacted>");

function urlOf(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") {
    console.error(`dispatch-work-dry-run · ${name} is not set; run with --env-file pointing at the checkout's .env.local.`);
    process.exit(1);
  }
  return value;
}

/** Every statement in one READ ONLY transaction: Postgres itself refuses a write. */
async function readOnly(url: string, queries: Readonly<Record<string, string>>): Promise<Record<string, Record<string, unknown>[]>> {
  const sql = neon(url);
  const names = Object.keys(queries);
  const results = await sql.transaction(names.map((name) => sql.query(queries[name])), { readOnly: true });
  return Object.fromEntries(names.map((name, i) => [name, results[i] as unknown as Record<string, unknown>[]]));
}

const counties = process.argv.slice(2).filter((a) => a.startsWith("--county=")).map((a) => a.slice("--county=".length));
const GEOIDS = counties.length > 0 ? counties : ["04019", "08013"];

try {
  /* ---------------------------------------------------- the production data plane */
  const data = await readOnly(urlOf("WTP_PRODUCTION_DATABASE_URL_READONLY"), {
    reference: `SELECT current_version_id AS version, payload FROM civic_data_promotions WHERE record_class = 'OPERATIONAL_REFERENCE' AND scope = 'US:covered-jurisdiction-routing:v1'`,
    geography: `SELECT current_version_id AS version, payload FROM civic_data_promotions WHERE record_class = 'CENSUS_GEOGRAPHY' AND scope = 'US:zcta-geography-overlaps'`,
  });
  const reference = data.reference[0];
  const geography = data.geography[0];
  if (reference === undefined || geography === undefined) throw new Error("a promoted pointer this dry run needs is not recorded");
  const bundle = reference.payload as OperationalReferenceBundle;
  installOperationalReferenceBundle(bundle);
  const lookup = createLookup(geography.payload as BuiltDataset, String(geography.version));
  console.log(`production data plane: operational reference ${String(reference.version)} (${Object.keys(bundle.registries).sort().join(", ")}); Census geography ${String(geography.version)}`);

  /* ---------------------------------------------------------- the control plane */
  const control = await readOnly(urlOf("WTP_CONTROL_PLANE_DATABASE_URL"), {
    rows: `SELECT id, value->>'active' AS active, value->>'materializedBy' AS marked FROM cp_obligations ORDER BY id`,
    config: `SELECT value FROM cp_admin_config WHERE id = 'current'`,
    research: `SELECT value->>'modelLaneDisabledReason' AS closed, value->>'pausedByOwner' AS paused FROM cp_research_state WHERE id = 'level-1'`,
  });
  const durable = new Map<string, DurableRowFacts>();
  const materialized = new Set<string>();
  for (const row of control.rows) {
    const marked = row.marked === OWNER_DISPATCH ? OWNER_DISPATCH : undefined;
    durable.set(String(row.id), { active: row.active === "true", ...(marked ? { materializedBy: marked } : {}) });
    if (marked) materialized.add(String(row.id));
  }
  const config = control.config[0]?.value;
  const ceiling = resolveRollingCeiling(isAdminConfig(config) ? fleetSpendCeilingOverrideUsd(config) : null);
  const laneClosed = (control.research[0]?.closed as string | null | undefined) ?? null;
  const noRows = "the control plane holds no obligation row, which a standing runner never leaves";
  const active = [...durable.values()].filter((r) => r.active).length;
  console.log(
    `control plane: ${floorLine(floored("active obligation rows", "cp_obligations", control.rows.length, active, noRows))}; ` +
      `${floorLine(floored("rows a dispatch materialized", "cp_obligations", control.rows.length, materialized.size, noRows))}; ` +
      `ceiling $${ceiling.rollingCeilingUsd.toFixed(2)} (${ceiling.source}); paid lane ${laneClosed === null ? "open" : `closed: ${laneClosed}`}` +
      `${control.research[0]?.paused === "true" ? "; the owner's research PAUSE stands" : ""}`,
  );

  /* ------------------------------------------------ the corpus, as the runner builds it */
  const registry = buildRegistry(
    [
      localJurisdictionsProvider({ trackedStates: trackedStatesFromOperationalReference(), materialized: () => ({ ids: materialized }), meetingPartitions: UNREAD_MEETING_PARTITIONS }),
      meetingsDiscoveryProvider({ materialized: () => ({ ids: materialized }) }),
    ],
    { root: ROOT, nowIso: NOW },
  );
  const emitted = new Set(registry.units.map((u) => u.obligation.id));
  /* The other providers' corpus is what they registered: their active rows, which only a live provider pass could narrow further. */
  const corpus = [
    ...registry.units.map((u) => ({ id: u.obligation.id, subjectId: u.obligation.subjectId })),
    ...control.rows
      .filter((r) => r.active === "true" && !String(r.id).startsWith("freshness:jurisdiction:") && !String(r.id).startsWith("freshness:meetings-discovery:") && !emitted.has(String(r.id)))
      .map((r) => ({ id: String(r.id), subjectId: (/^freshness:[^:]+:([^#]+)#/.exec(String(r.id))?.[1] ?? String(r.id)) })),
  ];
  const registries = new Map(Object.entries(bundle.registries).map(([state, reg]) => [state.toLowerCase(), reg] as const));
  const territory = readTerritoryIndex(ROOT, [...registries.values()]);

  /* ------------------------------------------------------- the geographies, planned */
  const targets: DispatchWorkTarget[] = [];
  for (const geoid of GEOIDS) {
    const result = await lookup.zctasForGrouping({ type: "county", geoid, version: "county:2020" });
    const g = result.geography;
    const decision: ExpansionScopeDecision = {
      key: scopeKeyOf({ version: "county:2020", geoid }),
      geography: { type: "county", geoid, version: "county:2020", label: g?.label ?? geoid, stateAbbr: g?.stateAbbr ?? "??" },
      priority: targets.length + 1,
      budgetUsd: 0,
      note: "dry run: never written",
      decidedAt: NOW,
      decidedBy: "dry-run",
      receiptId: "dry-run",
      previous: null,
    };
    const fractions = new Map<string, number>();
    for (const o of result.overlaps) if (!o.whole && o.fraction !== null) fractions.set(o.zcta5, o.fraction);
    const scope: PlannedScope =
      result.status.kind === "OK"
        ? {
            kind: "RESOLVED",
            decision,
            zctas: new Set(result.overlaps.map((o) => o.zcta5)),
            whole: new Set(result.overlaps.filter((o) => o.whole).map((o) => o.zcta5)),
            fractions,
            states: [...new Set([decision.geography.stateAbbr, ...(g?.memberStates ?? [])].map((s) => s.toUpperCase()))],
            members: new Set(),
          }
        : { kind: "UNRESOLVED", decision, why: result.status.note, states: [decision.geography.stateAbbr], members: new Set() };
    targets.push(scopeWorkTarget(scope));
  }

  const plan = planDispatchWork({
    targets,
    world: { registries, territory, territoryDetail: null, corpus, durable, meetingPartitions: UNREAD_MEETING_PARTITIONS },
  });
  const reading = dispatchWorkReading(plan, null, {
    at: NOW,
    modelLaneClosed: laneClosed,
    ceilingUsd: ceiling.rollingCeilingUsd,
    ceilingSource: ceiling.source,
    writes: "PLAN_ONLY",
    planOnlyWhy: "a read-only dry run writes nothing",
  });

  console.log(`\nPLANNED ONLY — nothing was written. At most ${plan.writeBudget} obligations are written a cycle.`);
  for (const t of reading.targets) {
    const r = t.requirements;
    console.log(`\n${t.label} (${t.key})`);
    console.log(`  ${dispatchWorkSentence(t)}`);
    /* RULING 159: every count below is floored — a zero with no population says why, never reads as measured. */
    const governments = t.units.blocked === null ? null : t.units.placed + t.units.blocked;
    console.log(
      `  ${governments === null
        ? "governments blocked by missing data: COULD NOT ASSERT — the geography did not resolve, so the governments in it cannot be named"
        : floorLine(floored("governments blocked by missing data", t.label, governments, t.units.blocked ?? 0, "the Census names no government certainly in this geography"))}` +
        ` · ${t.units.unplaced} in its state(s) that no territory can place in or out`,
    );
    const noRequirement = "no requirement is defined here: every government is blocked or unplaceable";
    console.log(`  ${floorLine(floored("requirements that would be created", t.label, r.defined, r.deferred, noRequirement))}`);
    console.log(`  ${floorLine(floored("requirements already on a clock (reordered)", t.label, r.defined, r.carried, noRequirement))}`);
    console.log(`  requirements beyond the cap of ${t.cap}: ${r.capped} · held: ${r.held} · created before this run: ${r.created}`);
    console.log(`  ${floorLine(floored("standing obligations reordered", "the standing corpus", t.reordered.of, t.reordered.obligations, "the corpus is empty"))}`);
    const planned = plan.targets.find((p) => p.target.key === t.key);
    const wouldCreate = planned?.instances.filter((p) => p.state === "MISSING") ?? [];
    const byKind = new Map<string, number>();
    for (const p of wouldCreate) byKind.set(`${p.instance.kind} / ${p.instance.executor}`, (byKind.get(`${p.instance.kind} / ${p.instance.executor}`) ?? 0) + 1);
    for (const [kind, n] of byKind) console.log(`    would create ${n} × ${kind}`);
    for (const p of wouldCreate.slice(0, 8)) console.log(`      ${p.instance.obligation.id}`);
    if (wouldCreate.length > 8) console.log(`      … and ${wouldCreate.length - 8} more`);
    for (const b of t.blocked) console.log(`  BLOCKED ${b.code}: ${b.units === null ? "uncounted" : b.units} government(s) — ${b.dataset}${b.sample.length > 0 ? ` (e.g. ${b.sample.slice(0, 6).join("; ")})` : ""}`);
    for (const line of t.says) console.log(`  · ${line}`);
  }
} catch (error) {
  console.error(`dispatch-work-dry-run · ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
}
