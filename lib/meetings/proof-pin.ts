import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MEETING_PARTITION_CONTRACTS } from "../civic-data/meeting-partitions.ts";

/**
 * **The Reader proof's meeting pin. It is proof-only and inert in every deployed build.**
 *
 * One full reproof reads the live production meetings projection for hours,
 * and the standing runner promotes routine versions of meeting partitions
 * during that time. Newbury NH partitions arrive in bursts every 1.5 to 2 hours.
 * `scripts/reader-last-mile-render.mts` read the projection at its start, then
 * compared a Newbury listing group, provenance `collectedAt` included, against
 * what `/api/agenda` served later. The comparison was right and the inputs
 * came from two different versions. So every 03255 case failed whenever a
 * partition promoted mid-render.
 *
 * The orchestrator (`scripts/reader-last-mile-full-reproof.sh`) captures every
 * partition's version once (`scripts/reader-proof-meeting-pin.mts`) and names
 * the file in `READER_PROOF_MEETING_PIN`. Every meetings read in that run then
 * resolves each partition to that ONE version: prepare, the executors, the
 * render's own read, and the proof server's `/api/meetings`, `/api/agenda` and
 * Ask reads. The pin chooses WHICH version. Every pinned read is still proven
 * (`readPinnedPromotedCivicDataBatch` → `promotionProofIssue`, GOOD receipts).
 *
 * It also fixes WHEN each version was last checked (schemaVersion 2,
 * 2026-09-25). Since migration 0029 a quiet re-check writes a receipt on the
 * pinned version instead of a new one, and "Last checked" and the re-read rows'
 * `collectedAt` follow the newest receipt (lib/meetings/fresh-checks.ts). A hot
 * body is re-checked about hourly, so an hours-long run saw the check move
 * under the same pinned version. Batch D's first reproof failed on exactly
 * that: prepare served the prepared copy with the receipts it read live
 * (Pima rows at 5:22 PM MST) and the proof server's Ask composed the pinned
 * version, whose pinned read carries no receipt (2:48 PM MST), so 470 of 862
 * meetings-Ask readbacks disagreed on `retrievedAt` alone. The capture now
 * records each version's check, and every pinned read, composing or prepared,
 * applies that check and no other.
 *
 * The switch cannot reach a reader. The pin is refused, and the read stays
 * live, unless ALL of these hold:
 *  - the build is not a deployed build. `next.config.ts` bakes
 *    `WTP_BUILD_ON_NETLIFY` and `WTP_BUILD_DEPLOY_ID` into every build.
 *    Every deployed build is a Netlify build, which bakes them non-empty.
 *  - the process is not a Netlify/Lambda function runtime;
 *  - the Reader proof harness's execution-authority selector is present.
 * `tests/reader-proof-meeting-pin.test.ts` proves each refusal.
 */

export const READER_PROOF_MEETING_PIN_ENV = "READER_PROOF_MEETING_PIN";
/** The harness marker: the orchestrator exports it for every proof process and the proof server. */
export const READER_PROOF_HARNESS_ENV = "READER_EXECUTION_AUTHORITY_EVIDENCE";

export interface ReaderProofMeetingPinPartition {
  readonly contractId: string;
  readonly scope: string;
  readonly kind: "PROMOTED" | "NOT_RECORDED";
  readonly versionId: string | null;
  /**
   * The capture's newest successful fresh check of this version
   * (`MeetingPartitionFreshCheck.checkedAt`), or null when it had none. Every
   * pinned read applies exactly this check. Always null for NOT_RECORDED.
   */
  readonly checkedAt: string | null;
}

export interface ReaderProofMeetingPin {
  readonly schemaVersion: 2;
  readonly kind: "READER_PROOF_MEETING_PIN";
  readonly capturedAt: string;
  /** Exactly one row per registered meeting partition contract, in registry order. */
  readonly partitions: readonly ReaderProofMeetingPinPartition[];
  /** sha256 of the canonical partition rows; a hand-edited pin is refused. */
  readonly partitionsSha256: string;
}

export type ReaderProofMeetingPinAdmission =
  | { readonly state: "ABSENT" }
  | { readonly state: "REFUSED"; readonly reason: string }
  | { readonly state: "ADMITTED"; readonly path: string };

/**
 * Build-time markers, read as the literal `process.env.<NAME>` so that Next
 * substitutes the value baked by `next.config.ts` `env` into the server
 * bundle. A runtime env var cannot unset a value baked into the bundle.
 */
function deployedBuildMarkers(): readonly string[] {
  return [
    process.env.WTP_BUILD_ON_NETLIFY ?? "",
    process.env.WTP_BUILD_DEPLOY_ID ?? "",
  ];
}

