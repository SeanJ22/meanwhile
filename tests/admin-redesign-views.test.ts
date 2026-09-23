import assert from "node:assert/strict";
import test from "node:test";

import type { BillingFact } from "@/lib/control-plane/billing-facts.ts";
import { buildBodyViews, type BodyStoreFacts, type VersionFacts, type WatchedContract } from "@/lib/control-plane/admin-view/bodies.ts";
import { FIX_ITEMS, orderByMarks } from "@/lib/control-plane/admin-view/fix-list.ts";
import { routineDetail } from "@/lib/control-plane/admin-view/work-view.ts";
import {
  ceilingCards,
  outcomesInScope,
  perAttempt,
  placeWords,
  providerRows,
  reconciliation,
  resultTiles,
  unreadProviders,
  type LedgerMonth,
} from "@/lib/control-plane/admin-view/money-view.ts";
import { parseScope, scopeParam, withScope } from "@/app/(admin)/_mw/scope.ts";

/**
 * **THE REDESIGNED ADMIN'S PURE MODELS KEEP THEIR PROMISES.** (Admin
 * redesign, 2026-09-23.)
 *
 * The honesty rules the Money and Fix list screens make, proven on their pure
 * models: an unread provider is never a number, a bill is never added to the
 * ledger, a state never borrows another state's counts, a fraction of a cent
 * never rounds to a free-looking $0.00, a zero-listing read is never counted
 * as a confirmation, and the marks order the list without dropping an item.
 */

const NOW = "2026-09-23T16:00:00.000Z";

const MONTH: LedgerMonth = {
  label: "September 2026",
  since: "2026-09-01T00:00:00.000Z",
  asOf: NOW,
  resetsAt: "2026-10-01T00:00:00.000Z",
  measuredUsd: 186.31,
  measuredRows: 2238,
  unpricedModelRows: 6,
  byModel: [
    { key: "claude-opus-5", usd: 184.17, measuredRows: 2169, unmeasuredRows: 2 },
    { key: "(attempt not on record)", usd: 2.15, measuredRows: 69, unmeasuredRows: 0 },
    { key: "no model (deterministic work)", usd: null, measuredRows: 0, unmeasuredRows: 2312 },
  ],
  byRole: [],
};

function fact(over: Partial<BillingFact>): BillingFact {
  return {
    id: "x",
    provider: "anthropic-api",
    label: null,
    kind: "MONTH_TO_DATE",
    amountUsd: 173.1,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    cadence: null,
    renewsOn: null,
    asOf: "2026-09-22",
    source: "Anthropic Console",
    imported: null,
    decidedAt: NOW,
    decidedBy: "adm_x",
    receiptId: "r",
    ...over,
  };
}

test("every provider with no reading renders as NO READING with its manual path — never a number, never zero", () => {
  const rows = providerRows({ month: MONTH, rolling: { usd: 8.18, asOf: NOW }, maptiler: null, facts: [] });
  const unread = rows.filter((r) => r.amount === null);
  assert.ok(unread.length >= 9, `only ${unread.length} rows say they have no reading`);
  for (const r of unread) assert.match(r.how, /below\.$|Not read:/, `${r.name} does not name the manual path`);
  assert.equal(unreadProviders(rows), unread.length);
  assert.equal(rows.find((r) => r.key === "ledger-month")?.amount, "$186.31");
  assert.equal(rows.find((r) => r.key === "ledger-rolling")?.period, "Rolling 24 hours", "the two ledger windows are separate rows");
});

test("an entered figure fills its provider's row with its kind, period and provenance, and the bill is never added to the ledger", () => {
  const bill = fact({ id: "anthropic-api:MONTH_TO_DATE:2026-09-01" });
  const rows = providerRows({ month: MONTH, rolling: null, maptiler: null, facts: [bill] });
  const row = rows.find((r) => r.factId === bill.id);
  assert.ok(row);
  assert.equal(row?.amount, "$173.10 so far");
  assert.equal(row?.kind, "Billed so far — not final");
  assert.match(row?.how ?? "", /Entered by you · read 2026-09-22 from Anthropic Console/);
  const recon = reconciliation({ month: MONTH, facts: [bill], unread: 3, proofAssignments: 117 });
  const never = recon.find((l) => l.pill === "NEVER ADDED")!;
  assert.match(never.text, /never summed/);
  assert.match(never.text, /the gap between them, \$13\.21/, "the same month: the difference is stated, not smoothed");
  assert.doesNotMatch(recon.map((l) => l.text).join(" "), /\$359\.41/, "the bill and the ledger are never added");
  assert.match(recon.find((l) => l.pill === "UNKNOWN IS NOT ZERO")!.text, /floor, not a total/);
});

