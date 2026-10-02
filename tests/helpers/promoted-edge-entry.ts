import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { promotedPayloadSha256 } from "../../lib/civic-data/attested-promotion.ts";
import { requiredManualProductionContract, type ManualProductionContractId } from "../../lib/civic-data/manual-contracts.ts";
import type { CivicDataReadResult, PromotedEdgeEntry } from "../../lib/civic-data/read-model.ts";
import type { PromotedFamilyArtifactValue } from "../../lib/meetings/edge-artifacts.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES } from "../../lib/funding/data-plane.ts";
import { projectionKey } from "../../lib/civic-data/store.ts";
import { VALIDATION_CHECKS, type RoutineRecordClass, type ValidationReceipt } from "../../lib/civic-data/types.ts";

/**
 * A proven pointer as the reader edge carries it, built from a value the test
 * already holds (a first seed or a tracked fixture): the pointer row with a
 * GOOD eight-check receipt naming its version, and the attestation of that
 * version with the payload's own SHA-256. Every Reader-side check of the edge
 * copy (`readPromotedCivicData` with `{ edge }`) holds for it, exactly as for
 * an entry the runner publishes from a real proof.
 */
export function provenEdgeEntry<T>(input: {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly value: T;
  readonly retrievedAt?: string;
  readonly promotedAt?: string;
  readonly sourceThrough?: string | null;
  readonly version?: string | null;
}): Extract<PromotedEdgeEntry<T>, { kind: "PROMOTED" }> {
  const retrievedAt = input.retrievedAt ?? "2026-09-25T12:00:00.000Z";
  const promotedAt = input.promotedAt ?? retrievedAt;
  const receipt: ValidationReceipt = {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: input.versionId,
    sourceId: input.sourceId,
    recordClass: input.recordClass,
    scope: input.scope,
    validatedAt: retrievedAt,
    checks: VALIDATION_CHECKS.map((check) => ({ check, verdict: "PASS", code: `${check}_PASS`, detail: "Held for the reader edge test." })),
    excludedFacts: [],
  } as unknown as ValidationReceipt;
  return {
    kind: "PROMOTED",
    projection: {
      key: projectionKey(input.recordClass, input.scope),
      sourceId: input.sourceId,
      recordClass: input.recordClass,
      scope: input.scope,
      versionId: input.versionId,
      lastKnownGoodVersionId: input.versionId,
      promotedAt,
      payload: input.value,
      receipt,
    },
    attested: {
      recordClass: input.recordClass,
      scope: input.scope,
      versionId: input.versionId,
      payloadSha256: promotedPayloadSha256(input.value),
      retrievedAt,
      staleAtRetrieval: false,
      version: input.version ?? null,
      sourceThrough: input.sourceThrough ?? retrievedAt.slice(0, 10),
    },
  };
}

/** An answered, absent pointer as the reader edge carries it. */
export function absentEdgeEntry(recordClass: RoutineRecordClass, scope: string): PromotedEdgeEntry {
  return { kind: "NOT_RECORDED", recordClass, scope };
}

/** A manual contract's pointer, proven, carrying `value`. */
export function manualEdgeEntry(id: ManualProductionContractId, value: unknown, versionId: string): PromotedEdgeEntry {
  const contract = requiredManualProductionContract(id);
  return provenEdgeEntry({ recordClass: contract.recordClass, scope: contract.scope, sourceId: contract.sourceId, versionId, value });
}

/** The value a first-seed or fixture read serves (the test's own database path). */
export function servedValue<T>(read: CivicDataReadResult<T>): T {
  assert.ok(read.kind === "BOOTSTRAP" || read.kind === "PROMOTED", `the first seed is readable: ${read.kind}`);
  return read.value as T;
}

/** Money pointers for the tracked fixtures actually held by these tests. */
export function stateMoneyFixtureEntries(versionFor: (state: string) => string): PromotedEdgeEntry[] {
  const root = join(process.cwd(), "data", "states");
  const fixtures = readdirSync(root).flatMap(slug => {
    const funding = join(root, slug, "funding");
    return existsSync(funding) ? readdirSync(funding).flatMap(file => {
      const match = /^state-money-([a-z]{2})-(\d+)\.json$/.exec(file);
      return match?.[1] === slug ? [{ state: slug.toUpperCase(), cycle: Number(match[2]), path: join(funding, file) }] : [];
    }) : [];
  }).filter(({ state, cycle }) => STATE_CAMPAIGN_FINANCE_SOURCES[state]?.cycle === cycle);
  return fixtures.map(({ state, path }) => provenEdgeEntry({
    recordClass: "STATE_CAMPAIGN_FINANCE",
    scope: STATE_CAMPAIGN_FINANCE_SOURCES[state].scope,
    sourceId: STATE_CAMPAIGN_FINANCE_SOURCES[state].sourceId,
    versionId: versionFor(state),
    value: JSON.parse(readFileSync(path, "utf8")) as unknown,
  }));
}

/** A proven-pointer family's published value. */
export function promotedFamily(entries: readonly PromotedEdgeEntry[], versionId: string): { value: PromotedFamilyArtifactValue; versionId: string } {
  return { value: { kind: "PROMOTED_POINTERS", entries }, versionId };
}
