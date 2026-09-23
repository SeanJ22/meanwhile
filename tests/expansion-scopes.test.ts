import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadBootstrapLookup } from "@/lib/census-geography/reader.ts";
import type { CostEntry } from "@/lib/control-plane/cost.ts";
import {
  SCOPE_BUDGET_CODE,
  ScopeBudgetGate,
  armExpansionBudget,
  buildTerritoryIndex,
  countByScope,
  orderByPlacement,
  planExpansion,
  registryIdForUnit,
  scopeMembers,
  withCycleCounts,
  certainlyOverlaps,
  unitShareKey,
  type BudgetScope,
  type CensusUnitTerritory,
  type ResolvedScope,
  type ScopeZctas,
} from "@/lib/control-plane/expansion/membership.ts";
import { isExpansionCycleReading, MEMBERSHIP_METHOD } from "@/lib/control-plane/expansion/reading.ts";
import { loadExpansionPlan, readTerritoryIndex, resolveScopes } from "@/lib/control-plane/expansion/runner-load.ts";
import {
  expansionScopesOf,
  orderScopes,
  scopeKeyOf,
  validateScopeBudget,
  validateScopeGeography,
  validateScopeKey,
  validateScopeNote,
  validateScopePriority,
  withScopeRemoved,
  withScopeSet,
  type ExpansionScopeDecision,
  type ExpansionScopeGeography,
} from "@/lib/control-plane/expansion/scopes.ts";
import { stateOfSubject, subjectOfObligationId } from "@/lib/control-plane/expansion/subjects.ts";
import { assignmentsInScope, runnerViewFor, scopeCardNumbers, scopeCards } from "@/lib/control-plane/expansion/view.ts";
import type { AssignmentListRow } from "@/lib/control-plane/assignment-view.ts";
import { auditRenderedNumbers } from "@/lib/control-plane/owner-surface.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withExpansionScopes } from "@/lib/control-plane/gateway/admin-config.ts";
import { placeFirstRows } from "@/lib/control-plane/scheduler/shadow-loop.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { JurisdictionRegistry } from "@/lib/hunt/jurisdiction-universe.ts";

/**
 * **EXPANSION SCOPES — the owner's geography, order and paid-work budget.**
 * (Expansion controls, 2026-09-23.)
 *
 * Everything here is pure or runs against in-memory repositories and the
 * committed Arizona census-geography bootstrap (county 04019 = Pima, 56 ZCTAs;
 * CD 0406, 79 ZCTAs). No network, no database.
 */

const NOW = "2026-09-23T04:00:00.000Z";

const PIMA: ExpansionScopeGeography = {
  type: "county",
  geoid: "04019",
  version: "county:2020",
  label: "Pima County, Arizona",
  stateAbbr: "AZ",
};
const CD6: ExpansionScopeGeography = {
  type: "congressional_district",
  geoid: "0406",
  version: "cd:119",
  label: "Arizona Congressional District 6 (119th Congress)",
  stateAbbr: "AZ",
};

function decision(geography: ExpansionScopeGeography, priority: number, budgetUsd: number, decidedAt = NOW): ExpansionScopeDecision {
  return {
    key: scopeKeyOf(geography),
    geography,
    priority,
    budgetUsd,
    note: null,
    decidedAt,
    decidedBy: "adm_test-session",
    receiptId: `expansion.scope.set:${geography.geoid}`,
    previous: null,
  };
}

async function zctasOf(g: ExpansionScopeGeography): Promise<string[]> {
  return [...(await geometryOf(g)).zctas];
}

/** A geography's ZCTAs as the overlap rule reads them: all, the wholly-inside ones, and each partial share. */
async function geometryOf(g: ExpansionScopeGeography): Promise<ScopeZctas> {
  const lookup = loadBootstrapLookup();
  const result = await lookup.zctasForGrouping({ type: g.type, geoid: g.geoid, version: g.version });
  assert.equal(result.status.kind, "OK", `${g.label} resolves in the bootstrap fixture`);
  const fractions = new Map<string, number>();
  for (const o of result.overlaps) if (!o.whole && o.fraction !== null) fractions.set(o.zcta5, o.fraction);
  return {
    zctas: new Set(result.overlaps.map((o) => o.zcta5)),
    whole: new Set(result.overlaps.filter((o) => o.whole).map((o) => o.zcta5)),
    fractions,
  };
}

async function resolved(d: ExpansionScopeDecision): Promise<ResolvedScope> {
  return { kind: "RESOLVED", decision: d, ...(await geometryOf(d.geography)), states: ["AZ"] };
}

