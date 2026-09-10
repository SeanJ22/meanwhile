/**
 * PDC adoption boundary for the live method-candidate lifecycle.
 *
 * The legacy aggregate was imported once while the cutover tree was dirty.
 * Its bytes are useful LKG, but the import process itself is not acceptable as
 * terminal proof.  This module lets the first clean, detached, deployed runner
 * verify that exact revision and append an immutable adoption receipt to the
 * owner digest log Admin already consumes.  It never seeds, replaces, or
 * repairs the aggregate, and it never reads the tracked seed at runtime.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  CANDIDATE_LIFECYCLE_STATES,
  candidateCounts,
  type CandidateStore,
  type MethodCandidate,
} from "../method/candidate.ts";
import { DIGEST_LOG_KEY } from "./admin-data.ts";
import { appendMethodCandidateAuthorityAdoptionDigest } from "./freshness-cycle-outcome.ts";
import {
  METHOD_CANDIDATE_STORE_ID,
} from "./scheduler/scout-candidates.ts";
import {
  canonicalJson,
  type ControlPlaneRepositories,
  type Persisted,
} from "./repository/types.ts";
import type {
  MethodCandidateAuthorityAdoptionOutcome,
  OwnerDigestRecord,
} from "./owner-surface.ts";

const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * Immutable evidence for the exact seven-row PDC seed.  The tracked JSON is
 * retained only as historical engineering evidence.  Runtime code compares
 * the control-plane value with this digest and never opens that path.
 */
export const METHOD_CANDIDATE_CUTOVER_SEED = Object.freeze({
  frozenBaseSha: "fc67e8cd34c489590c403f7b4a0d6008fa755296",
  trackedSourcePath: "data/method/candidates.json" as const,
  sourceGitBlobSha1: "5ca91ada3d17f18c64abe346a31351d1d37337b9",
  sourceRawSha256: "63f2fb4767dc5557ea9cdfc5713fd8f9dfc0d0a70c65fd25d5a5c255b00ab0c8",
  canonicalSha256: "5bee0b1f14936c1fd874d192dc627d23cd22aec1dbc7bddf1a21ff8d102c53dd",
  candidateCount: 7 as const,
  lifecycleCounts: Object.freeze({ PROPOSED: 0 as const, VALIDATED: 7 as const, ADMITTED: 0 as const, REJECTED: 0 as const }),
  candidateCoreSha256: Object.freeze({
    "mc-cc62621af42211a504bcc8d7": "87cebe40c80dd3b0bf031ad277e5b2943129093eced0e9f9e51bc3063c2827e5",
    "mc-2b5a498f765ffac8b0d6c6d0": "a0d68f18a3bd01cfa1765e3a01061f249b3ba8ecabba04ee7b87e9b53405c561",
    "mc-ca7ff5853eea33783b3b35bb": "5509936f1777d1f2f807488f2bdf57c5b176fb3547c9239b259b3c5c2ed4c36f",
    "mc-c0e188c3caf914b4b52b94f2": "8d5d0fd0bc7fc64632e7593cccba2ed06665360ed5512d9d5333ed7a792792a2",
    "mc-54a3b641ab944461c5516985": "8272205b94e6eaf666599cd2f1d28b61addc3dfd0942582889f0b0482235ffbd",
    "mc-a61c2325243030ae230fa528": "bb51f3ee5d1d95a106fbbe148899f6f8121070c0249f5c2e22d3ca9ad7d43d02",
    "mc-3322942847cf20776b0c4a80": "c54780f268d2bcc4ff88b8787023259124935b42cb53817282ed68458f6a73c3",
  }),
});

export interface MethodCandidateAdoptionCodeProof {
  readonly expectedCodeSha: string | null;
  readonly headSha: string | null;
  readonly headEqualsCodeSha: boolean;
  readonly cleanTree: boolean;
  readonly detachedHead: boolean;
  readonly originMainContainsHead: boolean;
}

