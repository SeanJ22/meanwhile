import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { promotionProofIssue } from "../lib/civic-data/read-model.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";

import {
  manualProjectionCandidate,
  readManualProjectionPrior,
  type CuratedReaderProjection,
  type ManualProjectionPackage,
  type ManualProjectionPrior,
} from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualSourceSetReceipt, RoutineCandidate } from "../lib/civic-data/types.ts";
import { curatedReaderSourceClass } from "./helpers/curated-reader-source-class.ts";

const T0 = "2026-09-09T01:00:00.000Z";
const T1 = "2026-09-09T02:00:00.000Z";
const T2 = "2026-09-09T03:00:00.000Z";

function importedVenueFixture() {
  const {record, projection} = JSON.parse(readFileSync(new URL("./fixtures/retained-venue-import.json", import.meta.url), "utf8")) as {
    record: CandidateVersionRecord; projection: PromotedProjection;
  };
  assert.equal(promotionProofIssue(record.candidate.recordClass, record.candidate.scope, projection, record), null);
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  return { store, record, projection };
}

test("a source-reviewed venue successor preserves unchanged sourced members", async () => {
  const store = new MemoryRoutineDataStore();
  const { candidate: record } = await processRegisteredManualCandidate(store, "venue-resolutions",
    manualProjectionCandidate(packageFor("venue-resolutions", T0, "old")), T0);
  const input = packageFor("venue-resolutions", T1, "new", false, true);
  const { candidate: next, expectedBaseVersionId } = await prepareManualProjectionSuccessor(input, store, T1);
  const outcome = await processRegisteredManualCandidate(store, "venue-resolutions", next, T1, expectedBaseVersionId);
  assert.equal(outcome.candidate.receipt?.decision, "GOOD", JSON.stringify(outcome.candidate.receipt));
  assert.ok(outcome.promoted);
  assert.equal(next.retrieval.manualSourceReceipt?.sources.filter(source => source.retrievedAt === T1).length, 1);
  assert.equal(next.manualPriorAuthority?.retainedMembers.length, 1);
  const priorRows = (record.candidate.readModel as CuratedReaderProjection).records;
  const nextRows = (next.readModel as CuratedReaderProjection).records;
  assert.deepEqual(nextRows.find((row) => row.id === priorRows[1].id), priorRows[1]);
  assert.match(outcome.candidate.receipt!.checks[0].detail, /no fresh HTTP retrieval is asserted/);
  const { candidate: second, expectedBaseVersionId: secondBase } = await prepareManualProjectionSuccessor(packageFor("venue-resolutions", T2, "newer", false, true), store, T2);
  const secondOutcome = await processRegisteredManualCandidate(store, "venue-resolutions", second, T2, secondBase);
  assert.ok(secondOutcome.promoted, JSON.stringify(secondOutcome.candidate.receipt));
  assert.equal(second.manualPriorAuthority?.versionId, next.id);
  assert.deepEqual((second.readModel as CuratedReaderProjection).records[1], priorRows[1]);
});