function registry(state: string, jurisdictions: JurisdictionRegistry["jurisdictions"]): JurisdictionRegistry {
  return {
    formatVersion: 1,
    stateCode: state,
    generatedBy: "test",
    generatedOn: "2026-09-01",
    _note: [],
    enumerationSources: [],
    counts: {},
    disagreements: [],
    sourceCatalog: {},
    jurisdictions,
  };
}

function jurisdiction(id: string, name: string, govClass: JurisdictionRegistry["jurisdictions"][number]["govClass"]): JurisdictionRegistry["jurisdictions"][number] {
  return { id, stateCode: id.slice(0, 2).toUpperCase(), name, govClass, countyName: null, enumeratedFrom: "census-govt-units-2022", ownWebAddress: null, sourceIds: [] };
}

function cost(jurisdiction: string | null, usd: number | null, recordedAt: string, role: CostEntry["role"] = "SCOUT"): CostEntry {
  return {
    attemptId: `a-${jurisdiction}-${recordedAt}-${usd}`,
    workItemId: "wi-1",
    routeTaskId: null,
    routeId: null,
    source: null,
    jurisdiction,
    project: "freshness",
    role,
    cost: {
      inputTokens: 10,
      outputTokens: 10,
      usd,
      durationMs: 1,
      bytesFetched: null,
      requestCount: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreation5mInputTokens: null,
      cacheCreation1hInputTokens: null,
      uncachedInputTokens: 10,
      batch: false,
    },
    recordedAt,
  };
}

/* ======================================================================= *
 * validation and the policy row
 * ======================================================================= */

test("a scope's geography, priority, budget, note and key are validated before anything is written", () => {
  assert.equal(validateScopeGeography({ ...PIMA }).ok, true);
  assert.equal(validateScopeGeography({ ...PIMA, type: "place" }).ok, false, "a place is not one of the five groupings");
  assert.equal(validateScopeGeography({ ...PIMA, version: "cd:119" }).ok, false, "a county cannot carry a congressional plan");
  assert.equal(validateScopeGeography({ ...PIMA, geoid: "" }).ok, false);
  assert.equal(validateScopeGeography({ ...PIMA, label: "  " }).ok, false);
  assert.equal(validateScopeGeography({ ...PIMA, stateAbbr: "Arizona" }).ok, false);
  const lower = validateScopeGeography({ ...PIMA, stateAbbr: "az" });
  assert.equal(lower.ok && lower.value.stateAbbr, "AZ", "the state is normalised to upper case");

  assert.deepEqual(validateScopePriority("1"), { ok: true, value: 1 });
  for (const bad of ["0", "-1", "1.5", "", "abc", 1000]) assert.equal(validateScopePriority(bad).ok, false, `${bad} is not a priority`);

  assert.deepEqual(validateScopeBudget("0"), { ok: true, value: 0 }, "a $0 budget is allowed: no paid work there");
  assert.deepEqual(validateScopeBudget("12.345"), { ok: true, value: 12.35 }, "whole cents");
  for (const bad of ["-0.01", "", "x", "10001"]) assert.equal(validateScopeBudget(bad).ok, false, `${bad} is not a budget`);

  assert.deepEqual(validateScopeNote("  "), { ok: true, value: null });
  assert.equal(validateScopeNote("x".repeat(501)).ok, false);
  assert.deepEqual(validateScopeKey("county:2020/04019"), { ok: true, value: "county:2020/04019" });
  assert.equal(validateScopeKey("county:2020/04019; drop").ok, false);
});

test("setting a scope is an upsert that keeps the previous decision, and removing one leaves the rest", () => {
  const first = withScopeSet([], { geography: PIMA, priority: 2, budgetUsd: 5, note: null, decidedAt: NOW, decidedBy: "adm_a", receiptId: "r1" });
  assert.equal(first.previous, null);
  const second = withScopeSet(first.scopes, { geography: CD6, priority: 1, budgetUsd: 0, note: "first", decidedAt: "2026-09-23T04:01:00.000Z", decidedBy: "adm_a", receiptId: "r2" });
  assert.deepEqual(second.scopes.map((s) => s.key), ["cd:119/0406", "county:2020/04019"], "priority 1 runs first");
  const changed = withScopeSet(second.scopes, { geography: PIMA, priority: 1, budgetUsd: 9, note: null, decidedAt: "2026-09-23T04:02:00.000Z", decidedBy: "adm_a", receiptId: "r3" });
  assert.equal(changed.scopes.length, 2, "an upsert, never a duplicate");
  assert.deepEqual(changed.previous && { p: changed.previous.priority, b: changed.previous.budgetUsd }, { p: 2, b: 5 });
  const pima = changed.scopes.find((s) => s.key === "county:2020/04019");
  assert.deepEqual(pima?.previous, { priority: 2, budgetUsd: 5 });
  assert.deepEqual(changed.scopes.map((s) => s.key), ["cd:119/0406", "county:2020/04019"], "a priority tie goes to the scope decided earlier");

  const removed = withScopeRemoved(changed.scopes, "cd:119/0406");
  assert.equal(removed.removed?.geography.label, CD6.label);
  assert.deepEqual(removed.scopes.map((s) => s.key), ["county:2020/04019"]);
  assert.equal(withScopeRemoved(removed.scopes, "cd:119/0401").removed, null);
});