export interface MethodCandidateAuthorityStatus {
  readonly state: "ADOPTED" | "UNVERIFIED" | "REFUSED" | "NOT_RECORDED" | "STORE_UNREACHABLE";
  readonly code: string;
  readonly detail: string;
  readonly aggregateRevision: number | null;
  readonly aggregateUpdatedAt: string | null;
  readonly verifierCodeSha: string | null;
  readonly verifiedAt: string | null;
}

export type MethodCandidateAuthorityAdoptionResult =
  | {
      readonly ok: true;
      readonly adoptedNow: boolean;
      readonly outcome: MethodCandidateAuthorityAdoptionOutcome;
      readonly status: MethodCandidateAuthorityStatus;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail: string;
      readonly status: MethodCandidateAuthorityStatus;
    };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function candidateCore(candidate: MethodCandidate): Omit<MethodCandidate, "lifecycle" | "validation" | "admission" | "rejection"> {
  const { lifecycle: _lifecycle, validation: _validation, admission: _admission, rejection: _rejection, ...core } = candidate;
  return core;
}

/** Stable fingerprint of the proposal/provenance fields lifecycle transitions may never rewrite. */
export function methodCandidateCoreSha256(candidate: MethodCandidate): string {
  return sha256(canonicalJson(candidateCore(candidate)));
}

function storeHash(store: CandidateStore): string {
  return sha256(canonicalJson(store));
}

function seedLineageIssues(store: CandidateStore): readonly string[] {
  const issues: string[] = [];
  if (store === null || typeof store !== "object" || Array.isArray(store)) {
    return ["the live aggregate is not a candidate-store object"];
  }
  const record = store as unknown as Record<string, unknown>;
  if (record.storeVersion !== 1 || !Array.isArray(record.candidates)) {
    return ["the live aggregate is not candidate-store version 1"];
  }
  const candidates = record.candidates;
  const malformed = candidates.filter((candidate) => candidate === null || typeof candidate !== "object" || Array.isArray(candidate));
  if (malformed.length > 0) {
    issues.push(`${malformed.length} live candidate row(s) are not objects`);
  }
  const validObjects = candidates.filter(
    (candidate): candidate is Record<string, unknown> => candidate !== null && typeof candidate === "object" && !Array.isArray(candidate),
  );
  const ids = validObjects.map((candidate) => typeof candidate.id === "string" ? candidate.id : "(missing id)");
  if (new Set(ids).size !== ids.length) issues.push("the live aggregate contains duplicate candidate ids");
  for (const candidate of validObjects) {
    if (typeof candidate.id !== "string" || candidate.id === "") issues.push("a live candidate row has no string id");
    if (!(CANDIDATE_LIFECYCLE_STATES as readonly unknown[]).includes(candidate.lifecycle)) {
      issues.push(`${typeof candidate.id === "string" ? candidate.id : "(missing id)"} has unrecognized lifecycle ${String(candidate.lifecycle)}`);
    }
  }
  for (const [id, expected] of Object.entries(METHOD_CANDIDATE_CUTOVER_SEED.candidateCoreSha256)) {
    const matches = validObjects.filter((candidate) => candidate.id === id);
    if (matches.length !== 1) {
      issues.push(`${id} occurs ${matches.length} times instead of once`);
      continue;
    }
    const candidate = matches[0] as unknown as MethodCandidate;
    const actual = methodCandidateCoreSha256(candidate);
    if (actual !== expected) issues.push(`${id} immutable proposal/provenance core does not match the adopted seed`);
    if (candidate.lifecycle === "PROPOSED") {
      issues.push(`${id} moved backward from the seed's VALIDATED lifecycle to PROPOSED`);
    }
  }
  return issues;
}

function hasAdoptionKind(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.kind === "METHOD_CANDIDATE_AUTHORITY_ADOPTION";
}

