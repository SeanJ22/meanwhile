import assert from "node:assert/strict";
import test from "node:test";

import {
  factFreshnessFromPermanentMeetings,
  type PermanentMeetingsReceipt,
} from "../lib/control-plane/promotion/fact-freshness.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import type { RoutineContractObservation } from "../lib/civic-data/observability.ts";
import { PIMA_LEGISTAR_CONTRACT as PIMA_CONTRACT } from "../lib/control-plane/workers/held-meeting-contract.ts";

/**
 * Meeting-fact classes are immutable evidence only: they read the permanent meetings receipt but can neither install
 * an acquisition clock nor become a second promotion authority.
 */

function permanentMeetingsReceiptFixture(input: {
  readonly promotedAt: string;
  readonly nextDueAt: string;
  readonly freshness?: "FRESH" | "DUE" | "STALE" | "UNKNOWN";
  readonly currentState?: "PROMOTED" | "SOURCE_BLOCKED";
  readonly lkgServing?: boolean;
}): PermanentMeetingsReceipt {
  const partition = meetingPartitionForRow("legistar", PIMA_CONTRACT.subjectId);
  const versionId = "meetings-permanent-v1";
  const value = {
    contractId: partition.id,
    sourceId: "meetings-public-bodies",
    recordClass: "MEETING",
    scope: partition.scope,
    currentState: { kind: "MEASURED", value: input.currentState ?? "PROMOTED" },
    canonicalPromotion: {
      kind: "MEASURED",
      value: {
        versionId,
        promotedAt: input.promotedAt,
        authorityOrigin: "LIVE_SOURCE_ACQUISITION" as const,
        receipt: {
          contractVersion: 2,
          decision: "GOOD",
          candidateId: versionId,
          sourceId: "meetings-public-bodies",
          recordClass: "MEETING",
          scope: partition.scope,
          validatedAt: input.promotedAt,
          checks: [],
          excludedFacts: [],
        },
        pointerProof: [`pointer:MEETING:${partition.scope}:${versionId}`],
      },
    },
    readerVisible: {
      kind: "MEASURED",
      value: {
        projectionId: "meetings-snapshot",
        versionId,
        observedAt: input.promotedAt,
        eventId: `reader-event:${versionId}`,
        evidenceKind: "TYPED_READER_READ_MODEL",
        verifierId: "lib/meetings/snapshot.ts#readMeetingsProjection",
        verifierCodeSha: "e".repeat(40),
        detail: "The typed meetings Reader returned the exact promoted version.",
        proof: [`reader:${versionId}`],
      },
    },
    cadence: {
      clock: "STANDING",
      description: "daily through the 2026 general election, then weekly",
      activeEveryMs: 24 * 3_600_000,
      retryDescription: "one hour after a failed source-isolated attempt",
      nextDue: { kind: "MEASURED", value: input.nextDueAt },
      operationalState: input.currentState === "SOURCE_BLOCKED" ? "RETRYING" : "HEALTHY",
      operationalDetail: input.currentState === "SOURCE_BLOCKED" ? "fixture source retry" : "fixture source healthy",
      freshness: input.freshness ?? "FRESH",
      freshnessDetail: "fixture canonical GOOD acquisition is inside the active cadence",
    },
    lkg: {
      kind: "MEASURED",
      value: {
        versionId,
        currentlyServing: input.lkgServing ?? false,
        state: input.lkgServing ? "SERVING_AFTER_LATER_ATTEMPT" : "CURRENT_PROMOTION",
        detail: "fixture LKG proof",
      },
    },
  } satisfies Pick<RoutineContractObservation,
    "contractId" | "sourceId" | "recordClass" | "scope" | "currentState" |
    "canonicalPromotion" | "readerVisible" | "cadence" | "lkg">;
  return { kind: "HELD", value: [value] };
}

test("PDC: a failed permanent meetings attempt stays a data-plane LKG/retry receipt and never becomes a legacy acquisition clock", () => {
  const promotedAt = "2026-09-08T12:00:00.000Z";
  const nextDueAt = "2026-09-08T13:00:00.000Z";
  const receipt = permanentMeetingsReceiptFixture({
    promotedAt,
    nextDueAt,
    currentState: "SOURCE_BLOCKED",
    lkgServing: true,
  });
  const reading = factFreshnessFromPermanentMeetings(receipt, {
    recordClass: "agendas",
    subjectId: PIMA_CONTRACT.subjectId,
    meetingSource: "legistar",
    lastSuccessfulAcquisitionAt: promotedAt,
  });
  assert.equal(reading.state, "SOURCE_FAILING");
  assert.equal(reading.hold, false, "fresh LKG remains usable while the permanent runner retries");
  assert.equal(reading.sourceFailureWithoutFalseEmpty, true);
  assert.equal(reading.retryAt, nextDueAt);
  assert.equal(reading.obligation, null, "no legacy standing-obligation row is revived");
});