test("a malformed stored scope is counted, never dropped as if no restriction stood", () => {
  const good = decision(PIMA, 1, 5);
  const read = expansionScopesOf({ expansionScopes: [good, { key: "junk" }, good] });
  assert.equal(read.scopes.length, 1);
  assert.equal(read.malformed, 2, "the junk entry and the duplicate key are both malformed");
  assert.deepEqual(expansionScopesOf({ expansionScopes: "nonsense" }), { scopes: [], malformed: 1 });
  assert.deepEqual(expansionScopesOf(null), { scopes: [], malformed: 0 });
  assert.deepEqual(expansionScopesOf(defaultAdminConfig()), { scopes: [], malformed: 0 }, "a policy row with no scopes selects none");
  const written = withExpansionScopes(defaultAdminConfig(), { scopes: [good], decidedAt: NOW });
  assert.equal(written.apiFallback.enabled, false, "the rest of the policy row is carried through");
  assert.deepEqual(expansionScopesOf(written).scopes, [good]);
  assert.deepEqual(orderScopes([decision(CD6, 3, 0), good]).map((s) => s.priority), [1, 3]);
});

test("a piece of work's subject and state are read from its own id, never guessed", () => {
  assert.equal(subjectOfObligationId("freshness:jurisdiction:az:county:county-of-pima#az-sos-local"), "az:county:county-of-pima");
  assert.equal(subjectOfObligationId("freshness:campaign-finance:ballot-az-pima:prop-423#route"), "ballot-az-pima:prop-423");
  assert.equal(subjectOfObligationId("freshness:candidate-enrichment:az:2026:state-az:governor:x#wiki"), "az:2026:state-az:governor:x");
  assert.equal(subjectOfObligationId("wi-4f2a9c1b"), null, "a created work item names no standing subject");
  assert.equal(subjectOfObligationId("routine:meetings"), null);
  assert.equal(stateOfSubject("az:county:county-of-pima"), "AZ");
  assert.equal(stateOfSubject("nh-sos-cfs-2026"), "NH");
  assert.equal(stateOfSubject("ballot-az-pima:prop-423"), "AZ");
  assert.equal(stateOfSubject("zz:unknown"), null, "an unknown code is an unknown state");
  assert.equal(stateOfSubject("tracker-row-17"), null);
});

/* ======================================================================= *
 * territory and membership
 * ======================================================================= */

