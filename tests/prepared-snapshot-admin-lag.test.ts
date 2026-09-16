import assert from "node:assert/strict";
import { test } from "node:test";

import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import {
  projectRoutineDataObservability,
  type RoutineObservabilityRows,
  type RoutinePreparedProjectionRow,
  type RoutinePromotionRow,
} from "../lib/civic-data/observability.ts";

const NOW = "2026-09-15T12:00:00.000Z";
const C0 = MEETING_PARTITION_CONTRACTS[0]!;
const C1 = MEETING_PARTITION_CONTRACTS[1]!;

function promotion(contract: typeof C0, versionId: string): RoutinePromotionRow {
  return {
    key: `MEETING:${contract.scope}`,
    sourceId: contract.sourceId,
    recordClass: "MEETING",
    scope: contract.scope,
    currentVersionId: versionId,
    lastKnownGoodVersionId: versionId,
    promotedAt: NOW,
    payload: {},
    validationReceipt: {},
  };
}

function preparedRow(composedFrom: { contractId: string; versionId: string }[]): RoutinePreparedProjectionRow {
  return {
    key: "MEETING:composed-reader-snapshot",
    recordClass: "MEETING",
    scope: "composed-reader-snapshot",
    sequence: 5,
    composedFrom,
    generatedAt: "2026-09-15T11:30:00.000Z",
    composedAt: "2026-09-15T11:31:00.000Z",
    promotedThrough: "2026-09-15T11:29:00.000Z",
  };
}

function rows(overrides: Partial<RoutineObservabilityRows>): RoutineObservabilityRows {
  return { candidates: [], events: [], promotions: [], ...overrides };
}

test("admin lag: a serving copy composed from the current promotions reports zero lag", () => {
  const view = projectRoutineDataObservability(
    rows({
      promotions: [promotion(C0, "v0"), promotion(C1, "v1")],
      preparedProjections: [preparedRow([
        { contractId: C0.id, versionId: "v0" },
        { contractId: C1.id, versionId: "v1" },
      ])],
    }),
    NOW,
    [C0],
  );
  const snap = view.preparedMeetingSnapshot;
  assert.equal(snap.present, true);
  assert.equal(snap.sequence.kind === "MEASURED" && snap.sequence.value, 5);
  assert.equal(snap.lag.kind, "MEASURED");
  assert.equal(snap.lag.kind === "MEASURED" && snap.lag.value, 0);
  assert.match(snap.detail, /Current/);
});

test("admin lag: a partition promoted past the serving copy is exact publication lag", () => {
  const view = projectRoutineDataObservability(
    rows({
      // C1 has advanced to v1-new, but the serving copy still holds v1.
      promotions: [promotion(C0, "v0"), promotion(C1, "v1-new")],
      preparedProjections: [preparedRow([
        { contractId: C0.id, versionId: "v0" },
        { contractId: C1.id, versionId: "v1" },
      ])],
    }),
    NOW,
    [C0],
  );
  const snap = view.preparedMeetingSnapshot;
  assert.equal(snap.lag.kind, "MEASURED");
  if (snap.lag.kind !== "MEASURED") return;
  assert.equal(snap.lag.value, 1);
  const member = snap.lag.members[0]!;
  assert.equal(member.contractId, C1.id);
  assert.equal(member.promotedVersionId, "v1-new");
  assert.equal(member.servedVersionId, "v1", "the serving copy's older version is named, not hidden");
  assert.match(snap.detail, /advanced past serving/);
});

test("admin lag: a partition absent from the serving copy is lag with a null served version", () => {
  const view = projectRoutineDataObservability(
    rows({
      promotions: [promotion(C0, "v0"), promotion(C1, "v1")],
      // The serving copy was composed from C0 only; C1 is promoted but unserved.
      preparedProjections: [preparedRow([{ contractId: C0.id, versionId: "v0" }])],
    }),
    NOW,
    [C0],
  );
  const snap = view.preparedMeetingSnapshot;
  assert.equal(snap.lag.kind === "MEASURED" && snap.lag.value, 1);
  const member = snap.lag.kind === "MEASURED" ? snap.lag.members[0]! : null;
  assert.equal(member?.contractId, C1.id);
  assert.equal(member?.servedVersionId, null, "an unserved partition is null, never invented");
});

test("admin lag: no serving copy at all is an explicit first-seed condition, not a zero", () => {
  const present = projectRoutineDataObservability(
    rows({ promotions: [promotion(C0, "v0")], preparedProjections: [] }),
    NOW,
    [C0],
  ).preparedMeetingSnapshot;
  assert.equal(present.present, false);
  assert.equal(present.lag.kind, "NOT_RECORDED", "absence of a serving copy is never a measured zero lag");
  assert.match(present.detail, /No prepared reader snapshot exists yet/);
});

test("admin lag: an unread serving copy is not-recorded, distinct from a rollout absence", () => {
  // preparedProjections omitted entirely (a reader that predates this read).
  const snap = projectRoutineDataObservability(
    rows({ promotions: [promotion(C0, "v0")] }),
    NOW,
    [C0],
  ).preparedMeetingSnapshot;
  assert.equal(snap.present, false);
  assert.equal(snap.lag.kind, "NOT_RECORDED");
  assert.match(snap.detail, /was not read/);
});