function receiptMatchesSeed(value: unknown): value is MethodCandidateAuthorityAdoptionOutcome {
  if (!hasAdoptionKind(value)) return false;
  try {
    const outcome = value as MethodCandidateAuthorityAdoptionOutcome;
    const expectedReceiptId =
      `method-candidate-authority-adoption:v1:${outcome.verifier.codeSha}:${METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256}`;
    return outcome.state === "ADOPTED" &&
      outcome.receiptId === expectedReceiptId &&
      isIsoInstant(outcome.startedAt) &&
      outcome.finishedAt === outcome.startedAt &&
      outcome.authority.repository === "cp_method_candidates" &&
      outcome.authority.aggregateId === METHOD_CANDIDATE_STORE_ID &&
      outcome.authority.aggregateRevision === 1 &&
      isIsoInstant(outcome.authority.aggregateUpdatedAt) &&
      outcome.authority.canonicalSha256 === METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256 &&
      outcome.seedEvidence.frozenBaseSha === METHOD_CANDIDATE_CUTOVER_SEED.frozenBaseSha &&
      outcome.seedEvidence.trackedSourcePath === METHOD_CANDIDATE_CUTOVER_SEED.trackedSourcePath &&
      outcome.seedEvidence.sourceGitBlobSha1 === METHOD_CANDIDATE_CUTOVER_SEED.sourceGitBlobSha1 &&
      outcome.seedEvidence.sourceRawSha256 === METHOD_CANDIDATE_CUTOVER_SEED.sourceRawSha256 &&
      outcome.seedEvidence.canonicalSha256 === METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256 &&
      outcome.seedEvidence.candidateCount === METHOD_CANDIDATE_CUTOVER_SEED.candidateCount &&
      outcome.seedEvidence.lifecycleCounts.PROPOSED === METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.PROPOSED &&
      outcome.seedEvidence.lifecycleCounts.VALIDATED === METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.VALIDATED &&
      outcome.seedEvidence.lifecycleCounts.ADMITTED === METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.ADMITTED &&
      outcome.seedEvidence.lifecycleCounts.REJECTED === METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.REJECTED &&
      outcome.verifier.headEqualsCodeSha === true &&
      outcome.verifier.cleanTree === true &&
      outcome.verifier.detachedHead === true &&
      outcome.verifier.originMainContainsHead === true &&
      FULL_SHA.test(outcome.verifier.codeSha) &&
      outcome.verifier.codeSha === outcome.verifier.codeSha.toLowerCase() &&
      outcome.verifier.codeSha === outcome.testedSha &&
      outcome.authorityBoundary.canonicalAuthority === "CONTROL_PLANE_CP_METHOD_CANDIDATES" &&
      outcome.authorityBoundary.gitRole === "HISTORICAL_SEED_EVIDENCE_ONLY" &&
      outcome.authorityBoundary.trackedRuntimeReads === 0 &&
      outcome.authorityBoundary.trackedRuntimeWrites === 0;
  } catch {
    return false;
  }
}

