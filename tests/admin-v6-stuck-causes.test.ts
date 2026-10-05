import assert from "node:assert/strict";
import test from "node:test";
import { ageOf, causeOf, placeKeyOfRow, sendWordsFor, stateOfRow, type StuckRowLike } from "../lib/control-plane/admin-view/blocker-causes.ts";
import { STUCK_INDEX_SQL, stuckViews } from "../lib/control-plane/admin-view/v6-stuck-read.ts";
import { parseDispatchTarget, unitMatchesTarget } from "../lib/control-plane/scheduler/dispatch-target.ts";

const row = (id: string, blocker: string | null, extra: Partial<StuckRowLike> = {}): StuckRowLike => ({
  id, state: "FAILED", lane: "SCOUT", owner: "RUNNER", blocker, label: "Candidate enrichment via Candidate Web Index 4get", subjectName: "AZ 2026 General Web Index",
  stateCode: null, overdue: true, band: 2, waitingSince: null, eligibleAt: "2026-09-19T21:16:39.484Z", lastActivityAt: null, nextAction: "The runner sends a hunter again.",
  assignmentKeys: [], ...extra,
});

test("each kind of blocker lands in one plain cause, and twins with different numbers share it", () => {
  const cases: [string, string][] = [
    ["The model provider did not answer the hunter, so nothing it said stands (the model transport failed).", "provider-silent"],
    ["The attempt stopped early: the worker reached no boundary. nothing was reached at api.marginalia.nu: This operation was aborted", "service-timeout"],
    ["The attempt stopped early: the worker reached no boundary. HTTP 206 from api.wikimedia.org, 12 bytes, and the declared yield contract was NOT satisfied", "too-little"],
    ["The hunter found no route and no record (15 rungs walked, 10 rungs backed by evidence); it named 5 next rungs to try.", "no-route"],
    ["It needs an adapter this system does not have yet — a missing capability of ours, not a fact about the source: CITY OF BENSON", "needs-adapter"],
    ["The attempt stopped early: WORKER_ARTIFACT_NOT_IN_VAULT", "page-missing"],
    ["No worker has reached it yet: the runner has not dispatched it.", "not-reached"],
  ];
  for (const [text, key] of cases) assert.equal(causeOf(row("a", text)).key, key, key);
  assert.equal(causeOf(row("a", "The hunter found no route and no record (9 rungs walked, 6 rungs backed by evidence); it named 4 next rungs to try.")).key,
    causeOf(row("b", "The hunter found no route and no record (12 rungs walked, 7 rungs backed by evidence); it named 5 next rungs to try.")).key);
  assert.equal(causeOf(row("a", "needs an adapter this system does not have", { owner: "ENGINEERING" })).lane, "software");
  assert.equal(causeOf(row("a", "Only a human or offline act remains", { owner: "OWNER" })).lane, "decision");
});

test("an unknown cause groups with its twins by its own words, and a missing reason says so", () => {
  const a = causeOf(row("a", "A wall at the source stopped this at 2026-09-19T21:16:39Z after 3 tries."));
  const b = causeOf(row("b", "A wall at the source stopped this at 2026-09-20T01:00:00Z after 7 tries."));
  assert.equal(a.key, b.key);
  assert.match(a.key, /^other:/);
  assert.match(causeOf(row("c", null)).words, /gives no reason/);
});

test("a row's state comes from its id's structure, never from two letters found inside it", () => {
  assert.equal(stateOfRow(row("freshness:candidate-enrichment:nj:2026:state-nj-place-boonton:de-venezia-marie#x", null)), "nj");
  assert.equal(stateOfRow(row("x", null, { stateCode: "AZ" })), "az");
  assert.equal(placeKeyOfRow(row("x", null, { stateCode: "az", assignmentKeys: ["zcta:2020/85635"] })), "geo:az.zcta.85635");
  assert.equal(placeKeyOfRow(row("x", null, { stateCode: "az" })), "st:az");
  assert.equal(placeKeyOfRow(row("unknown", null)), "us");
});