test("corrupt imported proof and tampered inherited authority are refused", async () => {
  const { store, record, projection } = importedVenueFixture();
  const corruptStore = { readPromotion: store.readPromotion.bind(store), readCandidate: async () => ({
    ...record, candidate: { ...record.candidate, bootstrapImport: { ...record.candidate.bootstrapImport!, candidateEnvelopeSha256: "0".repeat(64) } },
  }) };
  const independent = await prepareManualProjectionSuccessor(packageFor("venue-resolutions", T1, "new", false, true), corruptStore, T1);
  assert.equal(independent.expectedBaseVersionId, null, "a new state pointer does not load a national imported base");
  assert.equal(independent.candidate.manualPriorAuthority, undefined);
  const corruptPointer = { readCandidate: store.readCandidate.bind(store), readPromotion: async <T>() => ({ ...projection, payload: { kind: "venue-resolutions", records: [] } as T }) };
  await assert.rejects(prepareManualProjectionSuccessor(packageFor("venue-resolutions", T1, "new", false, true), corruptPointer, T1), /MANUAL_PROMOTION_BASE_UNAVAILABLE/);
  const ordinaryStore = new MemoryRoutineDataStore();
  const ordinary = await processRegisteredManualCandidate(ordinaryStore, "venue-resolutions", manualProjectionCandidate(packageFor("venue-resolutions", T0, "ordinary")), T0);
  const { candidate: next } = await prepareManualProjectionSuccessor(packageFor("venue-resolutions", T1, "new", false, true), ordinaryStore, T1);
  const badWitness = { ...next, manualPriorAuthority: { ...next.manualPriorAuthority!, versionId: "unrelated" } };
  assert.equal(validateRoutineCandidate(badWitness, ordinary.candidate, T1).receipt.checks[0].code, "MANUAL_PRIOR_AUTHORITY_INVALID");
  const changed = structuredClone(next) as RoutineCandidate & { readModel: CuratedReaderProjection };
  (changed.readModel.records[1] as Record<string, unknown>).name = "Unreviewed changed venue";
  assert.equal(validateRoutineCandidate(changed, ordinary.candidate, T1).receipt.checks[0].code, "MANUAL_PRIOR_AUTHORITY_INVALID");
  assert.equal(validateRoutineCandidate(next, null, T1).receipt.checks[0].code, "MANUAL_PRIOR_AUTHORITY_INVALID");
  const corruptedBase = await corruptStore.readCandidate();
  assert.equal(validateRoutineCandidate(next, corruptedBase, T1).receipt.checks[0].code, "MANUAL_PRIOR_AUTHORITY_INVALID",
    "the validator independently checks inherited import integrity, even without the read adapter");
});

test("receiptless bases contribute no inherited members to a fresh sourced publication", async () => {
  for (const contractId of ["ballot-navigation", "campaign-sites", "venue-resolutions"] as const) {
    const store = new MemoryRoutineDataStore();
    const base = await processRegisteredManualCandidate(store, contractId, manualProjectionCandidate(packageFor(contractId, T0, "old")), T0);
    const record = { ...base.candidate, candidate: { ...base.candidate.candidate,
      retrieval: { ...base.candidate.candidate.retrieval, manualSourceReceipt: undefined } } };
    Object.assign(store, { candidates: new Map([[record.candidate.id, record]]) });
    assert.equal(await readManualProjectionPrior(contractId, store, T1), null);
    const input = packageFor(contractId, T1, "new", false, true);
    const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(input, store, T1);
    assert.equal(expectedBaseVersionId, record.candidate.id);
    assert.equal(candidate.manualPriorAuthority, undefined);
    assert.deepEqual(candidate.readModel, input.payload);
    const outcome = await processRegisteredManualCandidate(store, contractId, candidate, T1, expectedBaseVersionId);
    assert.ok(outcome.promoted, `${contractId}: ${JSON.stringify(outcome.candidate.receipt)}`);
    assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 0);
    assert.deepEqual(outcome.promoted.payload, input.payload);
  }
});

test("a state venue pointer publishes fresh sourced records independently of the legacy imported pointer", async () => {
  const { store } = importedVenueFixture();
  assert.equal(await readManualProjectionPrior("venue-resolutions", store, T1), null);
  const input = packageFor("venue-resolutions", T1, "new", false, true);
  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(input, store, T1);
  assert.equal(expectedBaseVersionId, null);
  assert.equal(candidate.manualPriorAuthority, undefined);
  assert.deepEqual(candidate.readModel, input.payload);
  const outcome = await processRegisteredManualCandidate(store, "venue-resolutions", candidate, T1, expectedBaseVersionId);
  assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
  assert.deepEqual(outcome.promoted.payload, input.payload);
});

test("an existing malformed source receipt still refuses inherited records", async () => {
  const store = new MemoryRoutineDataStore();
  const base = await processRegisteredManualCandidate(store, "ballot-navigation",
    manualProjectionCandidate(packageFor("ballot-navigation", T0, "old")), T0);
  const sourceReceipt = base.candidate.candidate.retrieval.manualSourceReceipt!;
  const badReceipt = { ...sourceReceipt, sources: [{ ...sourceReceipt.sources[0], rawHash: "invalid" }] };
  const record = { ...base.candidate, candidate: { ...base.candidate.candidate,
    retrieval: { ...base.candidate.candidate.retrieval, manualSourceReceipt: badReceipt } } };
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]) });
  await assert.rejects(readManualProjectionPrior("ballot-navigation", store, T1), /MANUAL_PROMOTION_BASE_PROOF_INVALID/);
  await assert.rejects(prepareManualProjectionSuccessor(packageFor("ballot-navigation", T1, "new", false, true), store, T1),
    /MANUAL_(?:PROMOTION_BASE_PROOF_INVALID|SOURCE_RECEIPT_MALFORMED)/);
});