test("registry governments join their Census unit territory by the generator's own id rule", async () => {
  const pimaZctas = await zctasOf(PIMA);
  const units: CensusUnitTerritory[] = [
    { pid6: "100", name: "COUNTY OF PIMA", type: "COUNTY", state: "AZ", zips: pimaZctas },
    { pid6: "101", name: "CITY OF TUCSON", type: "MUNICIPAL", state: "AZ", zips: pimaZctas.slice(0, 10) },
    { pid6: "102", name: "TOWN OF NOWHERE", type: "MUNICIPAL", state: "AZ", zips: [] },
    { pid6: "201", name: "TOWNSHIP OF WASHINGTON", type: "TOWNSHIP", state: "NJ", zips: ["07882"] },
    { pid6: "202", name: "TOWNSHIP OF WASHINGTON", type: "TOWNSHIP", state: "NJ", zips: ["07840"] },
    { pid6: "900", name: "COUNTY OF FRANKLIN", type: "COUNTY", state: "OH", zips: ["43215"] },
  ];
  assert.equal(registryIdForUnit(units[0]), "az:county:county-of-pima");
  const index = buildTerritoryIndex(
    [
      registry("AZ", [
        jurisdiction("az:state:arizona", "Arizona", "STATE"),
        jurisdiction("az:county:county-of-pima", "COUNTY OF PIMA", "COUNTY"),
        jurisdiction("az:city:city-of-tucson", "CITY OF TUCSON", "CITY_OR_TOWN"),
        jurisdiction("az:city:town-of-nowhere", "TOWN OF NOWHERE", "CITY_OR_TOWN"),
        jurisdiction("az:depschool:pima-accommodation", "PIMA ACCOMMODATION", "DEPENDENT_SCHOOL_SYSTEM"),
      ]),
      registry("NJ", [
        jurisdiction("nj:city:township-of-washington", "TOWNSHIP OF WASHINGTON", "CITY_OR_TOWN"),
        jurisdiction("nj:city:township-of-washington-202", "TOWNSHIP OF WASHINGTON", "CITY_OR_TOWN"),
      ]),
    ],
    units,
  );
  assert.equal(index.bySubject.get("az:county:county-of-pima")?.zctas.size, 56);
  assert.equal(index.bySubject.get("az:city:city-of-tucson")?.zctas.size, 10);
  assert.ok(index.statewide.has("az:state:arizona"), "the state row is statewide, in no sub-state scope");
  assert.match(index.unplaced.get("az:city:town-of-nowhere") ?? "", /no ZCTA territory/);
  assert.match(index.unplaced.get("az:depschool:pima-accommodation") ?? "", /no Census of Governments unit/);
  assert.deepEqual([...(index.bySubject.get("nj:city:township-of-washington")?.zctas ?? [])], ["07882"], "the unsuffixed id is the unit no suffixed sibling claimed");
  assert.deepEqual([...(index.bySubject.get("nj:city:township-of-washington-202")?.zctas ?? [])], ["07840"]);
  assert.equal(index.unregisteredUnitsByState.get("OH")?.length, 1, "a state no registry covers keeps its Census units for the gap count");

  const members = scopeMembers(await geometryOf(PIMA), ["az:county:county-of-pima", "az:city:city-of-tucson", "az:state:arizona", "az:city:town-of-nowhere"], index);
  assert.deepEqual([...members].sort(), ["az:city:city-of-tucson", "az:county:county-of-pima"], "statewide and unplaced work is never guessed into a scope");
});

test("sharing a border ZCTA is not membership: only a certain overlap inside a ZCTA places a government", async () => {
  const pima = await geometryOf(PIMA);
  const border = [...pima.fractions.entries()].find(([, f]) => f > 0.8 && f < 0.95);
  assert.ok(border !== undefined, "the fixture carries a Pima ZCTA that is mostly, not wholly, inside the county");
  const [zcta, pimaShare] = border;
  const neighbour = { zctas: new Set([zcta, "99999"]), shares: new Map([[zcta, 1 - pimaShare]]) };
  assert.equal(certainlyOverlaps(neighbour, pima), false, "a neighbour holding only the rest of a border ZCTA is not in the scope");
  const noShare = { zctas: new Set([zcta]), shares: new Map<string, number>() };
  assert.equal(certainlyOverlaps(noShare, pima), false, "without a share, only a wholly-inside ZCTA can place a government");
  const straddler = { zctas: new Set([zcta]), shares: new Map([[zcta, 0.5]]) };
  assert.equal(certainlyOverlaps(straddler, pima), true, "half the ZCTA plus Pima's share cannot fit outside Pima");
  const whole = [...pima.whole][0];
  assert.equal(certainlyOverlaps({ zctas: new Set([whole]), shares: new Map() }, pima), true, "touching a wholly-inside ZCTA is inside");
  assert.equal(unitShareKey({ method: "county GEOID 04019" }), "county:04019");
  assert.equal(unitShareKey({ method: "place GEOID 0477000" }), "place:0477000");
  assert.equal(unitShareKey({ method: "unsd GEOID 0403950 via the NCES crosswalk" }), "unsd:0403950");
  assert.equal(unitShareKey({ method: "cousub GEOID" }), null);
  assert.equal(unitShareKey({ method: "TIGER publishes NO special-district boundaries at any vintage" }), null);
});

test("on the committed data, Pima County holds Pima and Tucson and none of its neighbours; CD 6 holds the counties it spans", async () => {
  const root = join(import.meta.dirname, "..");
  const registries = ["az", "nh", "nj"].map(
    (s) => JSON.parse(readFileSync(join(root, "data", "states", s, "jurisdictions", `${s}.json`), "utf8")) as JurisdictionRegistry,
  );
  const index = readTerritoryIndex(root, registries);
  const counties = (scope: ScopeZctas) =>
    [...index.bySubject.values()].filter((t) => t.govClass === "COUNTY" && t.stateCode === "AZ" && certainlyOverlaps(t, scope)).map((t) => t.subjectId).sort();

  const pima = await geometryOf(PIMA);
  assert.deepEqual(counties(pima), ["az:county:county-of-pima"], "Maricopa, Pinal, Cochise and Santa Cruz share border ZCTAs with Pima and are not in it");
  assert.ok(certainlyOverlaps(index.bySubject.get("az:city:city-of-tucson")!, pima), "Tucson is in Pima County");
  assert.ok(!certainlyOverlaps(index.bySubject.get("az:city:city-of-phoenix")!, pima), "Phoenix is not");

  const cd6 = counties(await geometryOf(CD6));
  for (const inside of ["az:county:county-of-pima", "az:county:county-of-cochise"]) assert.ok(cd6.includes(inside), `${inside} lies partly in CD 6`);
  assert.ok(!cd6.includes("az:county:county-of-maricopa"), "Maricopa is not in CD 6");
  assert.ok(index.bySubject.get("az:county:county-of-pima")!.shares.size > 0, "a registered county carries its sampled ZCTA shares");
});

