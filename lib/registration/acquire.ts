/** Versioned Census releases, reused across state jobs before network access. */
import { knownReleaseSourceCheck } from "../sources/known-release.ts";
import { acquireKnownReleaseFile, KnownReleaseFileUnavailable, type KnownReleaseFile, type KnownReleaseFileOptions } from "../sources/known-release-file.ts";
import type { SourceCheckEvidence } from "../civic-data/types.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { REGISTRATION_PARSER_VERSION, REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, REGISTRATION_HELD_RETRIEVED_AT } from "./publication.ts";
import { validateGovernmentRelease } from "./source-reference.ts";

export interface RegistrationSourceReceipt {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly retrievedAt: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly confirmedBy: "BYTES_HASHED" | "HELD_RELEASE";
  readonly checkedAt?: string;
  readonly sourceCheck?: SourceCheckEvidence;
  /** Exact prior GOOD whose later check attested these same held source bytes. */
  readonly replayedFromVersionId?: string;
  readonly release?: KnownReleaseFile;
}

/** A combined inventory retains its oldest real provider check, never its replay time. */
export function registrationSourceCheck(receipt: RegistrationSourceReceipt, additional: readonly SourceCheckEvidence[] = []): SourceCheckEvidence {
  const check = receipt.sourceCheck ?? (receipt.release ? knownReleaseSourceCheck(receipt.release) : {
    requestedUrl: receipt.requestedUrl, finalUrl: receipt.finalUrl, httpStatus: 200 as const,
    rawHash: receipt.sha256, checkedAt: receipt.retrievedAt,
  });
  return [check, ...additional].reduce((oldest, next) => Date.parse(next.checkedAt) < Date.parse(oldest.checkedAt) ? next : oldest);
}

/** The saved source attestation belongs to September 23, not today's replay. */
export function heldRegistrationReceipt(): RegistrationSourceReceipt {
  return { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL, httpStatus: 200,
    retrievedAt: REGISTRATION_HELD_RETRIEVED_AT, sha256: REGISTRATION_SOURCE_SHA256, bytes: REGISTRATION_SOURCE_BYTES, confirmedBy: "HELD_RELEASE",
    sourceCheck: { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL, httpStatus: 200,
      rawHash: REGISTRATION_SOURCE_SHA256, checkedAt: REGISTRATION_HELD_RETRIEVED_AT } };
}

export async function acquireRegistrationSource(options: {
  readonly signal: AbortSignal; readonly fetchImpl?: typeof fetch; readonly now?: () => Date;
  readonly store?: KnownReleaseFileOptions["store"]; readonly locks?: KnownReleaseFileOptions["locks"];
  readonly readHeld?: KnownReleaseFileOptions["readHeld"];
}): Promise<RegistrationSourceReceipt> {
  try {
    const release = await acquireKnownReleaseFile({
      sourceId: "census-governments-registration", releaseId: "cog-2022", url: REGISTRATION_SOURCE_URL,
      parserVersion: REGISTRATION_PARSER_VERSION, signal: options.signal, maxBytes: 64 * 1024 * 1024, checkAfterMs: 90 * 24 * 60 * 60 * 1000,
      fetchImpl: options.fetchImpl, now: options.now ? () => options.now!().toISOString() : undefined,
      store: options.store, locks: options.locks, readHeld: options.readHeld,
      validate: validateGovernmentRelease,
    });
    return { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus,
      retrievedAt: release.sourceObservedAt, sha256: release.sha256, bytes: release.byteLength,
      confirmedBy: release.reused ? "HELD_RELEASE" : "BYTES_HASHED", checkedAt: release.checkedAt,
      sourceCheck: knownReleaseSourceCheck(release), release };
  } catch (error) {
    if (error instanceof KnownReleaseFileUnavailable) await error.held.dispose();
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census government release could not be acquired or decoded: ${error instanceof Error ? error.message : String(error)}`);
  }
}
