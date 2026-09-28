import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadBootstrapLookup } from "../lib/census-geography/reader.ts";
import { instructionView, type InstructionView } from "../lib/control-plane/admin-view/work-view.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { armExpansionBudget, buildTerritoryIndex, planExpansion, withCycleCounts, type ResolvedScope } from "../lib/control-plane/expansion/membership.ts";
import { scopeKeyOf, type ExpansionScopeDecision, type ExpansionScopeGeography } from "../lib/control-plane/expansion/scopes.ts";

/**
 * **A SELECTED GEOGRAPHY'S CARD, READ AS THE OWNER READS IT.** (Expansion
 * controls, 2026-09-23; re-pointed for the Admin redesign, 2026-09-23.)
 *
 * Admin redesign, 2026-09-23: the expansion page and its scope card were
 * replaced by Fleet · Work, where each geography the owner selected is an
 * instruction card built by `instructionView` (lib/control-plane/admin-view/
 * work-view.ts) and opened in place. The card is built here from the real
 * pipeline — the committed Arizona census bootstrap, a registry, a cost
 * ledger — and every sentence it carries is read as the owner would: every
 * measured figure appears, and every unknown appears as the sentence that
 * says why, never as a zero, `NaN` or `undefined`.
 */

const NOW = "2026-09-23T04:00:00.000Z";
const PIMA: ExpansionScopeGeography = { type: "county", geoid: "04019", version: "county:2020", label: "Pima County, Arizona", stateAbbr: "AZ" };

function decision(g: ExpansionScopeGeography, budgetUsd: number, decidedAt = "2026-09-23T03:00:00.000Z"): ExpansionScopeDecision {
  return { key: scopeKeyOf(g), geography: g, priority: 1, budgetUsd, note: "start here", decidedAt, decidedBy: "adm_test", receiptId: "r", previous: { priority: 2, budgetUsd: 1 } };
}

function scoutCost(jurisdiction: string, usd: number | null): CostEntry {
  return {
    attemptId: `a-${usd}`,
    workItemId: "wi",
    routeTaskId: null,
    routeId: null,
    source: null,
    jurisdiction,
    project: "freshness",
    role: "SCOUT",
    cost: { inputTokens: 1, outputTokens: 1, usd, durationMs: 1, bytesFetched: null, requestCount: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null, uncachedInputTokens: 1, batch: false },
    recordedAt: "2026-09-23T02:00:00.000Z",
  };
}

async function viewFor(
  costs: readonly CostEntry[] | null,
  scopes?: (d: ExpansionScopeDecision) => Promise<ResolvedScope>,
  decidedAt?: string,
): Promise<InstructionView> {
  const d = decision(PIMA, 5, decidedAt);
  const lookup = loadBootstrapLookup();
  const result = await lookup.zctasForGrouping({ type: "county", geoid: "04019", version: "county:2020" });
  const zips = result.overlaps.map((o) => o.zcta5);
  const territory = buildTerritoryIndex(
    [
      {
        formatVersion: 1, stateCode: "AZ", generatedBy: "t", generatedOn: "2026-09-01", _note: [], enumerationSources: [], counts: {}, disagreements: [], sourceCatalog: {},
        jurisdictions: [
          { id: "az:county:county-of-pima", stateCode: "AZ", name: "COUNTY OF PIMA", govClass: "COUNTY", countyName: null, enumeratedFrom: "x", ownWebAddress: null, sourceIds: [] },
        ],
      },
    ],
    [{ pid6: "1", name: "COUNTY OF PIMA", type: "COUNTY", state: "AZ", zips: zips.slice(0, 50) }],
  );
  const resolved: ResolvedScope = scopes
    ? await scopes(d)
    : {
        kind: "RESOLVED",
        decision: d,
        zctas: new Set(zips),
        whole: new Set(result.overlaps.filter((o) => o.whole).map((o) => o.zcta5)),
        fractions: new Map(result.overlaps.filter((o) => !o.whole && o.fraction !== null).map((o) => [o.zcta5, o.fraction as number])),
        states: ["AZ"],
      };
  const plan = planExpansion({
    now: NOW,
    scopes: [resolved],
    malformedScopes: 0,
    lookup: { source: "published", versionId: "v1", detail: null },
    territory,
    territoryDetail: null,
    obligations: [{ id: "freshness:jurisdiction:az:county:county-of-pima#r", subjectId: "az:county:county-of-pima" }],
  });
  const armed = armExpansionBudget(plan, { now: NOW, costs, worstCaseUsd: 0.6 });
  const reading = withCycleCounts(armed.reading, { dueByScope: new Map([[d.key, 1]]), scoutPlacedFirstByScope: new Map(), gate: armed.gate });
  return instructionView({ decision: d, reading, rows: null, totalAssignments: null, paidLaneClosedBecause: null, runnerPaused: null });
}

