import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { officialsCheckAction, officialsLeadPlan } from "../lib/control-plane/gateway/officials-action.ts";
import { confirmReceipt } from "../lib/control-plane/gateway/confirmation.ts";
import { readOfficialsResults, type OfficialsChange } from "../lib/control-plane/admin-view/officials-results.ts";
import { resolveOfficialsScope } from "../lib/control-plane/admin-view/officials-scope.ts";
import { upsertDerivedDoor } from "../lib/doors/registry.ts";
import { recordDoorOutcome } from "../lib/doors/outcome.ts";
import { settleReadNow } from "../lib/doors/mission-refresh.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { parseHouseRoster, parseSenateRoster, HOUSE_ROSTER_URL, SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL } from "../lib/sources/official-rosters/federal.ts";
import { OFFICIAL_ROSTER_TARGETS } from "../lib/sources/official-rosters/targets.ts";
import type { ReadOnlyQuery, Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { refreshOfficialsLeads, officialsLeadProvider, officialsLeadStatus } from "../lib/control-plane/officials-leads.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withExpansionScopes } from "../lib/control-plane/gateway/admin-config.ts";
import { withScopeSet } from "../lib/control-plane/expansion/scopes.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

const NOW = "2026-10-13T05:00:00.000Z", PASS = "2026-10-13T05:01:00.000Z";
const COUNTRY = "ocd-division/country:us", FL = `${COUNTRY}/state:fl`, AZ = `${COUNTRY}/state:az`;
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/official-rosters/${name}`, import.meta.url), "utf8");

async function setup() {
  const repos = createMemoryRepositories();
  for (const [id, division, url] of [
    ["official-house-roster", COUNTRY, HOUSE_ROSTER_URL], ["official-senate-roster", COUNTRY, SENATE_ROSTER_URL],
    ["official-legislature-fl", FL, "https://www.flhouse.gov/Sections/Representatives/representatives.aspx"],
    ["openstates-people-fl", FL, "https://github.com/openstates/people"], ["congress-bulk-roster", COUNTRY, "https://github.com/unitedstates/congress-legislators"],
    ["openstates-people-az", AZ, "https://github.com/openstates/people"],
  ]) await upsertDerivedDoor(repos.doors, { doorId: `feed:${id}`, kind: id, ocdId: division, hosts: [new URL(url).hostname],
    holds: ["state-legislator"], config: { sourceUrl: url }, checkEveryMinutes: 1440 }, NOW, NOW);
  return repos;
}

test("an Admin state check marks its official and mirror feeds, then lists actual vacancy and appointment sources after the runner pass", async t => {
  const repos = await setup(), store = new MemoryRoutineDataStore();
  const request = { type: "officials.checkNow", subject: "st:fl", input: { placeKey: "st:fl", note: null }, caller: "OWNER_SESSION" as const,
    actorRef: "fixture-session", stateVersion: null, idempotencyKey: "officials-fl-01" };
  const outcome = await submit(request, { repos, now: () => NOW, currentStateVersion: null, codeSha: null });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.receipt.outcome, "QUEUED");
  assert.equal(outcome.receipt.readBackAt, "/admin?scope=fl&view=now");
  const expected = ["feed:congress-bulk-roster", "feed:official-house-roster", "feed:official-legislature-fl", "feed:official-senate-roster", "feed:openstates-people-fl"];
  assert.deepEqual(outcome.receipt.openedWork.map(work => work.id).sort(), expected);
  for (const id of expected) assert.equal((await repos.doors.mustRead(id)).value.readNow, true);
  assert.equal((await repos.doors.mustRead("feed:openstates-people-az")).value.readNow, false);
  assert.equal((await confirmReceipt(repos, outcome.receipt, Date.parse(NOW))).state, "waiting");
  assert.equal((await submit(request, { repos, now: () => NOW, currentStateVersion: null, codeSha: null })).replayed, true);

  // Both changes come from the government's unmodified source responses, not from the owner's note.
  const house = parseHouseRoster([{ url: HOUSE_ROSTER_URL, body: fixture("house-current.xml") }], PASS);
  const senate = parseSenateRoster([{ url: SENATE_ROSTER_URL, body: fixture("senate-current.xml") },
    { url: SENATE_APPOINTMENTS_URL, body: fixture("senate-appointed.html") }], PASS);
  const vacant = house.vacancies!.find(seat => seat.id === "US:rep:FL:20")!;
  const moody = senate.officeholders.find(person => person.nativeIds?.bioguide?.includes("M001244"))!;
  assert.equal(vacant.since, "2026-04-21");
  assert.equal(moody.termStart, "2025-01-21");
  const changesByScope = new Map<string, readonly OfficialsChange[]>([
    ["US:official-roster:house", [{ kind: "vacant", name: null, divisionId: vacant.divisionId, officeTitle: vacant.officeTitle,
      since: vacant.since, sourceUrl: vacant.provenance.sourceUrl }]],
    ["US:official-roster:senate", [{ kind: "appointed", name: moody.name, divisionId: moody.memberships![0].divisionId!,
      officeTitle: moody.officeTitle, since: moody.termStart, sourceUrl: moody.provenance.sourceUrl }]],
  ]);
  t.mock.method(store, "readPromotion", async (_recordClass: string, scope: string) => changesByScope.has(scope)
    ? { scope, versionId: scope, promotedAt: PASS } as PromotedProjection : null);
  t.mock.method(store, "readCandidate", async (id: string) => ({ candidate: { normalizedPayload: { changes: changesByScope.get(id) } } } as CandidateVersionRecord));
  for (const id of expected) await recordDoorOutcome(repos.doors, id, "SUCCESS", PASS, id === "feed:official-house-roster" || id === "feed:official-senate-roster");
  assert.equal(await settleReadNow(repos.doors, PASS), expected.length);
  const read = await readOfficialsResults({ repos, store, placeKey: "st:fl" });
  assert.ok(!("says" in read));
  if ("says" in read) return;
  assert.equal(read.status, "done");
  assert.equal(read.feeds.length, expected.length);
  assert.ok(read.feeds.every(feed => feed.checkedAt === PASS && feed.sourceUrl));
  assert.equal(read.changes.find(change => change.kind === "vacant")?.since, "2026-04-21");
  assert.equal(read.changes.find(change => change.kind === "appointed")?.name, moody.name);
  const confirmation = await confirmReceipt(repos, outcome.receipt, Date.parse(PASS));
  assert.equal(confirmation.state, "applied");
  assert.deepEqual(confirmation.progress, { done: expected.length, of: expected.length });

  await recordDoorOutcome(repos.doors, "feed:openstates-people-fl", "FAILURE", "2026-10-13T05:02:00.000Z");
  const failed = await readOfficialsResults({ repos, store, placeKey: "st:fl" });
  assert.ok(!("says" in failed) && failed.status === "failed");
  assert.ok(!("says" in failed) && failed.changes.length === 2, "a mirror failure never hides independently published official facts");
});

test("a lead stays in Scout instructions, makes no candidate, and keeps the paid controls unchanged", async () => {
  const repos = await setup();
  const note = "I heard the Florida House seat opened.";
  const result = await submit({ type: "officials.checkNow", subject: "st:fl", input: { placeKey: "st:fl", note }, caller: "OWNER_SESSION",
    actorRef: "fixture-session", stateVersion: null, idempotencyKey: "officials-note-01" }, { repos, now: () => NOW, currentStateVersion: null, codeSha: null });
  assert.equal(result.ok, true);
  const lead = result.receipt.openedWork.find(work => work.kind === "officials-lead")!;
  const row = (await repos.obligations.mustRead(lead.id)).value;
  assert.equal(row.lastWorkedAt, null);
  assert.equal(row.active, false, "a note cannot open paid work where no applicable funded mission exists");
  assert.deepEqual(row.assignments, []);
  assert.equal(row.autonomousPlan?.contract.recordClass, "OFFICIAL_ROSTER");
  assert.ok(row.autonomousPlan?.contract.completenessScope.includes(note));
  assert.ok(row.autonomousPlan?.seedUrls.includes(HOUSE_ROSTER_URL));
  assert.ok(!row.autonomousPlan?.seedUrls.some(url => url.includes("github.com")), "mirror pages cannot verify an owner's change lead");
  assert.equal((await repos.scoutResults.readAll()).length, 0);
  assert.equal((await repos.adminConfig.list()).length, 0);
  assert.equal((await repos.costs.readAll()).length, 0);
});

test("a funded mission admits a queued lead under its real budget and only verified work retires it", async () => {
  const repos = await setup();
  const result = await submit({ type: "officials.checkNow", subject: "st:fl", input: { placeKey: "st:fl", note: "Verify the reported departure" }, caller: "OWNER_SESSION",
    actorRef: "fixture-session", stateVersion: null, idempotencyKey: "officials-budget-01" }, { repos, now: () => NOW, currentStateVersion: null, codeSha: null });
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
  assert.equal(officialsCheckAction().validate({ placeKey: "st:fl", note: null, divisions: [AZ] }).ok, false);
  assert.equal(officialsCheckAction().validate({ placeKey: "us", note: null }).ok, false);
  assert.deepEqual(actionInput("officials-check", { target: "st:fl", scopeKey: "st:fl", option: null, words: "Heard news", amount: "", selected: [] }),
    { placeKey: "st:fl", note: "Heard news" });
  assert.equal(OFFICIAL_ROSTER_TARGETS.some(target => target.id === "official-house-roster"), true);
  const plan = officialsLeadPlan({ ok: true, placeKey: "st:fl", label: "FL", divisions: [FL] }, "Verify a report", [], "fixture-receipt");
  assert.equal(plan.contract.schemaVersion, 2);
  if (plan.contract.schemaVersion === 2) assert.equal(plan.contract.sourceScope.observationArtifactIds.length, 0, "owner input never becomes source evidence");
});