test("send words are read by the runner's own target reader: the state matches, no stray word becomes a term", () => {
  const words = sendWordsFor({ stateNames: ["Arizona"], zip: "85635", subject: "AZ 2026 General Web Index", label: "Candidate enrichment via Candidate Web Index 4get" });
  assert.equal(words, "Deploy fleet to Arizona 85635 4get");
  const target = parseDispatchTarget(words!);
  assert.deepEqual(target.states, ["az"]);
  assert.ok(!target.terms.includes("agents") && !target.terms.includes("deploy") && !target.terms.includes("fleet"));
  const stateOnly = parseDispatchTarget(sendWordsFor({ stateNames: ["Arizona"], zip: null, subject: null, label: null })!);
  assert.deepEqual(stateOnly.terms, []);
  assert.ok(unitMatchesTarget(stateOnly, { id: "freshness:jurisdiction:az:school:x#y", subjectId: "az:school:x" }));
  assert.ok(!unitMatchesTarget(stateOnly, { id: "freshness:jurisdiction:nj:school:x#y", subjectId: "nj:school:x" }));
  assert.equal(sendWordsFor({ stateNames: [], zip: null, subject: "x", label: "y" }), null, "no state, nothing the runner could be sent to");
});

test("age is from the earliest time the row names, and never guessed when it names none", () => {
  const now = "2026-09-30T00:00:00.000Z";
  assert.deepEqual(ageOf({ waitingSince: null, eligibleAt: "2026-09-19T00:00:00.000Z", lastActivityAt: "2026-09-25T00:00:00.000Z" }, now), { words: "for 11 days", rank: 11 });
  assert.equal(ageOf({ waitingSince: null, eligibleAt: null, lastActivityAt: null }, now).words, "for an unknown time");
});

test("the views count every stuck row by cause, list the most urgent, scope them, and put send-agents on items and groups", () => {
  const rows = [
    row("freshness:a:az:1", "The model provider did not answer the hunter.", { stateCode: "az", assignmentKeys: ["zcta:2020/85635"] }),
    row("freshness:a:az:2", "The model provider did not answer the hunter.", { stateCode: "az" }),
    row("freshness:a:nh:3", "The model provider did not answer the hunter.", { stateCode: "nh" }),
    row("freshness:a:nj:4", "It needs an adapter this system does not have yet", { stateCode: "nj", owner: "ENGINEERING" }),
    row("x-no-state", "No worker has reached it yet: the runner has not dispatched it.", { state: "WAITING" }),
  ];
  const all = stuckViews(rows, "us", "2026-09-30T00:00:00.000Z");
  assert.equal(all.total, 5);
  const silent = all.sameCause.find((g) => g.key === "provider-silent")!;
  assert.equal(silent.count, "3");
  assert.deepEqual(silent.action?.payload, { words: "Deploy fleet to Arizona and New Hampshire" });
  assert.equal(silent.action?.target, "us");
  assert.equal(all.items.find((i) => i.id === "x-no-state")!.actions.length, 0, "a row with no state has nothing the fleet can be sent to");
  assert.equal(all.items.find((i) => i.id === "freshness:a:nj:4")!.lane, "software");
  const zip = stuckViews(rows, "geo:az.zcta.85635", "2026-09-30T00:00:00.000Z");
  assert.deepEqual(zip.items.map((i) => i.id).sort(), ["freshness:a:az:1", "freshness:a:az:2"], "the ZIP's own row and the state-wide row that covers it; nothing from other states");
  assert.equal(zip.sameCause[0].action?.target, "st:az");
  const az = stuckViews(rows, "st:az", "2026-09-30T00:00:00.000Z");
  assert.equal(az.total, 2);
  assert.match(STUCK_INDEX_SQL, /allRowsIndex/, "the published index is unpacked in the database, not loaded whole");
  assert.match(STUCK_INDEX_SQL, /FAILED.*BLOCKED.*UNKNOWN/);
});

import { causeOf as br09CauseOf, needOf as br09NeedOf } from "../lib/control-plane/admin-view/blocker-causes.ts";
test("BR-09: unowned work goes to the team; every decision-lane cause names one of the five reasons", () => {
  const nobody = br09CauseOf({ state: "STUCK", owner: "NOBODY", blocker: "something odd", overdue: false });
  assert.equal(nobody.lane, "auto");
  assert.equal(nobody.owner, "The runner (unassigned)");
  assert.equal(nobody.needs, null);
  const owner = br09CauseOf({ state: "STUCK", owner: "OWNER", blocker: "the budget ceiling is reached", overdue: false });
  assert.equal(owner.lane, "decision");
  assert.equal(owner.needs, "money");
  assert.equal(br09NeedOf("needs an api key"), "credentials");
  assert.equal(br09NeedOf("needs a data license"), "contract");
  assert.equal(br09NeedOf("our vendor account lapsed"), "platform");
  assert.equal(br09NeedOf(null), "broken");
});