function statusFrom(
  current: Persisted<CandidateStore> | null,
  digests: readonly OwnerDigestRecord[],
): MethodCandidateAuthorityStatus {
  if (current === null) {
    return {
      state: "NOT_RECORDED",
      code: "METHOD_CANDIDATE_AUTHORITY_ABSENT",
      detail: "The canonical method-candidate aggregate is absent; absence is not an empty candidate population.",
      aggregateRevision: null,
      aggregateUpdatedAt: null,
      verifierCodeSha: null,
      verifiedAt: null,
    };
  }
  const outcomes = digests.flatMap((digest) => hasAdoptionKind(digest.runtimeOutcome) ? [digest.runtimeOutcome] : []);
  const validReceipts = outcomes.filter(receiptMatchesSeed);
  const receipt = validReceipts.length === 1 ? validReceipts[0]! : null;
  if (outcomes.length > 0 && (validReceipts.length !== outcomes.length || validReceipts.length !== 1)) {
    return {
      state: "REFUSED",
      code: "METHOD_CANDIDATE_ADOPTION_RECEIPT_MISMATCH",
      detail: validReceipts.length > 1
        ? "More than one clean-code adoption receipt claims the one-time frozen seed; the authority history is ambiguous."
        : "An adoption-shaped owner receipt exists but it does not bind the frozen PDC seed and authority boundary.",
      aggregateRevision: current.revision,
      aggregateUpdatedAt: current.updatedAt,
      verifierCodeSha: null,
      verifiedAt: null,
    };
  }
  if (receipt === null) {
    const exactSeed = current.revision === 1 && storeHash(current.value) === METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256;
    return {
      state: exactSeed ? "UNVERIFIED" : "REFUSED",
      code: exactSeed ? "METHOD_CANDIDATE_SEED_AWAITS_CLEAN_ADOPTION" : "METHOD_CANDIDATE_UNADOPTED_AGGREGATE_MOVED",
      detail: exactSeed
        ? "The exact frozen seed is present at revision 1, but no clean-code adoption receipt is held yet."
        : "No valid adoption receipt exists and the live aggregate is not the exact frozen revision-1 seed; automatic adoption is refused.",
      aggregateRevision: current.revision,
      aggregateUpdatedAt: current.updatedAt,
      verifierCodeSha: null,
      verifiedAt: null,
    };
  }
  if (current.revision < receipt.authority.aggregateRevision) {
    return {
      state: "REFUSED",
      code: "METHOD_CANDIDATE_REVISION_REGRESSED",
      detail: `The live aggregate revision ${current.revision} is below adopted revision ${receipt.authority.aggregateRevision}.`,
      aggregateRevision: current.revision,
      aggregateUpdatedAt: current.updatedAt,
      verifierCodeSha: receipt.verifier.codeSha,
      verifiedAt: receipt.finishedAt,
    };
  }
  const lineage = [...seedLineageIssues(current.value)];
  if (current.revision === 1 && storeHash(current.value) !== receipt.authority.canonicalSha256) {
    lineage.push("revision 1 no longer has the canonical bytes the adoption receipt bound");
  }
  if (lineage.length > 0) {
    return {
      state: "REFUSED",
      code: "METHOD_CANDIDATE_ADOPTED_LINEAGE_BROKEN",
      detail: lineage.join("; "),
      aggregateRevision: current.revision,
      aggregateUpdatedAt: current.updatedAt,
      verifierCodeSha: receipt.verifier.codeSha,
      verifiedAt: receipt.finishedAt,
    };
  }
  return {
    state: "ADOPTED",
    code: "METHOD_CANDIDATE_AUTHORITY_ADOPTED",
    detail: "The live lifecycle descends from the exact frozen seed and its clean-code adoption receipt is held in the owner outcome history.",
    aggregateRevision: current.revision,
    aggregateUpdatedAt: current.updatedAt,
    verifierCodeSha: receipt.verifier.codeSha,
    verifiedAt: receipt.finishedAt,
  };
}

/** Admin/read-only projection. Store failure and absence remain distinct. */
export async function readMethodCandidateAuthorityStatus(
  repos: ControlPlaneRepositories,
): Promise<MethodCandidateAuthorityStatus> {
  try {
    const [current, digests] = await Promise.all([
      repos.methodCandidates.read(METHOD_CANDIDATE_STORE_ID),
      repos.ownerDigests.read(DIGEST_LOG_KEY),
    ]);
    return statusFrom(current, digests);
  } catch (error) {
    return {
      state: "STORE_UNREACHABLE",
      code: "METHOD_CANDIDATE_AUTHORITY_STORE_UNREACHABLE",
      detail: `The canonical candidate aggregate or owner outcome history could not be read (${error instanceof Error ? error.name : "error"}); no authority claim was made.`,
      aggregateRevision: null,
      aggregateUpdatedAt: null,
      verifierCodeSha: null,
      verifiedAt: null,
    };
  }
}