test("the three ceilings are never blended, and an account cap or a subscription with no entry has no number", () => {
  const ceiling = { settingUsd: 105, source: "OVERRIDE" as const, setAt: "2026-09-20T00:30:41.707Z", previousUsd: 100, enforcedUsd: 105 };
  const none = ceilingCards({ ceiling, rolling: { usd: 8.18, asOf: NOW }, facts: [] });
  assert.equal(none[0].amount, "$105.00");
  assert.match(none[0].note, /\$8\.18 spent in the window/);
  assert.equal(none[1].amount, null, "an account cap nobody entered is not a number");
  assert.equal(none[2].amount, null, "subscriptions nobody entered are not a number");
  const withFacts = ceilingCards({
    ceiling: { ...ceiling, enforcedUsd: 100 },
    rolling: null,
    facts: [fact({ kind: "LIMIT", cadence: "DAILY", amountUsd: 150, periodStart: null, periodEnd: null }), fact({ provider: "openai-subscription", kind: "SUBSCRIPTION", cadence: "MONTHLY", amountUsd: 200, periodStart: null, periodEnd: null })],
  });
  assert.match(withFacts[0].note, /runner last enforced \$100\.00; this setting takes effect at its next cycle/);
  assert.equal(withFacts[1].amount, "$150.00");
  assert.match(withFacts[1].label, /per day/);
  assert.equal(withFacts[2].amount, "$200.00");
});

test("paid outcomes narrow by state without borrowing another state's refusals", () => {
  const rows = [
    { state: "az", outcome: "ROUTE_CANDIDATE", attempts: 9, usd: 12.77, unpriced: 0, first: "2026-09-02T00:00:00Z", last: "2026-09-21T00:00:00Z" },
    { state: "az", outcome: "REFUSED", attempts: 814, usd: 0, unpriced: 1, first: "2026-09-19T00:00:00Z", last: "2026-09-19T12:00:00Z" },
    { state: "nj", outcome: "REFUSED", attempts: 1000, usd: 3.41, unpriced: 0, first: "2026-09-19T00:00:00Z", last: "2026-09-21T00:00:00Z" },
    { state: "nj", outcome: "ROUTE_CANDIDATE", attempts: 127, usd: 75.85, unpriced: 0, first: "2026-09-02T00:00:00Z", last: "2026-09-22T00:00:00Z" },
  ];
  const refusals = [
    { state: "az", code: "SCOUT_TRANSPORT_FAILED", count: 814, detail: "HTTP 529 overloaded" },
    { state: "nj", code: "SCOUT_TRANSPORT_FAILED", count: 1000, detail: "HTTP 529 overloaded" },
  ];
  const az = outcomesInScope(rows, refusals, "az");
  assert.equal(az.find((o) => o.outcome === "REFUSED")?.topRefusal?.count, 814, "Arizona counts its own refusals only");
  assert.equal(az.find((o) => o.outcome === "ROUTE_CANDIDATE")?.attempts, 9);
  const all = outcomesInScope(rows, refusals, null);
  assert.equal(all.find((o) => o.outcome === "REFUSED")?.attempts, 1814);
  assert.equal(all.find((o) => o.outcome === "REFUSED")?.topRefusal?.count, 1814);
  assert.equal(all[0].outcome, "ROUTE_CANDIDATE", "what was found comes first, what was refused last");
  assert.equal(all[all.length - 1].outcome, "REFUSED");
});

test("a fraction of a cent per attempt says so instead of rounding to a free-looking $0.00", () => {
  assert.equal(perAttempt(3.41, 1862), "under $0.01");
  assert.equal(perAttempt(0, 814), "$0.00", "a measured zero is a zero");
  assert.equal(perAttempt(88.62, 136), "$0.65");
  assert.equal(perAttempt(1, 0), "—");
});

