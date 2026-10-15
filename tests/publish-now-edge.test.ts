import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { CENSUS_GEO_CONTRACT_ID } from "../lib/census-geography/publication.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { PUBLISH_NOW_INTERVAL_MS, publishNowHasNothingOwed, startPublishNowEdgeChecks } from "../lib/civic-data/publish-now.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { MEETING_LAYOUT_COUPLING, preparedMeetingScope } from "../lib/meetings/prepared-snapshot.ts";
import { heldRegistrationReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate } from "../lib/registration/candidate.ts";
import { registrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";

const vault = new MemoryEvidenceStore();

const NOW = "2026-10-01T12:00:00.000Z";

test("publish-now copies real baseline pointers during an unresolved finance pass, honors owner pauses and retries independent failures", async () => {
  const memory = new MemoryRoutineDataStore();
  // The routine sweep also checks these existing canonical families. Seed them through their real promotion doors.
  const census = censusGeographyCandidate(JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")));
  assert.ok((await processRegisteredRoutineCandidate(memory, CENSUS_GEO_CONTRACT_ID, census, NOW)).promoted);
  const states = ["US", "US-AZ", "US-NH"];
  for (const state of states) await memory.writePreparedReaderProjection({ recordClass: "MEETING", scope: preparedMeetingScope(state),
    payload: { formatVersion: 2, chunks: [], heldChunks: [], unavailableSources: [] },
    composedFrom: [{ contractId: "meeting-facts", versionId: "facts:none" }, MEETING_LAYOUT_COUPLING], factSha256: "a".repeat(64),
    generatedAt: NOW, composedAt: NOW, sourceThrough: null, retrievedAt: null, promotedThrough: null,
  }, null);
  const artifacts = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "publish-now-baseline-")));
  const publish = async (store: RoutineDataStore) => {
    const results = await Promise.all(states.map(state => publishRoutineReaderEdgeOutcome(store, NOW, null, { artifactStore: artifacts, state })));
    return results.find(result => !result.ok) ?? results.find(result => result.readerEdge === "PUBLISHED") ?? results[0]!;
  };
  const manifests = async () => ({ root: (await artifacts.readManifest())!.manifest,
    az: (await artifacts.readManifest("AZ"))!.manifest, nh: (await artifacts.readManifest("NH"))!.manifest });
  assert.equal((await publish(memory)).readerEdge, "PUBLISHED");
  const before = await manifests();

  let finishFinance!: () => void;
  let financeSettled = false;
  const finance = new Promise<void>(resolve => { finishFinance = resolve; }).then(() => { financeSettled = true; });
  const target = registrationTarget("NH");
  const registration = registrationCandidate({ target, receipt: heldRegistrationReceipt(),
    reference: loadRegistrationReference(join(import.meta.dirname, ".."), "NH") });
  const registered = await processRegisteredRoutineCandidate(memory, target.contractId, registration, NOW);
  assert.equal(registered.promoted?.versionId, registration.id, registered.candidate.failureDetail ?? "");
  const releaseId = "a".repeat(40);
  const sourceUrl = `https://raw.githubusercontent.com/openstates/people/${releaseId}/data/az/legislature/Member.yml`;
  const body = "id: ocd-person/member-one\nname: Member One\nroles:\n  - type: upper\n    district: '7'\n    start_date: '2025-01-01'\n";
  const roster = normalize(yamlToPeople(body, "az", sourceUrl, NOW), new Map(), NOW, "US-AZ");
  const people = await publishStatePeople({ vault, store: memory, state: "az", roster, releaseId, now: NOW,
    acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, httpStatus: 200, body, retrievedAt: NOW }] });
  assert.ok(people.outcome.promoted, JSON.stringify(people.outcome.candidate.receipt));

  let paused = true;
  let pauseReadFailure: Error | null = null;
  let failRegistration = true;
  let payloadReads = 0;
  const store = new Proxy(memory, { get(target, key) {
    if (key === "readPromotion") return async (...args: Parameters<typeof memory.readPromotion>) => {
      if (args[0] === "REGISTRATION" || args[0] === "STATE_LEGISLATOR") payloadReads++;
      if (args[0] === "REGISTRATION" && failRegistration) throw new Error("registration storage temporarily unavailable");
      return memory.readPromotion(...args);
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let tick!: () => void;
  let cancelled = false;
  let sweeps = 0;
  let gate: Promise<void> | null = null;
  const outcomes: string[] = [];
  const errors: unknown[] = [];
  const checks = startPublishNowEdgeChecks({
    store: "local folder", readPaused: async () => { if (pauseReadFailure) throw pauseReadFailure; return paused; },
    onError: error => { errors.push(error); },
    schedule: (callback, everyMs) => { assert.equal(everyMs, PUBLISH_NOW_INTERVAL_MS); tick = callback; return () => { cancelled = true; }; },
    check: async () => {
      sweeps++;
      if (gate) await gate;
      const outcome = await publish(store);
      outcomes.push(outcome.readerEdge);
      return outcome;
    },
  });
  try {
    assert.equal((await checks.run()).readerEdge, "SKIPPED_OWNER_PAUSE");
    assert.equal(sweeps, 0, "a pause at start performs no pointer or payload sweep");
    assert.deepEqual(await manifests(), before);

    paused = false;
    tick();
    assert.equal((await checks.run()).readerEdge, "FAILED", "one failed family keeps publication owed");
    const partial = await manifests();
    assert.equal(partial.az.stateLegislators!["US-AZ"].version, people.outcome.promoted!.versionId,
      "independent people publish while registration is unavailable");
    assert.equal(partial.nh.registrations?.nh, undefined);
    assert.equal(financeSettled, false, "neither the source pass nor its long finance task has settled");

    paused = true;
    failRegistration = false;
    tick();
    assert.equal((await checks.run()).readerEdge, "SKIPPED_OWNER_PAUSE");
    assert.deepEqual(await manifests(), partial, "pausing during the long pass preserves every artifact reference");

    paused = false;
    let releaseSweep!: () => void;
    gate = new Promise<void>(resolve => { releaseSweep = resolve; });
    tick(); tick();
    const running = checks.run();
    assert.equal(checks.run(), running, "overlapping ticks coalesce into the same sweep");
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(sweeps, 2);
    releaseSweep();
    assert.equal((await running).readerEdge, "PUBLISHED");
    gate = null;
    const published = await manifests();
    assert.equal(published.nh.registrations!.nh.version, registration.id);
    assert.equal(published.az.stateLegislators!["US-AZ"].version, people.outcome.promoted!.versionId);
    const edge = await ensureReaderAuthorityEdge(published.root, artifacts, ["state-legislators"], ["AZ", "NH"]);
    assert.ok((await edge.registrations!.load("nh"))!.value.governments?.some(row => row.kind === "EDUCATION_AGENCY"));
    assert.equal((await edge.stateLegislators!.load("US-AZ"))!.value.roster.officeholders[0].personId, "plural:member-one");
    assert.equal(financeSettled, false, "both native source projections reach real reader artifacts before the long task finishes");

    const readCount = payloadReads;
    tick();
    const current = await checks.run();
    assert.equal(current.readerEdge, "CURRENT");
    assert.equal(payloadReads, readCount, "unchanged minutes compare narrow pointers without rereading held baseline payloads");
    assert.equal(publishNowHasNothingOwed(true, 0, 0, current), true);
    const summary = await checks.stop();
    assert.equal(summary?.readerEdge, "PUBLISHED", "a quiet final check does not erase a real publication from the supervisor receipt");
    assert.equal(publishNowHasNothingOwed(true, 0, 0, summary!), false);
    assert.deepEqual(outcomes, ["FAILED", "PUBLISHED", "CURRENT"]);
    assert.deepEqual(errors, []);
    assert.equal(cancelled, true);
    tick(); await Promise.resolve();
    assert.equal(sweeps, 3, "stopping the pass removes its minute check");
    paused = true;
    assert.equal((await checks.run()).readerEdge, "SKIPPED_OWNER_PAUSE", "the explicit final sweep checks the pause again after stopping ticks");
    assert.equal(sweeps, 3);
    assert.deepEqual(await manifests(), published);
    pauseReadFailure = new Error("owner control temporarily unreadable");
    assert.equal((await checks.run()).readerEdge, "FAILED", "an unreadable owner control remains a durable failure, never permission to publish");
    assert.deepEqual(errors, [pauseReadFailure]);
    assert.equal((await checks.stop())?.readerEdge, "FAILED");
    assert.equal(sweeps, 3);
    assert.deepEqual(await manifests(), published);
  } finally {
    await checks.stop();
    finishFinance();
    await finance;
  }
});