test("the order puts DISPATCH first, then scopes by priority, and is exactly the old order with no scope", () => {
  const rows = ["a", "b", "c", "d", "e"].map((id) => ({ obligation: { id } }));
  const dispatch = new Set(["d"]);
  const scopeRank = new Map([["b", 2], ["e", 1], ["c", 2]]);
  const ordered = orderByPlacement(rows, (r) => (dispatch.has(r.obligation.id) ? 0 : scopeRank.get(r.obligation.id) ?? null));
  assert.deepEqual(ordered.map((r) => r.obligation.id), ["d", "e", "b", "c", "a"], "stable inside each group");
  const noScope = orderByPlacement(rows, (r) => (dispatch.has(r.obligation.id) ? 0 : null));
  assert.deepEqual(noScope, [...placeFirstRows(rows, dispatch)], "with no scope selected the order is the dispatcher's own");
  assert.equal(ordered.length, rows.length, "nothing added or dropped");
});

/* ======================================================================= *
 * the budget gate
 * ======================================================================= */

function scope(over: Partial<BudgetScope> = {}): BudgetScope {
  return { key: "county:2020/04019", label: "Pima County", budgetUsd: 1, resolved: true, members: new Set(["az:county:county-of-pima"]), states: ["AZ"], historicalUsd: 0, ...over };
}

test("a scope budget admits within it, reserves the worst case, and refuses by name past it", () => {
  const gate = new ScopeBudgetGate({ scopes: [scope({ budgetUsd: 1.3 })], worstCaseUsd: 0.6 });
  assert.deepEqual(gate.admit("o1", "az:county:county-of-pima"), { admit: true });
  assert.deepEqual(gate.admit("o2", "az:county:county-of-pima"), { admit: true }, "0.6 + 0.6 fits in 1.3");
  const third = gate.admit("o3", "az:county:county-of-pima");
  assert.equal(third.admit, false);
  assert.equal(!third.admit && third.code, SCOPE_BUDGET_CODE);
  gate.settle("o1", 0.1);
  gate.settle("o2", 0.1);
  assert.deepEqual(gate.admit("o3", "az:county:county-of-pima"), { admit: true }, "settled spend replaces the reservation");
  assert.equal(gate.admittedCount("county:2020/04019"), 3);
  assert.equal(gate.refusedCount("county:2020/04019"), 1);
  assert.deepEqual(gate.admit("o9", "nh:county:county-of-grafton"), { admit: true }, "work outside every scope is not the budget's business");
});

test("a $0 budget holds all paid work in the scope, and a subject in two scopes must pass both", () => {
  const zero = new ScopeBudgetGate({ scopes: [scope({ budgetUsd: 0 })], worstCaseUsd: 0.6 });
  assert.equal(zero.admit("o1", "az:county:county-of-pima").admit, false);
  const both = new ScopeBudgetGate({
    scopes: [scope({ budgetUsd: 50 }), scope({ key: "cd:119/0406", label: "CD 6", budgetUsd: 0.5 })],
    worstCaseUsd: 0.6,
  });
  const refused = both.admit("o1", "az:county:county-of-pima");
  assert.equal(refused.admit, false, "the tighter of two budgets binds");
  assert.match(!refused.admit ? refused.why : "", /CD 6/);
});