test("the producer preserves source-isolated omitted members across every independent curated family", async () => {
  for (const contractId of ["ballot-navigation", "campaign-sites", "venue-resolutions"] as const) {
    const store = new MemoryRoutineDataStore();
    const base = await processRegisteredManualCandidate(store, contractId, manualProjectionCandidate(packageFor(contractId, T0, "old")), T0);
    assert.ok(base.promoted);
    const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(packageFor(contractId, T1, "new", false, true), store, T1);
    const outcome = await processRegisteredManualCandidate(store, contractId, candidate, T1, expectedBaseVersionId);
    assert.ok(outcome.promoted, `${contractId}: ${JSON.stringify(outcome.candidate.receipt)}`);
    assert.deepEqual((candidate.readModel as CuratedReaderProjection).records[1], (base.candidate.candidate.readModel as CuratedReaderProjection).records[1]);
    const sources = candidate.retrieval.manualSourceReceipt!.sources;
    assert.equal(sources.filter(source => source.retrievedAt === T1).length, 1, "only the current publisher is freshly reviewed");
    for (const retained of sources.filter(source => source.retrievedAt !== T1)) {
      assert.ok(base.candidate.candidate.retrieval.manualSourceReceipt!.sources.some(source => JSON.stringify(source) === JSON.stringify(retained)), "conflict receipts retain the actual earlier source, never a new read date");
    }
  }
});

type CuratedId = "ballot-navigation" | "campaign-sites" | "venue-resolutions";

function urls(id: CuratedId): readonly [string, string] {
  return [
    `https://one.example.gov/${id}`,
    `https://two.example.gov/${id}`,
  ];
}

function receipt(id: CuratedId, at: string, blockedSecond = false): ManualSourceSetReceipt {
  return {
    contractVersion: 1,
    reviewedAt: at,
    reviewedBy: "source-isolation-owner-test",
    sources: urls(id).map((url, index) => ({
      requestedUrl: url,
      finalUrl: url,
      publisher: `Named publisher ${index + 1}`,
      sourceClass: curatedReaderSourceClass(id),
      retrievedAt: at,
      httpStatus: blockedSecond && index === 1 ? 503 : 200,
      rawHash: (blockedSecond && index === 1 ? "f" : String(index + 1)).repeat(64),
      reviewedEvidence: "The exact response and its member-local projection were reviewed together.",
      ...(blockedSecond && index === 1 ? {
        reviewOutcome: "BLOCKED" as const,
        failureDetail: "The second publisher returned a maintenance response with no usable civic record.",
      } : {}),
    })),
  };
}

function records(id: CuratedId, at: string, revision: string): CuratedReaderProjection["records"] {
  const [one, two] = urls(id);
  if (id === "ballot-navigation") {
    return [one, two].map((url, index) => ({
      id: `polling-place:${index === 0 ? "AZ" : "NH"}`,
      kind: "POLLING_PLACE_LINK",
      value: {
        state: index === 0 ? "AZ" : "NH",
        url,
        verifiedAt: at,
        label: `route-${revision}-${index + 1}`,
      },
    }));
  }
  if (id === "campaign-sites") {
    return [one, two].map((url, index) => ({
      id: `campaign-site:congress:C001133:${index + 1}`,
      officeholderId: "congress:C001133",
      site: {
        url,
        verification: `identity-and-office-${revision}-${index + 1}`,
        attemptedAt: at,
      },
    }));
  }
  return [one, two].map((url, index) => ({
    id: `venue:test:${index + 1}`,
    sourceId: `venue-source-${index + 1}`,
    bodyOcdId: `ocd-division/country:us/state:az/place:test-${index + 1}`,
    match: `${index + 1} Main St`,
    name: `Room ${revision}-${index + 1}`,
    address: `${index + 1} Main St, Test, AZ 85000`,
    lat: 32 + index / 10,
    lng: -110 - index / 10,
    addressSourceUrl: url,
    coordinateSourceUrl: url,
    verifiedAt: at,
  }));
}