/** Everything the card can put in front of the owner, as one text. */
function text(v: InstructionView): string {
  return [
    v.card.title,
    v.card.summary,
    ...v.ack.map((a) => `${a.pill}: ${a.text}`),
    ...v.lanes.flatMap((l) => [l.name, l.pill, ...l.rows.map(([k, val]) => `${k}: ${val}`), l.note]),
    v.spend,
  ].join("\n");
}

test("a resolved geography renders its ZCTAs, work, spend, coverage and budget — and opens by its own reference", async () => {
  const view = await viewFor([scoutCost("az:county:county-of-pima", 0.25)]);
  const words = text(view);
  assert.match(words, /Pima County, Arizona — county, priority 1/);
  assert.match(words, /This instruction has a \$5\.00 paid-model budget in any rolling 24 hours/);
  assert.match(words, /resolved 56 codes/);
  assert.match(words, /1 pieces of standing work are about governments here; 1 were due that cycle/);
  assert.match(words, /\$0\.25 in the rolling 24 hours/);
  assert.match(words, /Governments with work: 1 of 1/);
  assert.match(words, /\$0\.25 spent in the rolling 24 hours of a \$5\.00 budget/);
  assert.match(words, /Admitted last cycle: 0\nHeld by the geography's budget: 0/, "last cycle it held 0 paid Scouts and let 0 through");
  /* MW-021: the instruction's own budget is its own row, and unread is said, never a zero. */
  assert.match(words, /Held by this instruction's budget: not counted yet/);
  // Admin redesign, 2026-09-23: the card no longer quotes the priority and budget it replaced, and the geography's ZCTA gap is read on the readiness state page (Where the gaps are) rather than on the instruction.
  assert.equal(view.card.id, `scope:${scopeKeyOf(PIMA)}`, "the card opens in place by the same reference Readiness links to");
  // No published assignment list is a named gap on the Work screen, never an empty list.
  assert.match(readFileSync(join(process.cwd(), "app", "(admin)", "_mw", "screens", "work.tsx"), "utf8"), /The assignment list is not on the published snapshot, so no standing work is listed — not an empty list\./);
  assert.doesNotMatch(words, /NaN|undefined|\bnull\b/);
});

test("unknown renders as its reason: unmeasured spend, an unreadable ledger, an unresolved geography, a reading not yet taken", async () => {
  const unmeasured = text(await viewFor([scoutCost("az:county:county-of-pima", null)]));
  assert.match(unmeasured, /unknown \(a charge reported no cost\) in the rolling 24 hours/);
  assert.match(unmeasured, /reported no dollar figure, so the \$5\.00 budget cannot be checked/);
  assert.doesNotMatch(unmeasured, /\$0\.00 in the rolling/, "unmeasured spend is never a zero");

  const unread = text(await viewFor(null));
  assert.match(unread, /The cost ledger could not be read, so the \$5\.00 budget cannot be checked/);
  assert.doesNotMatch(unread, /\$0\.00 in the rolling/, "an unread ledger is never a zero");

  const unresolved = text(await viewFor([], async (d) => ({ kind: "UNRESOLVED", decision: d, why: "the Census geography is not published yet", states: ["AZ"] })));
  assert.match(unresolved, /It could not be resolved/);
  assert.doesNotMatch(unresolved, /\d+ pieces of standing work|Standing work here: \d/, "an unresolved geography claims no work, not zero work");
  assert.match(unresolved, /paid work anywhere in AZ/);
  assert.match(unresolved, /the Census geography is not published yet/, "the card says it could not be resolved but never says why — the reason the runner recorded is dropped");

  const later = text(await viewFor([], undefined, "2026-09-23T05:00:00.000Z"));
  assert.match(later, /It takes effect at the start of the next cycle/);
  assert.doesNotMatch(later, /resolved 56 codes/, "a reading of the old decision is not shown as this one's");
  for (const words of [unmeasured, unread, unresolved, later]) assert.doesNotMatch(words, /NaN|undefined|\bnull\b/);
});