test("unmeasured spend, an unresolved scope and an unreadable scope list all hold paid work — restrict-only", () => {
  const unmeasured = new ScopeBudgetGate({ scopes: [scope({ historicalUsd: null, budgetUsd: 100 })], worstCaseUsd: 0.6 });
  assert.match((unmeasured.admit("o1", "az:county:county-of-pima") as { why: string }).why, /unmeasured/);

  const settledUnknown = new ScopeBudgetGate({ scopes: [scope({ budgetUsd: 100 })], worstCaseUsd: 0.6 });
  assert.equal(settledUnknown.admit("o1", "az:county:county-of-pima").admit, true);
  settledUnknown.settle("o1", null);
  assert.equal(settledUnknown.admit("o2", "az:county:county-of-pima").admit, false, "a Scout that reported no dollars leaves the scope unmeasured");

  const unresolved = new ScopeBudgetGate({ scopes: [scope({ resolved: false, members: new Set(), historicalUsd: null, budgetUsd: 100 })], worstCaseUsd: 0.6 });
  assert.equal(unresolved.admit("o1", "az:city:city-of-benson").admit, false, "it cannot tell what is inside it, so its state is held");
  assert.equal(unresolved.admit("o2", "tracker-row-17").admit, false, "and so is work whose state is unknown");
  assert.equal(unresolved.admit("o3", "nj:county:county-of-morris").admit, true, "another state is not its business");

  const malformed = new ScopeBudgetGate({ scopes: [], worstCaseUsd: 0.6, malformedScopes: 1 });
  assert.equal(malformed.admit("o1", "nj:county:county-of-morris").admit, false);
});

/* ======================================================================= *
 * the plan and the reading
 * ======================================================================= */

async function pimaPlanInput() {
  const pimaZctas = await zctasOf(PIMA);
  const units: CensusUnitTerritory[] = [
    { pid6: "100", name: "COUNTY OF PIMA", type: "COUNTY", state: "AZ", zips: pimaZctas },
    { pid6: "101", name: "CITY OF TUCSON", type: "MUNICIPAL", state: "AZ", zips: pimaZctas.slice(0, 10) },
    { pid6: "102", name: "COUNTY OF COCONINO", type: "COUNTY", state: "AZ", zips: ["86001", "86004"] },
  ];
  const territory = buildTerritoryIndex(
    [
      registry("AZ", [
        jurisdiction("az:state:arizona", "Arizona", "STATE"),
        jurisdiction("az:county:county-of-pima", "COUNTY OF PIMA", "COUNTY"),
        jurisdiction("az:city:city-of-tucson", "CITY OF TUCSON", "CITY_OR_TOWN"),
        jurisdiction("az:county:county-of-coconino", "COUNTY OF COCONINO", "COUNTY"),
      ]),
    ],
    units,
  );
  const scopes: ResolvedScope[] = [await resolved(decision(CD6, 1, 2)), await resolved(decision(PIMA, 2, 0.8))];
  const obligations = [
    { id: "freshness:jurisdiction:az:county:county-of-pima#r1", subjectId: "az:county:county-of-pima" },
    { id: "freshness:jurisdiction:az:city:city-of-tucson#r1", subjectId: "az:city:city-of-tucson" },
    { id: "freshness:jurisdiction:az:county:county-of-coconino#r1", subjectId: "az:county:county-of-coconino" },
    { id: "freshness:jurisdiction:az:state:arizona#r1", subjectId: "az:state:arizona" },
    { id: "freshness:candidate-enrichment:az:2026:state-az:governor:x#w", subjectId: "az:2026:state-az:governor:x" },
  ];
  return { scopes, territory, obligations };
}

test("the plan places work by ZCTA overlap, orders scopes by priority, and states coverage and gap", async () => {
  const { scopes, territory, obligations } = await pimaPlanInput();
  const plan = planExpansion({
    now: NOW,
    scopes,
    malformedScopes: 0,
    lookup: { source: "published", versionId: "v1", detail: null },
    territory,
    territoryDetail: null,
    obligations,
  });
  assert.equal(plan.placementOf("az:county:county-of-pima"), 0, "Pima County overlaps CD 6, the priority-1 scope");
  assert.equal(plan.placementOf("az:county:county-of-coconino"), null, "Coconino is in neither scope");
  assert.equal(plan.placementOf("az:state:arizona"), null, "statewide work is in no sub-state scope");
  const pimaReading = plan.reading.scopes.find((s) => s.key === "county:2020/04019");
  assert.equal(pimaReading?.resolution.kind, "RESOLVED");
  assert.deepEqual(pimaReading?.work?.subjectIds, ["az:city:city-of-tucson", "az:county:county-of-pima"]);
  assert.equal(pimaReading?.work?.registeredObligations, 2);
  assert.equal(pimaReading?.coverage?.withWork, 2);
  assert.equal(pimaReading?.coverage?.zctasWithLocalWork, 56);
  assert.equal(pimaReading?.coverage?.gapZctas, 0, "every Pima ZCTA has a local government with work");
  assert.equal(pimaReading?.spend, null, "spend is unknown until the ledger is read — never zero");
  assert.equal(plan.reading.territory.statewideSubjects, 1);
  assert.equal(plan.reading.territory.unplacedSubjects, 1, "the candidacy has no territory in the index and is counted, not guessed");
  assert.equal(plan.reading.territory.method, MEMBERSHIP_METHOD);
  assert.ok(isExpansionCycleReading(plan.reading));

  const due = countByScope(plan, obligations.map((o) => o.subjectId));
  assert.equal(due.get("county:2020/04019"), 2);
});