export function readerProofMeetingPinAdmission(
  env: Readonly<Record<string, string | undefined>> = process.env,
  buildMarkers: readonly string[] = deployedBuildMarkers(),
): ReaderProofMeetingPinAdmission {
  const path = env[READER_PROOF_MEETING_PIN_ENV]?.trim();
  if (!path) return { state: "ABSENT" };
  if (buildMarkers.some((marker) => marker.trim() !== "")) {
    return { state: "REFUSED", reason: "a deployed (Netlify) build never admits the Reader proof meeting pin" };
  }
  for (const runtime of ["NETLIFY", "NETLIFY_BLOBS_CONTEXT", "AWS_LAMBDA_FUNCTION_NAME", "LAMBDA_TASK_ROOT"]) {
    if (env[runtime]?.trim()) {
      return { state: "REFUSED", reason: `a function runtime (${runtime}) never admits the Reader proof meeting pin` };
    }
  }
  if (!env[READER_PROOF_HARNESS_ENV]?.trim()) {
    return { state: "REFUSED", reason: `the Reader proof meeting pin is admitted only inside the proof harness (${READER_PROOF_HARNESS_ENV})` };
  }
  return { state: "ADMITTED", path };
}

function canonicalPartitions(partitions: readonly ReaderProofMeetingPinPartition[]): string {
  return JSON.stringify(partitions.map(({ contractId, scope, kind, versionId, checkedAt }) => ({ contractId, scope, kind, versionId, checkedAt })));
}

/**
 * The check a pinned read applies to one partition version: the capture's, and
 * only for the exact version the pin names. Null for any other version, which
 * a pinned read never serves anyway.
 */
export function readerProofPinnedCheckedAt(pin: ReaderProofMeetingPin, contractId: string, versionId: string | null | undefined): string | null {
  const row = pin.partitions.find((partition) => partition.contractId === contractId);
  return row?.kind === "PROMOTED" && versionId && row.versionId === versionId ? row.checkedAt : null;
}

export function readerProofMeetingPinSha256(partitions: readonly ReaderProofMeetingPinPartition[]): string {
  return createHash("sha256").update(canonicalPartitions(partitions)).digest("hex");
}

/**
 * Build the pin from a fully proven, unpinned partition readback (the capture).
 *
 * A registered successor served from its retired predecessor's HELD version
 * (`HELD_MEETING_PARTITIONS`, lib/civic-data/meeting-partitions.ts) reads back
 * NOT_RECORDED with `heldFrom`, and is pinned NOT_RECORDED: the pin selects
 * registered partitions' versions, and the held pointer is not one. The pinned
 * run still composes exactly the held version the capture composed — the
 * successor stays NOT_RECORDED under the pin even if the runner promotes it
 * mid-run, and the retired route has no contract, clock or writer, so its
 * pointer cannot move. A prepared serving copy coupled to a held version never
 * equals the pin's PROMOTED rows, so while a succession is held the pinned run
 * reads through the composing reader, which reads the pinned versions.
 */
export function readerProofMeetingPinFromReadback(
  partitions: readonly {
    readonly contractId: string;
    readonly scope: string;
    readonly kind: string;
    readonly versionId: string | null;
    readonly freshCheck?: { readonly checkedAt: string | null };
  }[],
  capturedAt: string,
): ReaderProofMeetingPin {
  const rows: ReaderProofMeetingPinPartition[] = MEETING_PARTITION_CONTRACTS.map((contract) => {
    const matches = partitions.filter((row) => row.contractId === contract.id);
    const row = matches[0];
    if (matches.length !== 1 || !row || row.scope !== contract.scope) {
      throw new Error(`READER_PROOF_MEETING_PIN_CAPTURE_INVALID:${contract.id} is missing, duplicated or mis-scoped in the readback.`);
    }
    if (row.kind === "PROMOTED" && typeof row.versionId === "string" && row.versionId) {
      const checkedAt = row.freshCheck?.checkedAt ?? null;
      if (checkedAt !== null && !Number.isFinite(Date.parse(checkedAt))) {
        throw new Error(`READER_PROOF_MEETING_PIN_CAPTURE_INVALID:${contract.id}'s fresh check is not an instant.`);
      }
      return { contractId: contract.id, scope: contract.scope, kind: "PROMOTED", versionId: row.versionId, checkedAt };
    }
    if (row.kind === "NOT_RECORDED" && row.versionId === null) {
      return { contractId: contract.id, scope: contract.scope, kind: "NOT_RECORDED", versionId: null, checkedAt: null };
    }
    throw new Error(`READER_PROOF_MEETING_PIN_CAPTURE_INVALID:${contract.id} is ${row.kind}; only a proven PROMOTED or answered NOT_RECORDED partition can be pinned.`);
  });
  if (partitions.length !== rows.length) {
    throw new Error("READER_PROOF_MEETING_PIN_CAPTURE_INVALID: the readback names an unregistered partition.");
  }
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("READER_PROOF_MEETING_PIN_CAPTURE_INVALID: capturedAt is not an instant.");
  return {
    schemaVersion: 2,
    kind: "READER_PROOF_MEETING_PIN",
    capturedAt,
    partitions: rows,
    partitionsSha256: readerProofMeetingPinSha256(rows),
  };
}

