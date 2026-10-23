import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { officialsCheckAction, officialsLeadPlan } from "../lib/control-plane/gateway/officials-action.ts";
import { confirmReceipt } from "../lib/control-plane/gateway/confirmation.ts";
import { readOfficialsResults } from "../lib/control-plane/admin-view/officials-results.ts";
import { resolveOfficialsScope } from "../lib/control-plane/admin-view/officials-scope.ts";
import { listDoors } from "../lib/doors/registry.ts";
import { recordDoorOutcome } from "../lib/doors/outcome.ts";
import { readNowDueRequests, settleReadNow } from "../lib/doors/mission-refresh.ts";
import { peopleDoorCovers } from "../lib/doors/people-feeds.ts";
import { feedDoorDrafts } from "../lib/doors/seed-feeds.ts";
import { routineDueRequestFor } from "../lib/civic-data/routine-due-request.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import type { RosterChange } from "../lib/officials/roster-changes.ts";
import type { ReadOnlyQuery, Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { refreshOfficialsLeads, officialsLeadProvider, officialsLeadStatus } from "../lib/control-plane/officials-leads.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withExpansionScopes } from "../lib/control-plane/gateway/admin-config.ts";
import { withScopeSet } from "../lib/control-plane/expansion/scopes.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

const NOW = "2026-10-13T05:00:00.000Z", PASS = "2026-10-13T05:01:00.000Z";
const COUNTRY = "ocd-division/country:us", FL = `${COUNTRY}/state:fl`;
const CLERK = "https://clerk.house.gov/xml/lists/MemberData.xml";
const request = (note: string | null, key: string) => ({ type: "officials.checkNow", subject: "st:fl", input: { placeKey: "st:fl", note }, caller: "OWNER_SESSION" as const,
  actorRef: "fixture-session", stateVersion: null, idempotencyKey: key });
const deps = (repos: ReturnType<typeof createMemoryRepositories>) => ({ repos, now: () => NOW, currentStateVersion: null, codeSha: null });
const flPeopleDoors = () => feedDoorDrafts().filter(draft => peopleDoorCovers({ doorId: draft.doorId, holds: draft.holds ?? [], config: draft.config ?? {} }, [FL])).map(draft => draft.doorId).sort();

test("every registered people source over a state, its national sources included, is covered without a per-state list", () => {
  const ids = flPeopleDoors();
  for (const id of ["feed:people-official-state-people-fl", "feed:people-statewide-executive-sources-fl", "feed:people-legiscan-api-fl",
    "feed:congress-bulk-roster:FL", "feed:people-statewide-executive-sources-us"]) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some(id => id.includes("portraits")), "portraits are separate standing work, not an officials check");
  assert.ok(!ids.some(id => /-az$|:AZ$/.test(id)), "another state's sources are not read for Florida");
  for (const state of ["ak", "wy", "pr"]) assert.ok(feedDoorDrafts().some(draft => draft.doorId === `feed:people-official-state-people-${state}` &&
    peopleDoorCovers({ doorId: draft.doorId, holds: draft.holds ?? [], config: draft.config ?? {} }, [`${COUNTRY}/${state === "pr" ? "territory" : "state"}:${state}`])), state);
});