test("the budget arms from the ledger: 24h and 7d spend, unmeasured as null, and the verdict in words", async () => {
  const { scopes, territory, obligations } = await pimaPlanInput();
  const plan = planExpansion({ now: NOW, scopes, malformedScopes: 0, lookup: { source: "published", versionId: "v1", detail: null }, territory, territoryDetail: null, obligations });
  const costs = [
    cost("az:county:county-of-pima", 0.3, "2026-09-23T01:00:00.000Z"),
    cost("az:city:city-of-tucson", 0.2, "2026-09-20T01:00:00.000Z"),
    cost("az:county:county-of-coconino", 5, "2026-09-23T02:00:00.000Z"),
    cost(null, 9, "2026-09-23T02:00:00.000Z"),
  ];
  const armed = armExpansionBudget(plan, { now: NOW, costs, worstCaseUsd: 0.6 });
  const pima = armed.reading.scopes.find((s) => s.key === "county:2020/04019");
  assert.equal(pima?.spend?.rolling24hUsd, 0.3, "only work in the scope, only the last 24 hours");
  assert.equal(pima?.spend?.sevenDayUsd, 0.5);
  assert.match(pima?.budgetSays ?? "", /would exceed it/, "0.30 + a 0.60 worst case is past a $0.80 budget");
  assert.equal(armed.gate.admit("o", "az:county:county-of-pima").admit, false);
  assert.equal(armed.gate.admit("o2", "az:county:county-of-coconino").admit, true, "Coconino is in no scope; the Fleet ceiling governs it alone");

  const unmeasured = armExpansionBudget(plan, { now: NOW, costs: [cost("az:county:county-of-pima", null, "2026-09-23T01:00:00.000Z")], worstCaseUsd: 0.6 });
  assert.equal(unmeasured.reading.scopes.find((s) => s.key === "county:2020/04019")?.spend?.rolling24hUsd, null);
  const unread = armExpansionBudget(plan, { now: NOW, costs: null, worstCaseUsd: 0.6 });
  assert.equal(unread.reading.scopes[0].spend, null);
  assert.match(unread.reading.scopes[0].budgetSays, /could not be read/);

  const counted = withCycleCounts(armed.reading, { dueByScope: new Map([["county:2020/04019", 2]]), scoutPlacedFirstByScope: new Map(), gate: armed.gate });
  const after = counted.scopes.find((s) => s.key === "county:2020/04019");
  assert.equal(after?.work?.dueThisCycle, 2);
  assert.equal(after?.heldThisCycle, 1);
});

/* ======================================================================= *
 * the runner's load
 * ======================================================================= */

test("the runner's load: nothing selected changes nothing; a bootstrap lookup resolves nothing; a published one resolves", async () => {
  const repos = createMemoryRepositories();
  const none = await loadExpansionPlan({ repos, root: ".", now: NOW, obligations: [] });
  assert.equal(none.plan, null, "no scope selected: the cycle runs exactly as before");

  await repos.adminConfig.put(ADMIN_CONFIG_ID, withExpansionScopes(defaultAdminConfig(), { scopes: [decision(PIMA, 1, 3)], decidedAt: NOW }), NOW);
  const { territory, obligations } = await pimaPlanInput();
  const lookup = loadBootstrapLookup();
  const asBootstrap = await loadExpansionPlan({
    repos, root: ".", now: NOW, obligations,
    loadLookup: async () => ({ lookup, source: "bootstrap", versionId: "bootstrap:census-geography:az" }),
    loadTerritory: () => territory,
  });
  assert.equal(asBootstrap.plan?.scopes[0].kind, "UNRESOLVED", "a fixture is not the published geography");
  assert.equal(asBootstrap.plan?.reading.lookup.source, "bootstrap");

  const published = await loadExpansionPlan({
    repos, root: ".", now: NOW, obligations,
    loadLookup: async () => ({ lookup, source: "published", versionId: "v-test" }),
    loadTerritory: () => territory,
  });
  assert.equal(published.plan?.scopes[0].kind, "RESOLVED");
  assert.equal(published.plan?.placementOf("az:county:county-of-pima"), 0);

  const lookupDown = await loadExpansionPlan({
    repos, root: ".", now: NOW, obligations,
    loadLookup: async () => { throw new Error("STORE_UNREACHABLE"); },
    loadTerritory: () => territory,
  });
  assert.equal(lookupDown.plan?.scopes[0].kind, "UNRESOLVED");
  assert.match(lookupDown.conditions.join(" "), /could not be read/);

  const broken = createMemoryRepositories();
  const failing = { ...broken, adminConfig: { ...broken.adminConfig, read: async () => { throw new Error("boom"); } } } as typeof broken;
  const unreadable = await loadExpansionPlan({ repos: failing, root: ".", now: NOW, obligations });
  assert.equal(unreadable.plan?.malformedScopes, 1, "an unreadable policy row holds paid work rather than dropping a budget");
});