function packageFor(
  id: CuratedId,
  at: string,
  revision: string,
  blockedSecond = false,
  onlyFirst = false,
): ManualProjectionPackage {
  const allRecords = records(id, at, revision);
  const allSources = receipt(id, at, blockedSecond);
  return {
    contractId: id,
    version: at,
    sourceThrough: at,
    sourceReceipt: onlyFirst ? { ...allSources, sources: [allSources.sources[0]!] } : allSources,
    payload: { kind: id, records: onlyFirst ? [allRecords[0]!] : allRecords },
  };
}

function prior(candidate: RoutineCandidate): ManualProjectionPrior {
  return {
    versionId: candidate.id,
    payload: candidate.readModel as CuratedReaderProjection,
    sourceReceipt: candidate.retrieval.manualSourceReceipt!,
  };
}

test("a blocked publisher holds only its exact curated member while unrelated valid members promote", async () => {
  for (const id of ["ballot-navigation", "campaign-sites", "venue-resolutions"] as const) {
    const store = new MemoryRoutineDataStore();
    const first = manualProjectionCandidate(packageFor(id, T0, "first"));
    const firstOutcome = await processRegisteredManualCandidate(store, id, first, T0, null);
    assert.equal(firstOutcome.candidate.state, "PROMOTED", id);

    const second = manualProjectionCandidate(packageFor(id, T1, "second", true), { prior: prior(first) });
    assert.equal(second.retrieval.succeeded, true, id);
    assert.ok(second.excludedFacts?.some((fact) => fact.code === "MANUAL_SOURCE_BLOCKED"), id);
    assert.ok(second.excludedFacts?.some((fact) => fact.code === "MANUAL_MEMBER_HELD_LKG"), id);
    assert.ok(second.retrieval.manualSourceReceipt?.sources.every((source) => source.reviewOutcome !== "BLOCKED"), id);

    const outcome = await processRegisteredManualCandidate(store, id, second, T1, first.id);
    assert.equal(outcome.candidate.state, "PROMOTED", id);
    assert.ok(outcome.promoted, id);
    assert.deepEqual(outcome.candidate.candidate.changeSet?.removed, [], id);
    assert.deepEqual(
      outcome.candidate.candidate.changeSet?.changed.map((change) => change.key),
      [`curated-reader:${records(id, T0, "first")[0]!.id}`],
      id,
    );
    assert.ok(outcome.candidate.candidate.changeSet?.held.some((fact) => fact.code === "MANUAL_MEMBER_HELD_LKG"), id);
    const promoted = outcome.promoted!.payload as CuratedReaderProjection;
    assert.deepEqual(promoted.records[1], records(id, T0, "first")[1], id);
    assert.deepEqual(promoted.records[0], records(id, T1, "second")[0], id);
  }
});

test("an omitted member cannot be deleted without typed positive removal evidence", async () => {
  for (const id of ["ballot-navigation", "campaign-sites", "venue-resolutions"] as const) {
    const store = new MemoryRoutineDataStore();
    const first = manualProjectionCandidate(packageFor(id, T0, "first"));
    await processRegisteredManualCandidate(store, id, first, T0, null);
    const next = manualProjectionCandidate(packageFor(id, T2, "third", false, true), { prior: prior(first) });
    const outcome = await processRegisteredManualCandidate(store, id, next, T2, first.id);
    assert.equal(outcome.candidate.state, "PROMOTED", id);
    assert.deepEqual(outcome.candidate.candidate.changeSet?.removed, [], id);
    assert.ok(outcome.candidate.candidate.changeSet?.held.some((fact) =>
      fact.code === "MANUAL_MEMBER_REMOVAL_EVIDENCE_MISSING" && fact.key === records(id, T0, "first")[1]!.id
    ), id);
    assert.equal((outcome.promoted!.payload as CuratedReaderProjection).records.length, 2, id);
  }
});

