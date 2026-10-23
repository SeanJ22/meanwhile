import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STATE_BINDING_REFRESH_TASKS } from "../lib/civic-data/state-binding-refresh-contracts.ts";
import { CENSUS_STATE_IDENTITIES_URL, censusStateIdentity, parseStateBindingRefreshArguments, refreshStateBinding, stateBindingRefreshPackage } from "../lib/civic-data/state-binding-refresh.ts";
import { REGISTRY_STATES, stateRegistryRuntimeContractId, stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { registryRuntimeCandidate, type RegistryRuntimeCarton } from "../lib/registry/runtime-data-plane.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const AT = "2026-10-20T12:00:00.000Z", DAY = 86_400_000;
const bytes = new Uint8Array(readFileSync(new URL("fixtures/reference/census-state-identities.txt", import.meta.url)));
function release(at = AT): KnownRelease {
  return { sourceId: "registry-reviewed-bindings", releaseId: "census-state-identities", bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"), requestedUrl: CENSUS_STATE_IDENTITIES_URL, finalUrl: CENSUS_STATE_IDENTITIES_URL,
    httpStatus: 200, retrievedAt: at, sourceObservedAt: at, checkedAt: at, lastCheckStatus: 200,
    etag: null, lastModified: null, contentType: "text/plain", reused: false };
}

test("each state and DC owes its binding automatically on its daily clock and retries failures independently", () => {
  assert.equal(STATE_BINDING_REFRESH_TASKS.length, REGISTRY_STATES.length);
  const statesAndDC = REGISTRY_STATES.filter(state => !["PR", "VI", "AS", "GU", "MP"].includes(state));
  assert.equal(statesAndDC.length, 51);
  for (const state of REGISTRY_STATES) {
    const task = STATE_BINDING_REFRESH_TASKS.find(task => task.id === stateRegistryRuntimeContractId(state))!;
    assert.equal(task.scope, stateRegistryRuntimeScope(state));
    assert.equal(task.registeredContractId, task.id);
    assert.equal(task.ownerInvocation, undefined);
    assert.deepEqual(task.command, ["scripts/state-binding-refresh.mts", "--promote", `--state=${state}`]);
    assert.equal(routineTaskDue(task, undefined, Date.parse(AT)), true);
    const checked = { lastAttemptedAt: AT, lastSucceededObservedAt: AT, lastSucceededParserVersion: task.parserVersion };
    assert.equal(routineTaskDue(task, checked, Date.parse(AT) + DAY - 1), false);
    assert.equal(routineTaskDue(task, checked, Date.parse(AT) + DAY), true);
    assert.equal(routineTaskDue(task, { lastAttemptedAt: AT }, Date.parse(AT) + task.retryMs - 1), false);
    assert.equal(routineTaskDue(task, { lastAttemptedAt: AT }, Date.parse(AT) + task.retryMs), true);
  }
  assert.equal(new Set(STATE_BINDING_REFRESH_TASKS.map(task => task.acquisitionFailureDomain)).size, REGISTRY_STATES.length);
});

test("the exact saved official Census rows establish every state root, including DC, without invented names", () => {
  for (const state of REGISTRY_STATES) {
    const row = censusStateIdentity(release(), state);
    assert.equal(row.state, state);
    assert.equal(row.provenance.sourceUrl, CENSUS_STATE_IDENTITIES_URL);
    assert.ok(new TextDecoder().decode(bytes).includes(`|${state}|${row.label}|`));
    assert.ok(row.ocdId.endsWith(`:${state.toLowerCase()}`));
  }
  assert.equal(censusStateIdentity(release(), "DC").ocdId, "ocd-division/country:us/district:dc");
  assert.throws(() => censusStateIdentity({ ...release(), bytes: new TextEncoder().encode("invented") }, "TX"), /CAPTURE_INVALID/);
  assert.throws(() => censusStateIdentity({ ...release(), finalUrl: "https://unrelated.example.gov/state.txt" }, "TX"), /CAPTURE_INVALID/);
  assert.equal(parseStateBindingRefreshArguments(["--promote", "--state=dc"]), "DC");
  assert.throws(() => parseStateBindingRefreshArguments(["--state=TX"]), /EXACT_STATE/);
  assert.throws(() => parseStateBindingRefreshArguments(["--promote", "--state=TX", "--state=CA"]), /EXACT_STATE/);
});

test("a missing binding publishes through the real migrations, then scheduled confirmation keeps all records and source dates unchanged", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(AT) });
  await withMigratedRoutineStore("registry-runtime:TX", async (store, _vault, pg) => {
    Object.assign((store as unknown as { writeAuthority: { capability: string } }).writeAuthority, { capability: "MANUAL_CONTRACT" });
    const receiptLines: unknown[] = [];
    const refresh = () => refreshStateBinding({ state: "TX", store }, { now: () => new Date().toISOString(),
      acquire: async () => { t.mock.timers.tick(100); return release(new Date().toISOString()); },
      printReceipt: (...line) => { receiptLines.push(line); } });
    const first = await refresh();
    assert.ok(first.promoted, JSON.stringify(first.candidate.receipt));
    const before = await store.readPromotion<RegistryRuntimeCarton>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("TX"));
    assert.equal(before?.payload.registry.divisions[0].label, "Texas");
    t.mock.timers.tick(DAY);
    const second = await refresh();
    assert.ok(second.confirmed, JSON.stringify(second.candidate.receipt));
    const after = await store.readPromotion<RegistryRuntimeCarton>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("TX"));
    assert.equal(after?.versionId, before?.versionId);
    assert.deepEqual(after?.payload, before?.payload, "root provenance and every existing fact retain their original source dates");
    const events = await pg.query<{ detail: string }>("SELECT detail FROM civic_data_candidate_events WHERE candidate_id=$1 ORDER BY sequence", [before!.versionId]);
    assert.ok(events.rows.some(row => row.detail.startsWith("UNCHANGED_CONFIRMATION_V1 ")));
    const task = STATE_BINDING_REFRESH_TASKS.find(task => task.id === "registry-runtime:TX")!;
    const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    assert.equal(clock.lastSucceededObservedAt, new Date().toISOString());
    assert.equal(routineTaskDue(task, clock, Date.now() + DAY - 1), false);
    assert.equal(routineTaskDue(task, clock, Date.now() + DAY), true);
    assert.equal(receiptLines.length, 2);
    t.mock.timers.tick(1);
    const failed = await refreshStateBinding({ state: "TX", store }, { now: () => new Date().toISOString(),
      acquire: async () => { throw new Error("Census is unavailable"); }, printReceipt: () => {} });
    assert.equal(failed.promoted, null);
    assert.equal((await store.readPromotion("REGISTRY_RUNTIME_BINDING", task.scope))?.versionId, before?.versionId);
    const failedClock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    assert.equal(failedClock.lastAttemptedAt, new Date().toISOString());
    assert.equal(routineTaskDue(task, failedClock, Date.now() + task.retryMs - 1), false);
    assert.equal(routineTaskDue(task, failedClock, Date.now() + task.retryMs), true);
  });
});

test("a first package with no verified state identity cannot establish a binding", async () => {
  await withMigratedRoutineStore("registry-runtime:TX", async store => {
    Object.assign((store as unknown as { writeAuthority: { capability: string } }).writeAuthority, { capability: "MANUAL_CONTRACT" });
    const pkg = stateBindingRefreshPackage(release(), "TX", null, AT);
    const unsupported = { ...pkg, payload: { ...pkg.payload, registry: { ...pkg.payload.registry, divisions: [] } } };
    const outcome = await processRegisteredManualCandidate(store, "registry-runtime:TX", registryRuntimeCandidate(unsupported), AT, null);
    assert.equal(outcome.promoted, null);
    assert.ok(outcome.candidate.candidate.semantics.violations.includes("REGISTRY_CURRENT_REVIEW_HAS_NO_VALID_SOURCE_SCOPED_FACT"));
    assert.equal(await store.readPromotion("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("TX")), null);
  });
});