test("resolving against the lookup names every failure and never returns an empty scope as a resolved one", async () => {
  const lookup = loadBootstrapLookup();
  const out = await resolveScopes(
    [decision(PIMA, 1, 1), decision({ ...PIMA, geoid: "04999", label: "No such county" }, 2, 1), decision({ ...CD6, version: "cd:120" }, 3, 1)],
    { lookup, source: "published", versionId: "v" },
    null,
  );
  assert.equal(out.scopes[0].kind, "RESOLVED");
  assert.equal(out.scopes[0].kind === "RESOLVED" && out.scopes[0].zctas.size, 56);
  assert.equal(out.scopes[1].kind, "UNRESOLVED");
  assert.equal(out.scopes[2].kind, "UNRESOLVED", "a plan version that is not published is not zero ZCTAs");
  const unread = await resolveScopes([decision(PIMA, 1, 1)], null, "STORE_UNREACHABLE");
  assert.equal(unread.lookup.source, "NOT_READ");
});

/* ======================================================================= *
 * the page's view
 * ======================================================================= */

function listRow(id: string, state: AssignmentListRow["state"]): AssignmentListRow {
  return { id, state } as unknown as AssignmentListRow;
}

test("the page shows a runner reading only for the decision it measured, and counts listed assignments in scope", async () => {
  const pima = decision(PIMA, 1, 3, "2026-09-23T03:00:00.000Z");
  assert.equal(runnerViewFor(pima, null).kind, "NOT_YET");

  const { scopes, territory, obligations } = await pimaPlanInput();
  const plan = planExpansion({ now: NOW, scopes, malformedScopes: 0, lookup: { source: "published", versionId: "v1", detail: null }, territory, territoryDetail: null, obligations });
  const armed = armExpansionBudget(plan, { now: NOW, costs: [], worstCaseUsd: 0.6 });
  const later = { ...pima, decidedAt: "2026-09-23T05:00:00.000Z" };
  const stale = runnerViewFor(later, armed.reading);
  assert.equal(stale.kind, "NOT_YET", "a cycle that started before the change measured the old decision");
  assert.match(stale.kind === "NOT_YET" ? stale.says : "", /next cycle/);
  assert.equal(runnerViewFor(pima, armed.reading).kind, "READ");

  const rows = [
    listRow("freshness:jurisdiction:az:county:county-of-pima#r1", "WAITING"),
    listRow("freshness:jurisdiction:az:city:city-of-tucson#r2", "FAILED"),
    listRow("freshness:jurisdiction:az:county:county-of-coconino#r1", "WAITING"),
    listRow("routine:meetings-az", "SUCCEEDED"),
    listRow("wi-1234abcd", "WORKING"),
  ];
  const view = assignmentsInScope(rows, new Set(["az:county:county-of-pima", "az:city:city-of-tucson"]), 40, false);
  assert.equal(view.inScope, 2);
  assert.equal(view.listed, 5);
  assert.deepEqual(new Map(view.byState.map((s) => [s.state, s.count])), new Map([["WAITING", 1], ["FAILED", 1]]));

  const cards = scopeCards({ scopes: [pima, decision(CD6, 2, 0)], reading: armed.reading, assignmentRows: rows, assignmentTotal: 40 });
  assert.equal(cards.length, 2);
  const numbers = scopeCardNumbers(cards, armed.reading.territory.registeredObligations);
  const audit = auditRenderedNumbers(numbers);
  assert.equal(audit.ok, true, audit.detail);
  assert.ok(numbers.some((n) => n.label.endsWith("gap ZCTAs")), "the gap is an audited number");

  const unpublished = scopeCards({ scopes: [pima], reading: armed.reading, assignmentRows: null, assignmentTotal: null });
  assert.equal(unpublished[0].assignments, null, "no published list is a named gap, never zero assignments");
  assert.match(unpublished[0].assignmentsSays ?? "", /not an empty scope/);
});
