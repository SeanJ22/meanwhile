import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { buildScoreboard, reportAccuracyRow, type ScoreboardReadings } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import { recordAttemptsKeepingHistory } from "../lib/control-plane/fix-history.ts";
import { fixItems } from "../lib/control-plane/fix-list.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readRecentClaimPasses, recordClaimPass } from "../lib/control-plane/live-audit-log.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { auditClaims, checkFixDone, claimsOf, reportAccuracy, runClaimAuditWeek, sampleClaims, weekOf } from "../lib/control-plane/workers/claim-audit.ts";
import type { UpdateRecord } from "../lib/control-plane/updates.ts";
import { memoryFixMap, type MethodAttempt } from "../lib/method/fix-map-record.ts";

const PLACES = ["az/county:a", "az/county:b", "nm/county:c", "nm/county:d", "nm/county:e"].map((p) => {
  const [state, county] = p.split("/");
  return `ocd-division/country:us/state:${state}/${county}`;
});
const T = "2026-09-07T12:00:00.000Z";
const attempt = (place: string, outcome: "SUCCEEDED" | "FAILED", at = T): MethodAttempt =>
  ({ kind: "ROUTE_RUN", attemptId: `${place}:${at}`, placeId: place, methodIds: ["m-1"], outcome, cause: outcome === "FAILED" ? "The page moved." : null, at });
const config = async (repos: ReturnType<typeof createMemoryRepositories>) => (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value as AdminConfig;

test("a true Proven claim and its Proven label are confirmed from the fix map", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await recordAttemptsKeepingHistory(map, repos, PLACES.map((p) => attempt(p, "SUCCEEDED")), () => "the agenda route");
  const pass = await auditClaims({ config: await config(repos), fixMap: map, now: "2026-09-08T00:00:00.000Z" });
  assert.deepEqual(pass.checks.map((c) => c.verdict).sort(), ["CONFIRMED", "CONFIRMED"]);
});

test("a later retry of a counted place makes the count uncheckable, never confirmed", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await recordAttemptsKeepingHistory(map, repos, PLACES.map((p) => attempt(p, "SUCCEEDED")), () => "the agenda route");
  await map.put({ methodId: "m-1", placeId: PLACES[0], state: "WORKS", triedAt: "2026-09-07T18:00:00.000Z", attemptId: "later", cause: null, updatedAt: "2026-09-07T18:00:00.000Z" });
  const pass = await auditClaims({ config: await config(repos), fixMap: map, now: "2026-09-08T00:00:00.000Z" });
  assert.equal(pass.checks.find((c) => c.claimId.startsWith("fix-status:"))?.verdict, "COULD_NOT_CHECK");
});

test("a false claim fed to it is caught: a red flag in Admin and a lesson with its cause; the pass is kept once a week", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  for (const p of PLACES.slice(0, 2)) await map.put({ methodId: "m-1", placeId: p, state: "WORKS", triedAt: T, attemptId: p, cause: null, updatedAt: T });
  const falseClaim: UpdateRecord = { id: `fix-status:m-1:proven:${T}`, what: "Proven: the agenda route worked in 5 places, failed in 0 places.", at: T, label: "PROVEN",
    evidenceHref: null, before: null, after: null, shownAt: null, claim: { kind: "FIX_PROVEN", methodId: "m-1", works: 5, failed: 0 } };
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { apiFallback: { enabled: false }, updatedAt: T, updates: [falseClaim] } as unknown as AdminConfig, T);
  const now = "2026-09-08T00:00:00.000Z";
  const out = await runClaimAuditWeek(repos, map, now);
  assert.equal(out.ran, true);
  assert.deepEqual(out.pass!.checks.map((c) => c.verdict), ["WRONG"]);
  const flag = fixItems(await config(repos)).find((i) => i.addedBy === "The claim auditors");
  assert.ok(flag, "a red flag on the fix list");
  assert.match(flag!.says, /A claimed win was wrong\. The update said 5 places working and 0 places failing; the fix map held 2 places and 0 places\./);
  const manual = { entries: (await repos.fieldManual.list()).map((row) => row.value) };
  assert.equal(manual.entries.filter((e) => e.kind === "CLAIM_LESSON").length, 1);
  assert.equal((await runClaimAuditWeek(repos, map, "2026-09-09T00:00:00.000Z")).ran, false, "once a week");
  const reading = reportAccuracy(await readRecentClaimPasses(repos, [weekOf(now)]));
  assert.deepEqual([reading?.confirmed, reading?.wrong], [0, 1]);
});

test("a controlled pass can never be recorded or read as real", async () => {
  const repos = createMemoryRepositories();
  await assert.rejects(recordClaimPass(repos, { at: T, week: weekOf(T), checks: [], synthetic: true }));
  assert.equal(reportAccuracy([{ at: T, week: weekOf(T), checks: [{ claimId: "x", claimed: "x", verdict: "WRONG", recomputed: "", cause: "c" }], synthetic: true }]), null);
});

test("the controlled run from the command line catches the false claim and writes nothing", () => {
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "scripts/claim-audit-pass.mts", "--controlled"],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: "", WTP_CONTROL_PLANE_DATABASE_URL: "" } });
  assert.match(out, /nothing written\): the false claim was caught/);
});

test("a fix reported done is checked against the fix list", () => {
  const u: UpdateRecord = { id: `fix:item-1:${T}`, what: "Fixed: the address", at: T, label: "TESTING", evidenceHref: null, before: null, after: null, shownAt: null };
  const item = { id: "item-1", where: "w", says: "s", addedBy: "owner", addedAt: "2026-09-01T00:00:00.000Z" };
  assert.equal(checkFixDone(u, [{ ...item, state: "FIXED", fixedAt: T }]).verdict, "CONFIRMED");
  assert.equal(checkFixDone(u, [{ ...item, state: "OPEN" }]).verdict, "WRONG");
  assert.equal(checkFixDone(u, []).verdict, "COULD_NOT_CHECK");
});

test("the sample is fixed per week, skips setbacks and expected items, and the Scoreboard reads it", () => {
  const mk = (id: string, over: Partial<UpdateRecord> = {}): UpdateRecord => ({ id: `fix:${id}:${T}`, what: id, at: T, label: "TESTING", evidenceHref: null, before: null, after: null, shownAt: null, ...over });
  const cfg = { apiFallback: { enabled: false }, updatedAt: T, updates: [mk("a"), mk("b", { label: "EXPECTED" }), mk("c", { setback: true }), mk("d")] } as unknown as AdminConfig;
  const claims = claimsOf(cfg, "2026-09-08T00:00:00.000Z");
  assert.equal(claims.length, 2);
  assert.deepEqual(sampleClaims(claims, "2026-09-07", 1), sampleClaims([...claims].reverse(), "2026-09-07", 1));
  const empty = { trends: [], readings: [], notMeasured: [] };
  const base: ScoreboardReadings = { places: null, placesUnread: 0, orders: null, publication: null, shutDoors: null, returning: null, learning: empty, doors: null, gates: null, readiness: [] };
  const row = buildScoreboard({ ...base, reportAccuracy: { confirmed: 9, wrong: 1, couldNotCheck: 2, at: T, wrongClaims: [{ claimed: "Proven: x.", cause: "It was not." }] } }).rows.find((r) => r.id === "Report accuracy")!;
  assert.equal(row.value, "9 of 10");
  assert.match(row.says, /^Report accuracy: 9 of 10 claimed wins confirmed from their source records\./);
  assert.deepEqual(row.items, ["Wrong: Proven: x. It was not."]);
  assert.equal(reportAccuracyRow(undefined).value, null);
});
