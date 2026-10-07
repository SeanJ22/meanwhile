import assert from "node:assert/strict";
import test from "node:test";

import { buildBodyViews, nowFigures, type BodyStoreFacts, type VersionFacts, type WatchedContract } from "@/lib/control-plane/admin-view/bodies.ts";
import { lateWords, sharedRead } from "@/app/(admin)/_mw/data/shared-read.ts";
import { parseScope, scopeParam, withScope } from "@/app/(admin)/_mw/scope.ts";

/**
 * The honesty rules the Money and Fix list screens make, proven on their pure
 * models: an unread provider is never a number, a bill is never added to the
 * ledger, a state never borrows another state's counts, a fraction of a cent
 * never rounds to a free-looking $0.00, a zero-listing read is never counted
 * as a confirmation, and the marks order the list without dropping an item.
 */

const NOW = "2026-09-23T16:00:00.000Z";

test("a body read through two sources holds at least its larger source, and every total over it says it is a floor", () => {
  // One board: 12 meetings through Legistar InSite, 15 through Legistar.
  const contract = (id: string, source: string): WatchedContract => ({
    id: `meetings:${source}:pima-bos`,
    scope: `source:${source}:body:pima-bos`,
    bodyId: "ocd-division/country:us/state:az/county:pima#board-of-supervisors",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    meetingSource: source,
    jurisdiction: "Pima County",
    publishingOrg: "Pima County",
    sourceUrl: null,
    verifiedAt: null,
    cadence: { description: "every hour", defaultEveryMs: 3_600_000 },
    retry: { afterMs: 900_000, description: "fifteen minutes later" },
  });
  const version = (source: string, versionId: string, promotedAt: string, meetings: number): VersionFacts => ({
    scope: `source:${source}:body:pima-bos`, versionId, promotedAt, meetings, fresh: meetings, carried: 0, docs: 0, noAgendaLink: 0, noAgendaAhead: 0,
    upcoming: 2, furthestAhead: null, bodyName: "Board of Supervisors", jurisdiction: "Pima County", outcome: "UNCHANGED", added: 0, changed: 0, removed: 0, held: 0,
  });
  const views = buildBodyViews({
    contracts: [contract("a", "legistar"), contract("b", "legistar-insite")],
    nowIso: NOW,
    store: {
      asOf: NOW,
      versions: [version("legistar", "cv-legistar", "2026-09-23T14:00:00.000Z", 15), version("legistar-insite", "cv-insite", "2026-09-23T15:00:00.000Z", 12)],
      attempts: [],
      readbacks: [{ candidateId: "cv-insite", at: "2026-09-23T15:00:05.000Z", passed: true }, { candidateId: "cv-legistar", at: "2026-09-23T14:00:05.000Z", passed: true }],
      day: [],
    },
  });
  assert.equal(views.length, 1, "two sources, one body (MW-003)");
  assert.equal(views[0].records, 15, "the larger source, not the newer one's 12");
  assert.equal(views[0].recordSources, 2);
  assert.equal(views[0].readerVisible, 15);
  const figures = nowFigures(views);
  assert.equal(figures.records, 15);
  assert.equal(figures.recordsFloor, true, "a total over a two-source body is a floor");
});