test("an Admin state check marks its people sources, the next pass reads them, and the sourced seat changes show", async t => {
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  const outcome = await submit(request(null, "officials-fl-01"), deps(repos));
  assert.equal(outcome.ok, true, outcome.receipt.says);
  assert.equal(outcome.receipt.outcome, "QUEUED");
  assert.equal(outcome.receipt.readBackAt, "/admin?scope=fl&view=now");
  const expected = flPeopleDoors();
  assert.deepEqual(outcome.receipt.openedWork.map(work => work.id).sort(), expected, "the first check creates registered people doors before door derivation runs");
  const doors = (await listDoors(repos.doors)).doors;
  for (const id of expected) assert.equal(doors.find(door => door.doorId === id)?.readNow, true, id);
  assert.equal((await confirmReceipt(repos, outcome.receipt, Date.parse(NOW))).state, "waiting");
  assert.equal((await submit(request(null, "officials-fl-01"), deps(repos))).replayed, true);

  // Each marked feed is an ordinary due request for its own registered contract on the next pass.
  const due = readNowDueRequests(doors, new Set(["people-official-state-people-fl", "congress-bulk-roster:FL"]), NOW);
  assert.deepEqual(due.map(row => row.contractId).sort(), ["congress-bulk-roster:FL", "people-official-state-people-fl"]);
  const task = { id: "people-official-state-people-fl", recordClass: "STATE_LEGISLATOR", contract: {} };
  assert.equal(routineDueRequestFor(task, undefined, Date.parse(NOW), due)?.requestedAt, NOW);
  assert.equal(routineDueRequestFor(task, { lastAttemptedAt: PASS }, Date.parse(PASS), due), null, "the pass's own attempt spends the request");

  const changes = new Map<string, readonly RosterChange[]>([
    ["US-FL:current-congress-directory", [{ kind: "vacant", name: null, divisionId: `${FL}/cd:20`, officeTitle: "U.S. Representative", since: "2026-04-21", sourceUrl: CLERK }]],
    ["US-FL:people:official-state-people:v1", [{ kind: "appointed", name: "New Member", divisionId: `${FL}/sldl:5`, officeTitle: "State Representative", sourceUrl: "https://www.flhouse.gov/" },
      { kind: "appointed", name: "Elsewhere", divisionId: "ocd-division/country:us/state:ga/sldl:1", officeTitle: "State Representative", sourceUrl: "https://www.legis.ga.gov/" }]],
  ]);
  t.mock.method(store, "readPromotion", async (_recordClass: string, scope: string) => changes.has(scope) ? { scope, versionId: scope, promotedAt: PASS } as PromotedProjection : null);
  t.mock.method(store, "readCandidate", async (id: string) => ({ candidate: { normalizedPayload: { changes: changes.get(id) } } } as CandidateVersionRecord));
  const waiting = await readOfficialsResults({ repos, store, placeKey: "st:fl" });
  assert.ok(!("says" in waiting) && waiting.status === "waiting" && waiting.changes.length === 0, "a mark is not a check");
  for (const id of expected) await recordDoorOutcome(repos.doors, id, "SUCCESS", PASS, id === "feed:congress-bulk-roster:FL" || id === "feed:people-official-state-people-fl");
  assert.equal(await settleReadNow(repos.doors, PASS), expected.length);
  const read = await readOfficialsResults({ repos, store, placeKey: "st:fl" });
  assert.ok(!("says" in read)); if ("says" in read) return;
  assert.equal(read.status, "done");
  assert.ok(read.feeds.every(feed => feed.checkedAt === PASS));
  assert.equal(read.feeds.find(feed => feed.id === "feed:people-official-state-people-fl")?.sourceUrl, "https://www.flhouse.gov/Sections/Representatives/representatives.aspx",
    "the legislature's own roster page is the source Admin links");
  assert.equal(read.feeds.filter(feed => feed.state === "changed").length, 2);
  assert.deepEqual(read.changes.map(change => change.name ?? change.kind).sort(), ["New Member", "vacant"], "another state's change is not listed for Florida");
  assert.equal(read.changes.find(change => change.kind === "vacant")?.sourceUrl, CLERK);
  const confirmation = await confirmReceipt(repos, outcome.receipt, Date.parse(PASS));
  assert.equal(confirmation.state, "applied");
  assert.deepEqual(confirmation.progress, { done: expected.length, of: expected.length });

  await recordDoorOutcome(repos.doors, "feed:people-legiscan-api-fl", "FAILURE", "2026-10-13T05:02:00.000Z");
  const failed = await readOfficialsResults({ repos, store, placeKey: "st:fl" });
  assert.ok(!("says" in failed) && failed.status === "failed");
  assert.ok(!("says" in failed) && failed.changes.length === 2, "one failed source never hides another source's published facts");

  // A later check renews every mark, so a read that finished before it cannot spend it.
  const again = await submit(request(null, "officials-fl-02"), { ...deps(repos), now: () => "2026-10-13T06:00:00.000Z" });
  assert.equal(again.ok, true);
  assert.ok((await listDoors(repos.doors)).doors.filter(door => expected.includes(door.doorId)).every(door => door.readNow && door.updatedAt === "2026-10-13T06:00:00.000Z"));
});

test("a lead stays in Scout instructions, makes no candidate, and keeps the paid controls unchanged", async () => {
  const repos = createMemoryRepositories();
  const note = "I heard the Florida House seat opened.";
  const result = await submit(request(note, "officials-note-01"), deps(repos));
  assert.equal(result.ok, true);
  const lead = result.receipt.openedWork.find(work => work.kind === "officials-lead")!;
  const row = (await repos.obligations.mustRead(lead.id)).value;
  assert.equal(row.lastWorkedAt, null);
  assert.equal(row.active, false, "a note cannot open paid work where no applicable funded mission exists");
  assert.deepEqual(row.assignments, []);
  assert.equal(row.autonomousPlan?.contract.recordClass, "OFFICIAL_ROSTER");
  assert.ok(row.autonomousPlan?.contract.completenessScope.includes(note));
  assert.ok(row.autonomousPlan?.seedUrls.includes("https://clerk.house.gov/"));
  assert.ok(row.autonomousPlan?.seedUrls.includes("https://www.flsenate.gov/Senators"), "the state's own legislature roster seeds the Scout");
  assert.ok(!row.autonomousPlan?.seedUrls.some(url => /github|openstates|legiscan|wikidata/.test(url)), "mirror pages cannot verify an owner's change lead");
  assert.equal((await repos.scoutResults.readAll()).length, 0);
  assert.equal((await repos.adminConfig.list()).length, 0);
  assert.equal((await repos.costs.readAll()).length, 0);
});

