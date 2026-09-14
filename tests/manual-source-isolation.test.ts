import assert from "node:assert/strict";
import test from "node:test";

import {
  manualProjectionCandidate,
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

type CuratedId = "comment-access" | "ballot-navigation" | "campaign-sites" | "venue-resolutions";

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
  if (id === "comment-access") {
    return [one, two].map((sourceUrl, index) => ({
      id: `comment-access:body:${index + 1}`,
      bodyId: `body:${index + 1}`,
      commentPeriod: "YES",
      commentPeriodDetail: `rule-${revision}-${index + 1}`,
      sourceUrl,
      collectedAt: at,
    }));
  }
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
  for (const id of ["comment-access", "ballot-navigation", "campaign-sites", "venue-resolutions"] as const) {
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
  for (const id of ["comment-access", "ballot-navigation", "campaign-sites", "venue-resolutions"] as const) {
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
  const id = "comment-access" as const;
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