test("a shared read loads once for every caller at once, serves a recent read while refreshing, and says so when it misses its deadline", async () => {
  let clock = 0;
  let loads = 0;
  type R = { readonly kind: "HELD"; readonly n: number } | { readonly kind: "UNREAD"; readonly detail: string };
  const reader = sharedRead<R>(
    { freshMs: 100, staleMs: 1_000, deadlineMs: 30, keep: (r) => r.kind === "HELD", late: (ms) => ({ kind: "UNREAD", detail: lateWords("The test read", ms) }) },
    () => clock,
  );
  const slow = (n: number, ms: number) => () => {
    loads += 1;
    return new Promise<R>((resolve) => setTimeout(() => resolve({ kind: "HELD", n }), ms));
  };

  // Three callers at once share one load.
  const three = await Promise.all([reader.read(slow(1, 5)), reader.read(slow(1, 5)), reader.read(slow(1, 5))]);
  assert.equal(loads, 1);
  assert.deepEqual(three.map((r) => (r.kind === "HELD" ? r.n : null)), [1, 1, 1]);

  // Fresh: no load at all.
  clock = 50;
  assert.deepEqual(await reader.read(slow(2, 5)), { kind: "HELD", n: 1 });
  assert.equal(loads, 1);

  // Recent: the held read is served at once and a fresh one runs behind it.
  clock = 500;
  assert.deepEqual(await reader.read(slow(2, 5)), { kind: "HELD", n: 1 });
  assert.equal(loads, 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await reader.read(slow(3, 5)), { kind: "HELD", n: 2 }, "the refreshed read replaced the recent one");

  // Too old to serve, and slower than the deadline: named as not read, never a blank; the late answer is kept for the next caller.
  clock = 5_000;
  const late = await reader.read(slow(4, 80));
  assert.equal(late.kind, "UNREAD");
  assert.match(late.kind === "UNREAD" ? late.detail : "", /^The test read did not answer within 0 seconds, so it is not shown this time\. .*not the same as there being none\.$/);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(await reader.read(slow(5, 5)), { kind: "HELD", n: 4 });

  // A failed read is never kept.
  reader.reset();
  const failed = await reader.read(async () => ({ kind: "UNREAD", detail: "down" }) as R);
  assert.equal(failed.kind, "UNREAD");
  assert.deepEqual(await reader.read(slow(6, 5)), { kind: "HELD", n: 6 }, "the next caller reads again");
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

test("a read our own code failed is never shown as the site refusing us: the ingest's JOB_FAILURE mark reads as ours, with engineering next", () => {
  // A failure in our own handling, recorded as SOURCE_BLOCKED / SOURCE_RETRIEVAL_FAILED, carries the ingest's JOB_FAILURE mark.
  const contract: WatchedContract = {
    id: "meetings:legistar-insite:pima-bos",
    scope: "source:legistar-insite:body:pima-bos",
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    meetingSource: "legistar-insite",
    jurisdiction: "Pima County",
    publishingOrg: "Pima County",
    sourceUrl: "https://pima.legistar.com/Calendar.aspx",
    verifiedAt: null,
    cadence: { description: "every hour", defaultEveryMs: 3_600_000 },
    retry: { afterMs: 900_000, description: "fifteen minutes later" },
  };
  const failedWith = (failureDetail: string): BodyStoreFacts => ({
    asOf: NOW,
    versions: [],
    readbacks: [],
    day: [],
    changes: [],
    attempts: [{ scope: contract.scope, candidateId: "cv-pima-bos", state: "SOURCE_BLOCKED", failureCode: "SOURCE_RETRIEVAL_FAILED", failureDetail, acquisitionSucceeded: false, attemptedAt: "2026-09-23T15:08:22.500Z" }],
  });
  const view = (failureDetail: string) => buildBodyViews({ contracts: [contract], store: failedWith(failureDetail), nowIso: NOW, zipOf: () => ({ kind: "NONE" }) })[0];

  const ours = view("JOB_FAILURE: our own code or configuration failed before the publisher could answer; this is not a publisher wall. VENUE_RESOLUTIONS_MISSING: 3 sittings have no reviewed venue");
  assert.equal(ours.deadEnd?.title, "The last read did not reach the site: our own code or configuration failed first, so this is not the site refusing us — VENUE_RESOLUTIONS_MISSING: 3 sittings have no reviewed venue");
  assert.equal(ours.deadEnd?.wouldSettle, "A fix to our adapter or its configuration for https://pima.legistar.com/Calendar.aspx; the site itself was never asked.");
  assert.match(ours.deadEnd?.whoMoves ?? "", /^Engineering: our adapter or its configuration has to change\. The runner retries on its clock \(fifteen minutes later after a failure\), but the same code fails the same way\.$/);
  assert.doesNotMatch(JSON.stringify(ours), /could not get in/, "no line of the body says the site refused us");

  // A publisher that did refuse keeps the wall's words and the runner's clock.
  const wall = view("HTTP 403 from pima.legistar.com");
  assert.equal(wall.deadEnd?.title, "The last read could not get in: the site refused or failed the request — HTTP 403 from pima.legistar.com");
  assert.match(wall.deadEnd?.whoMoves ?? "", /^The runner reads it again on its clock/);
});