test("a funded mission admits a queued lead under its real budget and only verified work retires it", async () => {
  const repos = createMemoryRepositories();
  const result = await submit(request("Verify the reported departure", "officials-budget-01"), deps(repos));
  const leadId = result.receipt.openedWork.find(work => work.kind === "officials-lead")!.id;
  assert.equal((await refreshOfficialsLeads(repos, NOW))[0].active, false);
  const scopes = withScopeSet([], { geography: { type: "state", geoid: "12", version: "state:2020", label: "Florida", stateAbbr: "FL" },
    budgetUsd: 5, priority: 1, note: null, decidedAt: NOW, decidedBy: "fixture-session", receiptId: "expansion.scope.set:fl-fixture" }).scopes;
  await repos.adminConfig.put(ADMIN_CONFIG_ID, withExpansionScopes(defaultAdminConfig(NOW), { scopes, decidedAt: NOW }), NOW);
  const rows = await refreshOfficialsLeads(repos, PASS);
  assert.equal(rows[0].active, true);
  assert.deepEqual(rows[0].assignments?.map(mark => [mark.assignmentKey, mark.ref]), [[scopes[0].key, scopes[0].receiptId]]);
  const registry = buildRegistry([officialsLeadProvider(rows)], { root: "/fixture", nowIso: PASS });
  assert.equal(registry.units[0].obligation.id, leadId);
  assert.equal(registry.units[0].route.executorClass, "BOUNDED_MODEL_WORKER");
  await syncObligations(repos, registry.units.map(unit => unit.obligation), PASS, { exactReads: true });
  assert.equal((await repos.obligations.mustRead(leadId)).value.officialsLead?.receiptId, result.receipt.receiptId);
  const held = await repos.obligations.mustRead(leadId);
  await repos.obligations.compareAndSet(leadId, held.revision, { ...held.value, lastWorkedAt: PASS }, PASS);
  assert.equal((await refreshOfficialsLeads(repos, PASS))[0].active, true, "an attempted source or no-yield disposition does not settle the report");
  assert.equal((await officialsLeadStatus(repos, leadId)).state, "waiting");
  const plan = (await repos.obligations.mustRead(leadId)).value.autonomousPlan!;
  const item = { ...createWorkItem({ project: "freshness", subject: plan.contract.subjectId, obligation: `${leadId}#1`, why: "Check official-source evidence", now: NOW }),
    autonomousPlan: plan, state: "VERIFIED_COMPLETE" as const };
  await repos.workItems.put(item.id, item, PASS);
  const settled = await refreshOfficialsLeads(repos, PASS);
  assert.equal(settled[0].active, false);
  assert.equal(settled[0].retiredAt, PASS);
  assert.equal(officialsLeadProvider(settled).enumerate({ root: "/fixture", nowIso: PASS }).obligations.length, 0);
  assert.equal((await officialsLeadStatus(repos, leadId)).state, "checked");
});

function geoRow(state: string, type = "county", geoid = "12011", id = `${FL}/county:broward`): Row {
  return { row_kind: "grouping", type, geoid, version: `${type}:2020`, ocd_id: id, label: "Broward County", state_fips: "12", state_abbr: state,
    member_states: [state], overlaps: [{ zcta5: "33301", whole: false, fraction: 0.5 }] };
}

test("county, district and ZIP checks resolve held geography and reject a forged state or division", async () => {
  const query: ReadOnlyQuery = async statements => statements.map((statement, index) => index === 0 ? [{ version_id: "fixture-geography" }] :
    statement.text.includes("AS known") ? [{ known: true }] : [geoRow("FL", statement.params[2] instanceof Array && statement.params[2].length === 1 ? String(statement.params[2][0]) : "county",
      String(statement.params[3]), statement.params[3] === "1220" ? `${FL}/cd:20` : `${FL}/county:broward`)]);
  assert.ok((await resolveOfficialsScope("geo:fl.county.12011", query)).ok);
  assert.ok((await resolveOfficialsScope("geo:fl.congressional_district.1220", query)).ok);
  const zip = await resolveOfficialsScope("geo:fl.zcta.33301", query);
  assert.ok(zip.ok);
  if (zip.ok) assert.ok(zip.divisions.includes(FL));
  assert.equal((await resolveOfficialsScope("geo:az.county.12011", query)).ok, false);
  assert.equal((await resolveOfficialsScope("geo:az.zcta.33301", query)).ok, false);
  assert.equal(officialsCheckAction().validate({ placeKey: "st:fl", note: null, divisions: ["ocd-division/country:us/state:az"] }).ok, false);
  assert.equal(officialsCheckAction().validate({ placeKey: "us", note: null }).ok, false);
  assert.deepEqual(actionInput("officials-check", { target: "st:fl", scopeKey: "st:fl", option: null, words: "Heard news", amount: "", selected: [] }),
    { placeKey: "st:fl", note: "Heard news" });
  const plan = officialsLeadPlan({ ok: true, placeKey: "st:fl", label: "FL", divisions: [FL] }, "Verify a report", [], "fixture-receipt");
  assert.equal(plan.contract.schemaVersion, 2);
  if (plan.contract.schemaVersion === 2) assert.equal(plan.contract.sourceScope.observationArtifactIds.length, 0, "owner input never becomes source evidence");
  const county = await readOfficialsResults({ repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), placeKey: "geo:fl.county.12011",
    resolve: placeKey => resolveOfficialsScope(placeKey, query) });
  assert.ok(!("says" in county) && county.status === "not-requested");
});