test("an all-source outage stays SOURCE_BLOCKED and cannot replace the curated LKG", async () => {
  const id = "venue-resolutions" as const;
  const store = new MemoryRoutineDataStore();
  const first = manualProjectionCandidate(packageFor(id, T0, "first"));
  await processRegisteredManualCandidate(store, id, first, T0, null);
  const blockedPackage = packageFor(id, T1, "blocked", true);
  const firstSource = blockedPackage.sourceReceipt.sources[0]!;
  const allBlocked: ManualProjectionPackage = {
    ...blockedPackage,
    sourceReceipt: {
      ...blockedPackage.sourceReceipt,
      sources: [
        {
          ...firstSource,
          httpStatus: 503,
          rawHash: "e".repeat(64),
          reviewOutcome: "BLOCKED",
          failureDetail: "The first publisher was unavailable.",
        },
        blockedPackage.sourceReceipt.sources[1]!,
      ],
    },
  };
  const candidate = manualProjectionCandidate(allBlocked, { prior: prior(first) });
  assert.equal(candidate.retrieval.succeeded, false);
  const outcome = await processRegisteredManualCandidate(store, id, candidate, T1, first.id);
  assert.equal(outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(outcome.promoted, null);
  assert.equal((await store.readPromotion(first.recordClass, first.scope))?.versionId, first.id);
});

test("a stale source-scoped merge base is durably refused before it can roll back a newer pointer", async () => {
  const id = "ballot-navigation" as const;
  const store = new MemoryRoutineDataStore();
  const first = manualProjectionCandidate(packageFor(id, T0, "first"));
  await processRegisteredManualCandidate(store, id, first, T0, null);
  const stale = manualProjectionCandidate(packageFor(id, T1, "stale"), { prior: prior(first) });
  const newer = manualProjectionCandidate(packageFor(id, T2, "newer"), { prior: prior(first) });
  await processRegisteredManualCandidate(store, id, newer, T2, first.id);
  const refused = await processRegisteredManualCandidate(store, id, stale, T2, first.id);
  assert.equal(refused.candidate.state, "CANNOT_TELL");
  assert.equal(refused.candidate.failureCode, "PROMOTION_BASE_CHANGED");
  assert.equal((await store.readPromotion(first.recordClass, first.scope))?.versionId, newer.id);
});

test("a member an auditor pulled leaves the next version instead of being inherited from its base (DP-15)", async () => {
  const store = new MemoryRoutineDataStore();
  const { candidate: record } = await processRegisteredManualCandidate(store, "venue-resolutions",
    manualProjectionCandidate(packageFor("venue-resolutions", T0, "old")), T0);
  const priorRows = (record.candidate.readModel as CuratedReaderProjection).records;
  const { candidate: first, expectedBaseVersionId } = await prepareManualProjectionSuccessor(packageFor("venue-resolutions", T1, "new", false, true), store, T1);
  assert.ok((first.readModel as CuratedReaderProjection).records.some((row) => row.id === priorRows[1].id), "unpulled, the old member is retained");
  const firstOutcome = await processRegisteredManualCandidate(store, "venue-resolutions", first, T1, expectedBaseVersionId);
  assert.ok(firstOutcome.promoted);

  const pulledIds = new Set([priorRows[1].id]);
  const { candidate: next, expectedBaseVersionId: base } = await prepareManualProjectionSuccessor(
    packageFor("venue-resolutions", T2, "newer", false, true), store, T2, pulledIds);
  const rows = (next.readModel as CuratedReaderProjection).records;
  assert.ok(!rows.some((row) => row.id === priorRows[1].id), "the pulled member is gone from the next version");
  assert.ok(next.excludedFacts?.some((fact) => fact.code === "AUDIT_PULLED_FROM_VERSION" && fact.key === priorRows[1].id));
  const outcome = await processRegisteredManualCandidate(store, "venue-resolutions", next, T2, base);
  assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
  const stored = await store.readCandidate(next.id);
  assert.ok(!(stored?.candidate.readModel as CuratedReaderProjection).records.some((row) => row.id === priorRows[1].id),
    "the promoted version no longer carries the pulled member");
});
