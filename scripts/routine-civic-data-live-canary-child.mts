/**
 * TEMPORARY PDC-12 one-contract live canary child.
 *
 * The read-only PDC-12 coordinator spawns this process with one normal
 * ROUTINE_CONTRACT capability bound to the coordinator's actual PID. The
 * child can exercise exactly one registered source contract and reports one
 * durable result. It has neither a multi-contract door nor an importer door.
 *
 * This file is cutover scaffolding. Extract it beside the coordinator under
 * the deployed checkout's ignored `.runtime/` directory, then delete it from
 * the final Git tree before the single software ship.
 *
 * @freshness-reads-here — attemptedAt is the canary source-attempt event
 * written to the canonical candidate plane, never a claim of source currency.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { requiredMeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import {
  processRegisteredMeetingPartitionCandidate,
  processRegisteredRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { assertRuntimeAuthority, runtimeAuthorityEnvelope } from "../lib/civic-data/runtime-authority.ts";
import {
  recordRegisteredSourceAcquisitionFailure,
  sourceAcquisitionFailure,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateState, RoutineCandidate } from "../lib/civic-data/types.ts";
import { isDirectModuleExecution } from "../lib/ops/main-module.ts";
import { requiredAssignment } from "../scripts/cli-args.mts";

export type Pdc12CanaryKind =
  | "PARSER_INVALID"
  | "IDENTITY_INVALID"
  | "TEMPORAL_INVALID"
  | "MEETING_SEMANTIC_INVALID"
  | "HORIZON_INVALID"
  | "DEPENDENT_CONSUMER_INVALID"
  | "SOURCE_UNAVAILABLE";

export interface Pdc12CanaryRequest {
  readonly contractId: string;
  readonly kind: Pdc12CanaryKind;
  readonly expectedVersionId: string;
}

export interface Pdc12CanaryChildReceipt {
  readonly contractId: string;
  readonly kind: Pdc12CanaryKind;
  readonly candidateId: string;
  readonly attemptedAt: string;
  readonly state: CandidateState;
  readonly failureCode: string;
  readonly acquisitionSucceeded: boolean;
  readonly promotedVersion: null;
  readonly beforeVersion: string;
  readonly afterVersion: string;
  readonly lastKnownGoodVersion: string;
  readonly pointerAndPayloadHeld: true;
  readonly authorityCapability: "ROUTINE_CONTRACT";
  readonly authorityContract: string;
}

const EXACT_NON_MEETING_KIND = Object.freeze({
  "fec-funding": "PARSER_INVALID",
  "nh-members": "IDENTITY_INVALID",
  "census-acs-population": "TEMPORAL_INVALID",
  "nj-morris-filing": "HORIZON_INVALID",
  dotgov: "DEPENDENT_CONSUMER_INVALID",
} satisfies Readonly<Record<string, Pdc12CanaryKind>>);

const EXPECTED_DISPOSITION = Object.freeze({
  PARSER_INVALID: { state: "PARSE_INVALID", failureCode: "PARSER_FAILED" },
  IDENTITY_INVALID: { state: "IDENTITY_UNRESOLVED", failureCode: "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE" },
  TEMPORAL_INVALID: { state: "TEMPORAL_INVALID", failureCode: "WRONG_PERIOD_OR_VINTAGE" },
  MEETING_SEMANTIC_INVALID: { state: "SEMANTIC_INVALID", failureCode: "SEMANTIC_CONTRACT_VIOLATION" },
  HORIZON_INVALID: { state: "HORIZON_UNRESOLVED", failureCode: "COMPLETE_UNIVERSE_UNBOUNDED" },
  DEPENDENT_CONSUMER_INVALID: { state: "DEPENDENT_CONSUMER_INVALID", failureCode: "DEPENDENT_CONSUMER_REJECTED" },
  SOURCE_UNAVAILABLE: { state: "SOURCE_BLOCKED", failureCode: "SOURCE_UNAVAILABLE" },
} as const satisfies Readonly<Record<Pdc12CanaryKind, { readonly state: CandidateState; readonly failureCode: string }>>);

const DATABASE_SECRET_VARIABLES = [
  "DATABASE_URL",
  "WTP_PRODUCTION_DATABASE_URL_WRITE",
  "WTP_PRODUCTION_DATABASE_URL_READONLY",
] as const;

/** A database/client exception must never echo a credential into the coordinator log. */
export function redactPdc12CanaryChildError(
  error: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = DATABASE_SECRET_VARIABLES
    .map((name) => env[name])
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length);
  for (const secret of secrets) message = message.replaceAll(secret, "[REDACTED_DATABASE_URL]");
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(
      /\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[^\s,"'`;}]+/gi,
      "authorization: Bearer [REDACTED]",
    )
    .replace(
      /(["']?(?:password|passwd|token|api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/[\r\n]+/g, " | ");
}

function isCanaryKind(value: string): value is Pdc12CanaryKind {
  return Object.hasOwn(EXPECTED_DISPOSITION, value);
}

/** Pure, deterministic request classifier used by the child and planted tests. */
export function pdc12CanaryRequestIssue(request: Pdc12CanaryRequest): string | null {
  if (!request.contractId.trim() || /[\r\n]/.test(request.contractId)) return "PDC12_CANARY_CONTRACT_INVALID";
  if (!request.expectedVersionId.trim() || /[\r\n]/.test(request.expectedVersionId)) return "PDC12_CANARY_EXPECTED_VERSION_INVALID";
  if (request.kind === "MEETING_SEMANTIC_INVALID") {
    try {
      requiredMeetingPartitionContract(request.contractId);
      return null;
    } catch {
      return "PDC12_CANARY_MEETING_CONTRACT_UNREGISTERED";
    }
  }
  if (request.kind === "SOURCE_UNAVAILABLE") {
    return request.contractId === "dotgov" ? null : "PDC12_SOURCE_UNAVAILABLE_CONTRACT_NOT_DOTGOV";
  }
  const expectedKind = Object.hasOwn(EXACT_NON_MEETING_KIND, request.contractId)
    ? EXACT_NON_MEETING_KIND[request.contractId as keyof typeof EXACT_NON_MEETING_KIND]
    : undefined;
  return expectedKind === request.kind
    ? null
    : "PDC12_CANARY_KIND_CONTRACT_MISMATCH";
}

/** The envelope must carry the same one contract the request names. */
export function pdc12CanaryAuthorityIssue(
  request: Pdc12CanaryRequest,
  envelope: ReturnType<typeof runtimeAuthorityEnvelope>,
): string | null {
  if (envelope === null) return "PDC12_CANARY_AUTHORITY_MISSING";
  if (envelope.capability !== "ROUTINE_CONTRACT") return "PDC12_CANARY_AUTHORITY_NOT_ROUTINE_CONTRACT";
  if (envelope.contract !== request.contractId) return "PDC12_CANARY_AUTHORITY_CONTRACT_MISMATCH";
  return null;
}

export function parsePdc12CanaryRequest(argv: readonly string[]): Pdc12CanaryRequest {
  const contractId = requiredAssignment(argv, "contract", "PDC12_CANARY_FLAG_REQUIRED");
  const kindValue = requiredAssignment(argv, "kind", "PDC12_CANARY_FLAG_REQUIRED");
  const expectedVersionId = requiredAssignment(argv, "expected-version", "PDC12_CANARY_FLAG_REQUIRED");
  if (!isCanaryKind(kindValue)) throw new Error(`PDC12_CANARY_KIND_UNKNOWN:${kindValue}`);
  const request = { contractId, kind: kindValue, expectedVersionId } as const;
  const issue = pdc12CanaryRequestIssue(request);
  if (issue !== null) throw new Error(`${issue}:${contractId}:${kindValue}`);
  return request;
}

function invalidCandidate(
  kind: Exclude<Pdc12CanaryKind, "SOURCE_UNAVAILABLE">,
  valid: RoutineCandidate,
): RoutineCandidate {
  const base = structuredClone(valid);
  const id = `pdc12-${kind.toLowerCase()}-${randomUUID()}`;
  switch (kind) {
    case "PARSER_INVALID":
      return {
        ...base,
        id,
        normalization: {
          ...base.normalization,
          succeeded: false,
          normalizedHash: null,
          failureDetail: "PDC-12 canary: deliberately malformed normalized FEC payload.",
        },
      };
    case "IDENTITY_INVALID":
      return {
        ...base,
        id,
        identities: base.identities.map((identity, index) => index === 0
          ? { ...identity, term: undefined }
          : identity),
      };
    case "TEMPORAL_INVALID":
      return { ...base, id, temporal: { ...base.temporal, version: "1900" } };
    case "MEETING_SEMANTIC_INVALID":
      return {
        ...base,
        id,
        semantics: {
          ...base.semantics,
          violations: [...base.semantics.violations, "PDC-12 canary: deliberate meeting semantic violation."],
        },
      };
    case "HORIZON_INVALID":
      return {
        ...base,
        id,
        horizon: { ...base.horizon, kind: "OPEN_FACT_SET", claimsComplete: true },
      };
    case "DEPENDENT_CONSUMER_INVALID":
      return {
        ...base,
        id,
        dependentChecks: [
          ...base.dependentChecks,
          {
            consumer: "PDC-12 acceptance canary",
            passed: false,
            detail: "Deliberately rejected to prove a dependent-consumer refusal holds exact LKG.",
          },
        ],
      };
  }
}

async function runPdc12CanaryChild(argv: readonly string[] = process.argv): Promise<Pdc12CanaryChildReceipt> {
  const request = parsePdc12CanaryRequest(argv);
  const envelope = runtimeAuthorityEnvelope();
  const authorityIssue = pdc12CanaryAuthorityIssue(request, envelope);
  if (authorityIssue !== null) throw new Error(`${authorityIssue}:${request.contractId}`);
  // This proves clean/detached/origin-main/SHA/immediate-parent in addition to
  // the pure exact-contract correlation above, before any database is opened.
  assertRuntimeAuthority({ capabilities: ["ROUTINE_CONTRACT"], contract: request.contractId });

  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  const before = await store.readPromotion(
    request.kind === "MEETING_SEMANTIC_INVALID" ? "MEETING" :
      request.contractId === "fec-funding" ? "FEC_FUNDING" :
        request.contractId === "nh-members" ? "STATE_LEGISLATOR" :
          request.contractId === "census-acs-population" ? "CENSUS_REFERENCE" :
            request.contractId === "nj-morris-filing" ? "BALLOT_FILING" : "DOTGOV_REFERENCE",
    request.kind === "MEETING_SEMANTIC_INVALID"
      ? requiredMeetingPartitionContract(request.contractId).scope
      : request.contractId === "fec-funding" ? "federal-supported"
        : request.contractId === "nh-members" ? "US-NH"
          : request.contractId === "census-acs-population" ? "acs-population"
            : request.contractId === "nj-morris-filing" ? "US-NJ:county:morris:2026-general"
              : "US:current-full:election-domains",
  );
  assert.ok(before, `${request.contractId}: no LKG pointer exists before the canary`);
  assert.equal(before.versionId, request.expectedVersionId, `${request.contractId}: pointer moved before canary admission`);
  assert.equal(before.lastKnownGoodVersionId, before.versionId);

  const attemptedAt = new Date().toISOString();
  let candidateId: string;
  let state: CandidateState;
  let failureCode: string;
  let acquisitionSucceeded: boolean;
  let lastKnownGoodVersion: string | null;
  if (request.kind === "SOURCE_UNAVAILABLE") {
    const recorded = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: request.contractId,
      attemptedAt,
      failure: sourceAcquisitionFailure(
        "PUBLISHER_UNAVAILABLE",
        "PDC-12 canary: publisher unavailable before any response bytes arrived.",
      ),
    });
    candidateId = recorded.outcome.candidate.candidate.id;
    state = recorded.outcome.candidate.state;
    failureCode = recorded.outcome.candidate.failureCode ?? "";
    acquisitionSucceeded = recorded.outcome.candidate.acquisitionSucceeded;
    lastKnownGoodVersion = recorded.outcome.candidate.lastKnownGoodVersion;
    assert.equal(recorded.outcome.promoted, null);
  } else {
    const valid = await store.readCandidate(before.versionId);
    assert.ok(valid, `${request.contractId}: pointed LKG candidate is missing`);
    assert.equal(valid.state, "PROMOTED");
    assert.equal(valid.receipt?.decision, "GOOD");
    const candidate = invalidCandidate(request.kind, valid.candidate);
    const outcome = request.kind === "MEETING_SEMANTIC_INVALID"
      ? await processRegisteredMeetingPartitionCandidate(
          store,
          request.contractId,
          candidate,
          attemptedAt,
          request.expectedVersionId,
        )
      : await processRegisteredRoutineCandidate(store, request.contractId, candidate, attemptedAt);
    assert.equal(outcome.promoted, null);
    candidateId = outcome.candidate.candidate.id;
    state = outcome.candidate.state;
    failureCode = outcome.candidate.failureCode ?? "";
    acquisitionSucceeded = outcome.candidate.acquisitionSucceeded;
    lastKnownGoodVersion = outcome.candidate.lastKnownGoodVersion;
  }

  const expected = EXPECTED_DISPOSITION[request.kind];
  assert.equal(state, expected.state, `${request.contractId}: canary settled in the wrong source state`);
  // Acquisition failures retain their source-error detail but the canonical
  // validation receipt's first refusing check is SOURCE_UNAVAILABLE.
  if (request.kind !== "SOURCE_UNAVAILABLE") {
    assert.equal(failureCode, expected.failureCode, `${request.contractId}: canary carried the wrong refusal code`);
  } else {
    assert.ok(failureCode, `${request.contractId}: source-unavailable canary has no durable failure code`);
  }
  assert.equal(lastKnownGoodVersion, before.versionId, `${request.contractId}: canary lost its exact LKG reference`);
  const durable = await store.readCandidate(candidateId);
  assert.ok(durable, `${request.contractId}: canary candidate is not durable`);
  assert.equal(durable.state, state);
  const after = await store.readPromotion(before.recordClass, before.scope);
  assert.ok(after, `${request.contractId}: canary erased the pointer`);
  assert.equal(after.versionId, before.versionId, `${request.contractId}: canary moved the pointer`);
  assert.equal(after.lastKnownGoodVersionId, before.lastKnownGoodVersionId, `${request.contractId}: canary changed LKG`);
  assert.equal(normalizedHash(after.payload), normalizedHash(before.payload), `${request.contractId}: canary changed served payload`);
  assert.equal(after.promotedAt, before.promotedAt, `${request.contractId}: canary rewrote the promotion time`);
  assert.deepEqual(after.receipt, before.receipt, `${request.contractId}: canary rewrote the GOOD receipt`);

  const receipt: Pdc12CanaryChildReceipt = {
    contractId: request.contractId,
    kind: request.kind,
    candidateId,
    attemptedAt,
    state,
    failureCode,
    acquisitionSucceeded,
    promotedVersion: null,
    beforeVersion: before.versionId,
    afterVersion: after.versionId,
    lastKnownGoodVersion: before.lastKnownGoodVersionId,
    pointerAndPayloadHeld: true,
    authorityCapability: "ROUTINE_CONTRACT",
    authorityContract: envelope!.contract!,
  };
  console.log(`PDC12_CANARY_CHILD=${JSON.stringify(receipt)}`);
  return receipt;
}

if (isDirectModuleExecution(import.meta.url)) {
  void runPdc12CanaryChild().catch((error: unknown) => {
    console.error(`PDC12_CANARY_CHILD_REFUSED:${redactPdc12CanaryChildError(error)}`);
    process.exitCode = 2;
  });
}
