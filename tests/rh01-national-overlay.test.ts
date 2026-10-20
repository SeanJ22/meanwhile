import assert from "node:assert/strict";
import test from "node:test";
import { assertNationalOverlayEnvironment, planNationalRefreshes, prepareNationalRefreshes, selectedNationalPlaces, verifiedPimaRefreshAllowance } from "../scripts/rh01-national-overlay-prepare.mts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { findReceipt } from "../lib/control-plane/gateway/receipts.ts";
import { expansionScopesOf, withScopeSet, type ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { dueNationalPlaceZips, nationalPlaceSendRequests } from "../lib/hunt/place-source-task.ts";
import { RESEARCH_INTENT_LOG_KEY } from "../lib/control-plane/scheduler/research-policy.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { PublishedPlaceMembership } from "../lib/census-geography/area-lookup.ts";

const at = "2026-10-20T16:00:00.000Z", oldAt = "2026-10-20T15:00:00.000Z";
const place = { id: "national-place:85535", zip: "85535", state: "AZ" };
const membership: PublishedPlaceMembership = { zip: place.zip, type: "county", geoid: "04009", version: "county:2020", state: "AZ", zctaTabulation: "2020" };
const command = { script: "scripts/promote-registry-runtime.mts", command: ["scripts/promote-registry-runtime.mts", "--promote", "--state=AZ", "--national-zips=85535", "--place-task=national-place:85535"] };
const scope = (budgetUsd: number, lifetime = false): ExpansionScopeDecision => withScopeSet([], { geography: {
  type: "zcta", geoid: place.zip, version: "zcta:2020", label: "Existing selected ZIP", stateAbbr: "AZ" }, priority: 7,
  budgetUsd, huntBudget: lifetime, note: "Keep the owner's exact instruction", decidedAt: oldAt, decidedBy: "owner", receiptId: "prior-receipt" }).scopes[0]!;

test("national preparation refuses non-local environments and malformed or broadened native commands", () => {
  const env = { WTP_RH01_FACTS_URL: "http://127.0.0.1:9876", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:local-only@127.0.0.1:1/rh01",
    WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", WTP_RH01_CODE_ROOT: "/native", WTP_RH01_SHARED_STATE_DIRECTORY: "/isolated", WTP_RH01_RUN_ID: "unique-run" };
  assert.doesNotThrow(() => assertNationalOverlayEnvironment(env));
  for (const key of Object.keys(env)) assert.throws(() => assertNationalOverlayEnvironment({ ...env, [key]: "" }));
  assert.throws(() => assertNationalOverlayEnvironment({ ...env, WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly@production.example/db" }));
  assert.throws(() => assertNationalOverlayEnvironment({ ...env, WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://publisher@127.0.0.1/db" }));
  assert.deepEqual(selectedNationalPlaces([command, command]), [place]);
  assert.deepEqual(selectedNationalPlaces([{ ...command, script: "scripts/other.mts" }]), []);
  for (const change of ["--national-zips=85535,85701", "--state=tx", "--place-task=national-place:00000"]) {
    const key = change.split("=")[0];
    assert.throws(() => selectedNationalPlaces([{ ...command, command: command.command.map(arg => arg.startsWith(key + "=") ? change : arg) }]), /exact native/);
  }
});

test("refresh planning uses actual tabulation, preserves rolling policy and never resets a lifetime selection", () => {
  const own = scope(12.34), rows = [{ ...membership, zctaTabulation: "2010" }];
  assert.deepEqual(planNationalRefreshes([place], rows, [], null)[0], { geography: {
    type: "zcta", geoid: place.zip, version: "zcta:2010", label: "ZIP 85535", stateAbbr: "AZ" }, priority: 999,
    budgetUsd: 0, note: "RH-01 isolated source refresh; production clocks and budgets remain unchanged." });
  const [continued] = planNationalRefreshes([place], [membership], [own], null);
  assert.equal(continued?.budgetUsd, own.budgetUsd); assert.equal(continued?.priority, own.priority); assert.equal(continued?.note, own.note);
  assert.throws(() => planNationalRefreshes([place], [membership], [scope(50, true)], null), /cannot replace.*lifetime/);
  assert.throws(() => planNationalRefreshes([place], [{ ...membership, state: "TX" }], [], null), /unresolved/);
  const pima = { ...membership, geoid: "04019" };
  assert.equal(planNationalRefreshes([place], [pima], [], null)[0]?.budgetUsd, 0);
  assert.equal(planNationalRefreshes([place], [pima], [], 2.49)[0]?.budgetUsd, 2.49);
  assert.equal(planNationalRefreshes([place], [membership], [], 2.49)[0]?.budgetUsd, 0, "only actual Pima county overlap can copy the diagnostic allowance");
});

test("a native local Send makes a fresh production clock due without rewriting its obligation or any existing budget", async () => {
  const repos = createMemoryRepositories(), unrelated = { ...scope(50, true), key: "zcta:2020/85635", geography: { ...scope(50, true).geography, geoid: "85635" } };
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { ...defaultAdminConfig(oldAt), expansionScopes: [unrelated] }, oldAt);
  const obligation: StandingObligation = { id: place.id, subjectId: "zip:85535", routeId: "national-place-sources", recordClass: "REGISTRY_RUNTIME_BINDING",
    active: true, readerImpactAt: null, observedChangeRateHours: null, declaredCycleHours: 24, lastWorkedAt: oldAt,
    nextDueAt: "2026-10-21T15:00:00.000Z", occurrenceCount: 0, openOccurrenceId: null, updatedAt: oldAt };
  await repos.obligations.put(place.id, obligation, oldAt);
  const original = await repos.obligations.mustRead(place.id);
  assert.deepEqual(await dueNationalPlaceZips(repos, [place], at, new Map()), []);
  const reads: string[][] = [];
  const native = { submit: (request: Parameters<typeof submit>[0], deps: Parameters<typeof submit>[1]) => submit(request, { ...deps, readPlaceScore: async () => null }),
    findReceipt, expansionScopesOf, dueZips: dueNationalPlaceZips, memberships: async (zips: readonly string[]) => { reads.push([...zips]); return [membership]; },
    readRequests: async (_repos: typeof repos, zips: readonly string[], now: string) => {
      const scopes = expansionScopesOf((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value).scopes;
      return nationalPlaceSendRequests(scopes.map(decision => ({ kind: "RESOLVED" as const, decision,
        zctas: new Set(decision.geography.geoid === place.zip ? [place.zip] : []), whole: new Set<string>(), fractions: new Map<string, number>(), states: [place.state] })), [...zips], now);
    } };
  const result = await prepareNationalRefreshes({ places: [place], repos, native, at, runId: "national-source-one", pimaAllowanceUsd: null });
  assert.deepEqual(reads, [[place.zip]]);
  assert.equal(result.due[0]?.request.requestedAt, at);
  assert.equal(result.receipts.length, 1); assert.equal(result.receipts[0]?.type, "expansion.scope.set");
  assert.deepEqual(await repos.obligations.mustRead(place.id), original);
  assert.deepEqual(expansionScopesOf((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value).scopes.find(row => row.key === unrelated.key), unrelated);
  const again = await prepareNationalRefreshes({ places: [place], repos, native, at, runId: "national-source-one", pimaAllowanceUsd: null });
  assert.equal(again.receipts[0]?.receiptId, result.receipts[0]?.receiptId, "one run reuses its exact gateway request");
  const next = await prepareNationalRefreshes({ places: [place], repos, native, at: "2026-10-20T16:01:00.000Z", runId: "national-source-two", pimaAllowanceUsd: null });
  assert.notEqual(next.receipts[0]?.receiptId, result.receipts[0]?.receiptId, "a new run requests its own current refresh");
  assert.deepEqual(await repos.obligations.mustRead(place.id), original);
});

test("Pima allowance is bound to the real local preparation receipt and unchanged shared broker limits", async () => {
  const repos = createMemoryRepositories();
  const result = await submit({ type: "fleet.deployHere", subject: "fleet", input: { note: "Send agents to Pima County Arizona", budgetUsd: 2.49 },
    stateVersion: null, idempotencyKey: "rh01-test-real-pima-send", caller: "OPERATOR_CHAT", actorRef: "rh01-user-authorized-local-diagnostic" },
  { repos, now: () => at, currentStateVersion: null, codeSha: null });
  assert.equal(result.ok, true);
  const input = { phase: "after", modelPhase: "after", broker: { authorized: true, url: "http://127.0.0.1:8765/model", budgetPath: "/isolated/shared-ledger.sqlite",
    limits: { totalUsd: 5, perPhase: { SCOUT: { usd: 2.49 } } } }, preparation: { phase: "after", receipts: [result.receipt] },
    saved: await findReceipt(repos, result.receipt.receiptId), intents: await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY) };
  assert.equal(verifiedPimaRefreshAllowance(input), 2.49);
  assert.throws(() => verifiedPimaRefreshAllowance({ ...input, broker: { ...input.broker, authorized: false } }));
  assert.throws(() => verifiedPimaRefreshAllowance({ ...input, broker: { ...input.broker, limits: { ...input.broker.limits, totalUsd: 6 } } }));
  assert.throws(() => verifiedPimaRefreshAllowance({ ...input, modelPhase: "before" }));
  assert.throws(() => verifiedPimaRefreshAllowance({ ...input, saved: null }));
  assert.throws(() => verifiedPimaRefreshAllowance({ ...input, intents: [] }));
});