function git(root: string, args: readonly string[]): { readonly status: number | null; readonly stdout: string } {
  const result = spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 30_000,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

/** Fresh proof from the checkout at the instant adoption is attempted. */
export function readMethodCandidateAdoptionCodeProof(
  root: string,
  expectedCodeSha: string | null,
): MethodCandidateAdoptionCodeProof {
  const expected = typeof expectedCodeSha === "string" && FULL_SHA.test(expectedCodeSha)
    ? expectedCodeSha.toLowerCase()
    : null;
  const headRead = git(root, ["rev-parse", "HEAD"]);
  const head = headRead.status === 0 && FULL_SHA.test(headRead.stdout.trim())
    ? headRead.stdout.trim().toLowerCase()
    : null;
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const ancestry = head === null ? { status: null } : git(root, ["merge-base", "--is-ancestor", head, "origin/main"]);
  return {
    expectedCodeSha: expected,
    headSha: head,
    headEqualsCodeSha: expected !== null && head === expected,
    cleanTree: status.status === 0 && status.stdout.trim() === "",
    detachedHead: branch.status === 1,
    originMainContainsHead: ancestry.status === 0,
  };
}

function codeProofIssue(proof: MethodCandidateAdoptionCodeProof): string | null {
  if (proof.expectedCodeSha === null) return "the loaded verifier code has no full commit identity";
  if (!proof.headEqualsCodeSha) return `checkout HEAD ${proof.headSha ?? "unknown"} does not equal loaded verifier ${proof.expectedCodeSha}`;
  if (!proof.cleanTree) return "the verifier checkout is dirty";
  if (!proof.detachedHead) return "the verifier checkout is not detached";
  if (!proof.originMainContainsHead) return "the verifier commit is not proven on origin/main";
  return null;
}

/**
 * Adopt the exact existing revision.  No code path here can create or mutate a
 * candidate aggregate.  A moved/unreadable value refuses, preserving it for
 * investigation; only the append-only owner receipt can change.
 */
export async function ensureMethodCandidateAuthorityAdopted(input: {
  readonly repos: ControlPlaneRepositories;
  readonly codeProof: MethodCandidateAdoptionCodeProof;
  readonly now: string;
}): Promise<MethodCandidateAuthorityAdoptionResult> {
  if (!isIsoInstant(input.now)) {
    const status = await readMethodCandidateAuthorityStatus(input.repos);
    return {
      ok: false,
      code: "METHOD_CANDIDATE_ADOPTION_TIME_INVALID",
      detail: "The adoption instant is not a parseable absolute timestamp; no receipt was written.",
      status,
    };
  }
  const proofIssue = codeProofIssue(input.codeProof);
  if (proofIssue !== null) {
    const status = await readMethodCandidateAuthorityStatus(input.repos);
    return { ok: false, code: "METHOD_CANDIDATE_ADOPTION_CODE_UNTRUSTED", detail: proofIssue, status };
  }

  let current: Persisted<CandidateStore> | null;
  let digests: readonly OwnerDigestRecord[];
  try {
    [current, digests] = await Promise.all([
      input.repos.methodCandidates.read(METHOD_CANDIDATE_STORE_ID),
      input.repos.ownerDigests.read(DIGEST_LOG_KEY),
    ]);
  } catch (error) {
    const status = await readMethodCandidateAuthorityStatus(input.repos);
    return {
      ok: false,
      code: "METHOD_CANDIDATE_ADOPTION_STORE_UNREACHABLE",
      detail: `The aggregate or owner history could not be read (${error instanceof Error ? error.name : "error"}).`,
      status,
    };
  }
  const before = statusFrom(current, digests);
  if (before.state === "ADOPTED") {
    const outcome = [...digests]
      .reverse()
      .map((digest) => digest.runtimeOutcome)
      .find(receiptMatchesSeed);
    if (outcome === undefined) {
      return { ok: false, code: "METHOD_CANDIDATE_ADOPTION_RECEIPT_UNREADABLE", detail: before.detail, status: before };
    }
    return { ok: true, adoptedNow: false, outcome, status: before };
  }
  if (before.state !== "UNVERIFIED" || current === null) {
    return { ok: false, code: before.code, detail: before.detail, status: before };
  }
  if (!isIsoInstant(current.updatedAt)) {
    return {
      ok: false,
      code: "METHOD_CANDIDATE_ADOPTION_AGGREGATE_TIME_INVALID",
      detail: "The revision-1 aggregate has no canonical absolute write instant; no receipt was written.",
      status: before,
    };
  }

  const counts = candidateCounts(current.value);
  if (
    counts.PROPOSED !== METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.PROPOSED ||
    counts.VALIDATED !== METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.VALIDATED ||
    counts.ADMITTED !== METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.ADMITTED ||
    counts.REJECTED !== METHOD_CANDIDATE_CUTOVER_SEED.lifecycleCounts.REJECTED
  ) {
    return {
      ok: false,
      code: "METHOD_CANDIDATE_ADOPTION_SEED_COUNTS_MISMATCH",
      detail: "The exact seed hash did not reconcile to its frozen lifecycle denominator; no receipt was written.",
      status: before,
    };
  }
  const codeSha = input.codeProof.expectedCodeSha!;
  const receiptId = `method-candidate-authority-adoption:v1:${codeSha}:${METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256}`;
  const outcome: MethodCandidateAuthorityAdoptionOutcome = {
    kind: "METHOD_CANDIDATE_AUTHORITY_ADOPTION",
    state: "ADOPTED",
    receiptId,
    startedAt: input.now,
    finishedAt: input.now,
    testedSha: codeSha,
    authority: {
      repository: "cp_method_candidates",
      aggregateId: METHOD_CANDIDATE_STORE_ID,
      aggregateRevision: 1,
      aggregateUpdatedAt: current.updatedAt,
      canonicalSha256: METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256,
    },
    seedEvidence: {
      frozenBaseSha: METHOD_CANDIDATE_CUTOVER_SEED.frozenBaseSha,
      trackedSourcePath: METHOD_CANDIDATE_CUTOVER_SEED.trackedSourcePath,
      sourceGitBlobSha1: METHOD_CANDIDATE_CUTOVER_SEED.sourceGitBlobSha1,
      sourceRawSha256: METHOD_CANDIDATE_CUTOVER_SEED.sourceRawSha256,
      canonicalSha256: METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256,
      candidateCount: METHOD_CANDIDATE_CUTOVER_SEED.candidateCount,
      lifecycleCounts: {
        PROPOSED: counts.PROPOSED as 0,
        VALIDATED: counts.VALIDATED as 7,
        ADMITTED: counts.ADMITTED as 0,
        REJECTED: counts.REJECTED as 0,
      },
    },
    verifier: {
      codeSha,
      headEqualsCodeSha: true,
      cleanTree: true,
      detachedHead: true,
      originMainContainsHead: true,
    },
    authorityBoundary: {
      canonicalAuthority: "CONTROL_PLANE_CP_METHOD_CANDIDATES",
      gitRole: "HISTORICAL_SEED_EVIDENCE_ONLY",
      trackedRuntimeReads: 0,
      trackedRuntimeWrites: 0,
    },
  };
  try {
    await appendMethodCandidateAuthorityAdoptionDigest(input.repos, {
      outcome,
      lines: [
        "METHOD-CANDIDATE AUTHORITY ADOPTED — exact frozen seed verified by clean deployed code",
        `cp_method_candidates/${METHOD_CANDIDATE_STORE_ID} revision 1 canonical SHA-256 ${METHOD_CANDIDATE_CUTOVER_SEED.canonicalSha256}`,
        `Verifier ${codeSha} was exact HEAD, clean, detached, and contained by origin/main.`,
        "data/method/candidates.json is historical seed evidence only; runtime reads and writes to that tracked path are zero.",
      ],
    });
  } catch (error) {
    // An uncertain/concurrent append may have committed. Re-read the canonical
    // log and accept only the exact matching adoption receipt.
    const afterUncertain = await readMethodCandidateAuthorityStatus(input.repos);
    if (afterUncertain.state !== "ADOPTED") {
      return {
        ok: false,
        code: "METHOD_CANDIDATE_ADOPTION_RECEIPT_WRITE_FAILED",
        detail: `The exact seed was verified but its canonical owner receipt was not proven durable (${error instanceof Error ? error.name : "error"}).`,
        status: afterUncertain,
      };
    }
  }
  const status = await readMethodCandidateAuthorityStatus(input.repos);
  if (status.state !== "ADOPTED") {
    return { ok: false, code: status.code, detail: status.detail, status };
  }
  return { ok: true, adoptedNow: true, outcome, status };
}
