import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ScopeCardSummary } from "../app/(admin)/admin/expansion/scope-card.tsx";
import { loadBootstrapLookup } from "../lib/census-geography/reader.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { armExpansionBudget, buildTerritoryIndex, planExpansion, withCycleCounts, type ResolvedScope } from "../lib/control-plane/expansion/membership.ts";
import { scopeKeyOf, type ExpansionScopeDecision, type ExpansionScopeGeography } from "../lib/control-plane/expansion/scopes.ts";
import { scopeCards } from "../lib/control-plane/expansion/view.ts";

/**
 * **THE EXPANSION PAGE'S SCOPE CARD, RENDERED.** (Expansion controls, 2026-09-23.)
 *
 * The card is rendered to markup from the real pipeline — the committed Arizona
 * census bootstrap, a registry, a cost ledger — and read as the owner would:
 * every measured figure appears, and every unknown appears as the sentence that
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

async function cardsFor(costs: readonly CostEntry[] | null, scopes?: (d: ExpansionScopeDecision) => Promise<ResolvedScope>) {
  const d = decision(PIMA, 5);
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
  return scopeCards({ scopes: [d], reading, assignmentRows: null, assignmentTotal: null });
}

function text(markup: string): string {
  return markup.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

test("a resolved geography renders its ZCTAs, work, spend, coverage, gap and budget — and a link to its assignments", async () => {
  const [card] = await cardsFor([scoutCost("az:county:county-of-pima", 0.25)]);
  const markup = renderToStaticMarkup(<ScopeCardSummary card={card} nowIso={NOW} />);
  const words = text(markup);
  assert.match(words, /1\. Pima County, Arizona/);
  assert.match(words, /Priority 1, with a budget of \$5\.00 per rolling 24 hours/);
  assert.match(words, /was priority 2 with \$1\.00/);
  assert.match(words, /56 ZCTA\(s\) wholly or partly inside it/);
  assert.match(words, /1 standing obligation\(s\) about 1 government\(s\) in it; 1 were due/);
  assert.match(words, /Spent here: \$0\.25 in the rolling 24 hours/);
  assert.match(words, /50 of its 56 ZCTAs have a local government with work; 6 have none — the gap/);
  assert.match(words, /Budget: \$0\.25 spent in the rolling 24 hours of a \$5\.00 budget/);
  assert.match(words, /Last cycle it held 0 paid Scout\(s\) and let 0 through/);
  assert.match(words, /not on the published snapshot yet/, "no published assignment list is a named gap");
  assert.doesNotMatch(markup, /NaN|undefined|>null</);
});

test("unknown renders as its reason: unmeasured spend, an unreadable ledger, an unresolved geography, a reading not yet taken", async () => {
  const [unmeasured] = await cardsFor([scoutCost("az:county:county-of-pima", null)]);
  const a = text(renderToStaticMarkup(<ScopeCardSummary card={unmeasured} nowIso={NOW} />));
  assert.match(a, /Spent here: not measured in the rolling 24 hours \(0 measured row\(s\), 1 with no dollar figure\)/);
  assert.match(a, /reported no dollar figure, so the \$5\.00 budget cannot be checked/);

  const [unread] = await cardsFor(null);
  const b = text(renderToStaticMarkup(<ScopeCardSummary card={unread} nowIso={NOW} />));
  assert.match(b, /Spend here was not read, so it is not shown — not zero/);

  const [unresolved] = await cardsFor([], async (d) => ({ kind: "UNRESOLVED", decision: d, why: "the Census geography is not published yet", states: ["AZ"] }));
  const c = text(renderToStaticMarkup(<ScopeCardSummary card={unresolved} nowIso={NOW} />));
  assert.match(c, /Not resolved: the Census geography is not published yet — nothing is placed in it/);
  assert.doesNotMatch(c, /standing obligation/, "an unresolved geography claims no work, not zero work");
  assert.match(c, /paid work anywhere in AZ/);

  const [card] = await cardsFor([]);
  const later = { ...card, runner: { kind: "NOT_YET" as const, says: "It takes effect at the start of the next cycle." } };
  const d = text(renderToStaticMarkup(<ScopeCardSummary card={later} nowIso={NOW} />));
  assert.match(d, /It takes effect at the start of the next cycle/);
  assert.doesNotMatch(d, /ZCTA\(s\) wholly/, "a reading of the old decision is not shown as this one's");
});