test("a read that got in but listed no meetings is never counted as confirming nothing changed", () => {
  const tiles = resultTiles({
    outcomes: [],
    day: { bodiesRead: 119, reads: 2709, gotIn: 1424, versions: 1023, changedReads: 614, cannotTell: 381, added: 293, changed: 5026, removed: 10 },
    window: "every paid attempt on record",
  });
  const confirm = tiles.find((t) => t.title === "Confirming nothing changed")!;
  assert.match(confirm.lines[0], /^409 reads in the last 24 hours got in and confirmed nothing had changed\./, "confirmations are unchanged promoted versions only");
  assert.match(confirm.lines[1], /381 more reads got in but found the source listing no meetings/);
  const nothing = tiles.find((t) => t.title === "Work that produced nothing useful")!;
  assert.ok(nothing.lines.some((l) => /1,285 routine reads in the last 24 hours could not get in/.test(l)));
  const change = tiles.find((t) => t.title === "Catching a change")!;
  assert.ok(change.lines.some((l) => /overstate what actually changed/.test(l)), "the churn is admitted beside the count");
});

test("a ledger place key reads as the place, from its own parts", () => {
  assert.equal(placeWords("state-nj-county-morris-place-harding-township"), "Harding Township, Morris County");
  assert.equal(placeWords("state-nh-county-merrimack"), "Merrimack County");
  assert.equal(placeWords("state-az-sldl-28"), "State House district 28");
  assert.equal(placeWords("state-az"), "Statewide");
});

test("the fix list: unique ids, every item says where it stands and what to check first, and marks order without dropping", () => {
  const ids = FIX_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const i of FIX_ITEMS) {
    assert.ok(i.standing.length > 20, `${i.id} does not say where it stands`);
    assert.ok(i.checkFirst.length > 20, `${i.id} does not say what to check first`);
  }
  assert.doesNotMatch(FIX_ITEMS.map((i) => `${i.body} ${i.standing} ${i.checkFirst}`).join(" "), /\$25 a day|routeFor\(|dev\/gra-evidence/, "the package's stale facts are not repeated");
  const ordered = orderByMarks(FIX_ITEMS, { "MW-012": "NOT_NOW", "MW-011": "MUST" });
  assert.equal(ordered.length, FIX_ITEMS.length);
  assert.equal(ordered[ordered.length - 1].id, "MW-012", "Not now goes last");
  assert.ok(ordered.findIndex((i) => i.id === "MW-011") < ordered.findIndex((i) => i.id === "MW-012"));
});