/** Validate a pin exactly; anything else is refused loudly, never read as "no pin". */
export function parseReaderProofMeetingPin(value: unknown): ReaderProofMeetingPin {
  const pin = value as Partial<ReaderProofMeetingPin> | null;
  if (!pin || typeof pin !== "object" || pin.schemaVersion !== 2 || pin.kind !== "READER_PROOF_MEETING_PIN") {
    throw new Error("READER_PROOF_MEETING_PIN_INVALID: not a schemaVersion 2 Reader proof meeting pin.");
  }
  if (typeof pin.capturedAt !== "string" || !Number.isFinite(Date.parse(pin.capturedAt))) {
    throw new Error("READER_PROOF_MEETING_PIN_INVALID: capturedAt is not an instant.");
  }
  const partitions = Array.isArray(pin.partitions) ? pin.partitions : [];
  if (partitions.length !== MEETING_PARTITION_CONTRACTS.length) {
    throw new Error("READER_PROOF_MEETING_PIN_INVALID: the pin does not cover the registered partition denominator.");
  }
  MEETING_PARTITION_CONTRACTS.forEach((contract, index) => {
    const row = partitions[index];
    if (!row || row.contractId !== contract.id || row.scope !== contract.scope) {
      throw new Error(`READER_PROOF_MEETING_PIN_INVALID: row ${index} is not ${contract.id}.`);
    }
    const valid = row.kind === "PROMOTED"
      ? typeof row.versionId === "string" && row.versionId.length > 0 &&
        (row.checkedAt === null || (typeof row.checkedAt === "string" && Number.isFinite(Date.parse(row.checkedAt))))
      : row.kind === "NOT_RECORDED" && row.versionId === null && row.checkedAt === null;
    if (!valid) throw new Error(`READER_PROOF_MEETING_PIN_INVALID: ${contract.id} has an invalid disposition.`);
  });
  if (pin.partitionsSha256 !== readerProofMeetingPinSha256(partitions)) {
    throw new Error("READER_PROOF_MEETING_PIN_INVALID: partitionsSha256 does not match the partition rows.");
  }
  return pin as ReaderProofMeetingPin;
}

let loaded: { readonly path: string; readonly pin: ReaderProofMeetingPin } | null = null;
let refusalReported: string | null = null;

/**
 * The pin this process must read under, or null for the ordinary live read.
 * An admitted pin that cannot be read or validated throws. The harness asked
 * for one version per partition, and serving live data instead would bring back
 * the mixed-version comparison this pin exists to prevent.
 */
export function activeReaderProofMeetingPin(
  env: Readonly<Record<string, string | undefined>> = process.env,
  buildMarkers: readonly string[] = deployedBuildMarkers(),
): ReaderProofMeetingPin | null {
  const admission = readerProofMeetingPinAdmission(env, buildMarkers);
  if (admission.state === "ABSENT") return null;
  if (admission.state === "REFUSED") {
    if (refusalReported !== admission.reason) {
      refusalReported = admission.reason;
      console.error(`[reader-proof] ${READER_PROOF_MEETING_PIN_ENV} refused: ${admission.reason}; meetings read live.`);
    }
    return null;
  }
  if (loaded?.path === admission.path) return loaded.pin;
  // The pin path is runtime-computed on purpose (the harness names it). Without
  // the ignore marks, Turbopack traces the whole project into every route that
  // reads meetings: /api/ask/grounded traced 7,278 files against a ceiling of
  // 310 (the R23 shape). A deployed build never admits a pin anyway.
  const pinPath = resolve(/* turbopackIgnore: true */ admission.path);
  const pin = parseReaderProofMeetingPin(
    JSON.parse(readFileSync(/* turbopackIgnore: true */ pinPath, "utf8")) as unknown,
  );
  loaded = { path: admission.path, pin };
  return pin;
}