test("a routine assignment's trail follows the version that changed what readers see, and names the version serving now beside it", () => {
  // The shape of a real record: Tucson's Commission on Disability Issues gained a meeting on 2026-09-22, and every later read changed nothing.
  const contract: WatchedContract = {
    id: "meetings:clerksboards:tucson-cdi",
    scope: "source:clerksboards:body:tucson-cdi",
    bodyId: "ocd-division/country:us/state:az/place:tucson#commission-on-disability-issues",
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    meetingSource: "clerksboards",
    jurisdiction: "Tucson",
    publishingOrg: "City of Tucson",
    sourceUrl: "https://www.tucsonaz.gov/clerks/boards",
    verifiedAt: null,
    cadence: { description: "every hour", defaultEveryMs: 3_600_000 },
    retry: { afterMs: 900_000, description: "fifteen minutes later" },
  };
  const CHANGE = "cv-71b8dedc288199322814033059d8efdc";
  const NOW_SERVING = "cv-afec3ea631973487c7f8119b2563959a";
  const current: VersionFacts = {
    scope: contract.scope, versionId: NOW_SERVING, promotedAt: "2026-09-23T15:08:22.614Z", meetings: 7, fresh: 7, carried: 0, docs: 0, noAgendaLink: 0,
    noAgendaAhead: 0, upcoming: 3, furthestAhead: "2027-01-20T22:30:00.000Z", bodyName: "Commission on Disability Issues", jurisdiction: "Tucson",
    outcome: "UNCHANGED", added: 0, changed: 0, removed: 0, held: 0,
  };
  const store: BodyStoreFacts = {
    asOf: NOW,
    versions: [current],
    attempts: [{ scope: contract.scope, candidateId: NOW_SERVING, state: "PROMOTED", failureCode: null, failureDetail: null, acquisitionSucceeded: true, attemptedAt: "2026-09-23T15:08:22.500Z" }],
    readbacks: [
      { candidateId: CHANGE, at: "2026-09-22T00:05:16.603Z", passed: true },
      { candidateId: CHANGE, at: "2026-09-22T09:00:00.000Z", passed: true },
      { candidateId: NOW_SERVING, at: "2026-09-23T17:34:17.881Z", passed: true },
    ],
    day: [],
    changes: [{
      scope: contract.scope, versionId: CHANGE, retrievedAt: "2026-09-22T00:05:14.274Z", promotedAt: "2026-09-22T00:05:14.479Z", validatedAt: "2026-09-22T00:05:14.479Z",
      added: 1, changed: 0, removed: 0, held: 0, meetingsAdded: 1, named: [{ title: "Commission on Disability Issues", startsAt: "2027-01-20T15:30:00-07:00" }],
    }],
  };
  const trailOf = (facts: BodyStoreFacts) => {
    const [body] = buildBodyViews({ contracts: [contract], store: facts, nowIso: NOW, zipOf: () => "85701" });
    const [promoted] = routineDetail(body).promoted;
    return new Map(promoted.trail);
  };

  const trail = trailOf(store);
  assert.equal(trail.get("Source"), "Clerk's board page — https://www.tucsonaz.gov/clerks/boards");
  assert.equal(trail.get("Retrieved"), "September 21, 8:05 PM ET — the read that found the change");
  assert.equal(trail.get("What changed"), "1 added, 0 changed, 0 removed (a record is a meeting or one of its agenda documents). New meeting: Commission on Disability Issues, January 20, 2027, 5:30 PM ET");
  assert.equal(trail.get("Validation"), "Passed September 21, 8:05 PM ET — every applicable check");
  assert.equal(trail.get("Promoted"), "Version cv-71b8dedc2881… at September 21, 8:05 PM ET");
  assert.match(trail.get("Public destination") ?? "", /\/\?zip=85701 — its meetings list$/);
  assert.match(trail.get("Checked") ?? "", /^September 21, 8:05 PM ET, through the reader's own projection/, "checked when the Reader FIRST read the change back");
  assert.equal(trail.get("Serving now"), "Version cv-afec3ea63197…, promoted September 23, 11:08 AM ET by a later read that changed nothing; read back September 23, 1:34 PM ET");

  // A changed meeting is named too, so "1 changed" says which (Morris County withdrew an agenda on 2026-09-23).
  const withdrawn = trailOf({
    ...store,
    changes: [{ ...store.changes![0], added: 0, changed: 1, meetingsAdded: 0, named: [], meetingsChanged: 1, changedNamed: [{ title: "Board of County Commissioners - Regular Meeting", startsAt: "2026-09-23T19:00:00-04:00" }] }],
  });
  assert.equal(withdrawn.get("What changed"), "0 added, 1 changed, 0 removed (a record is a meeting or one of its agenda documents). Changed meeting: Board of County Commissioners - Regular Meeting, September 23, 2026, 7:00 PM ET");

  // With no changing version on record, the trail is the version serving now, as it is — never a borrowed change.
  const fallback = trailOf({ ...store, changes: [] });
  assert.equal(fallback.get("What changed"), "Nothing — this version re-confirmed what readers already had");
  assert.equal(fallback.has("Serving now"), false);
  assert.equal(fallback.has("Last change"), false, "an empty history that was read is not a failure to read it");

  // A change history that did not answer is said to be unread, never shown as no change.
  const unread = trailOf({ ...store, changes: null });
  assert.match(unread.get("Last change") ?? "", /^Not read this time/);
  assert.equal(unread.get("What changed"), "Nothing — this version re-confirmed what readers already had", "the version serving now is still shown as it is");
});

test("the scope travels in the URL and an unreadable scope is everywhere, never a guess", () => {
  const pima = parseScope("az.county.04019");
  assert.deepEqual(pima, { kind: "geo", type: "county", geoid: "04019", state: "az" });
  assert.equal(scopeParam(pima), "az.county.04019");
  assert.deepEqual(parseScope("az.cd.0406"), { kind: "geo", type: "congressional_district", geoid: "0406", state: "az" });
  assert.deepEqual(parseScope("nonsense!"), { kind: "all" });
  assert.deepEqual(parseScope(undefined), { kind: "all" });
  assert.equal(withScope("/admin/money", pima, { view: "work" }), "/admin/money?scope=az.county.04019&view=work");
  assert.equal(withScope("/admin", { kind: "all" }), "/admin");
});
