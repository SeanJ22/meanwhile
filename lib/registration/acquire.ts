/** Versioned Census releases, reused across state jobs before network access. */
import { join } from "node:path";
import { acquireKnownRelease, knownReleaseSourceCheck, type KnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import type { SourceCheckEvidence } from "../civic-data/types.ts";
import { sourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { indexVault, readHeldBytes, READ_ONLY_VAULT_PROJECT } from "../control-plane/evidence/read-only-vault.ts";
import { VAULT_DIR } from "../control-plane/scheduler/vault.ts";
import { REGISTRATION_PARSER_VERSION, REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, REGISTRATION_SOURCE_LAST_MODIFIED } from "./publication.ts";
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
  readonly release?: KnownRelease;
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
    retrievedAt: "2026-09-23T00:00:00.000Z", sha256: REGISTRATION_SOURCE_SHA256, bytes: REGISTRATION_SOURCE_BYTES, confirmedBy: "HELD_RELEASE",
    sourceCheck: { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL, httpStatus: 200,
      rawHash: REGISTRATION_SOURCE_SHA256, checkedAt: "2026-09-23T00:00:00.000Z" } };
}

async function heldRelease(signal: AbortSignal): Promise<KnownRelease | null> {
  const index = await indexVault(join(process.cwd(), ...VAULT_DIR), `${READ_ONLY_VAULT_PROJECT}/source/census-governments-registration`, { signal });
  const source = [...index.byHash.values()].filter(row => row.canonicalUrl === REGISTRATION_SOURCE_URL && (row.httpStatus === undefined || row.httpStatus === 200) && row.retrievedAt && row.tier !== "RESTRICTED_RAW")
    .sort((a, b) => (b.retrievedAt ?? "").localeCompare(a.retrievedAt ?? ""))[0];
  if (!source?.retrievedAt) return null;
  const bytes = await readHeldBytes(source, signal);
  return { sourceId: "census-governments-registration", releaseId: "cog-2022", bytes,
    sha256: source.contentHash.replace(/^sha256-/, ""), requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: source.retrievalUrl ?? REGISTRATION_SOURCE_URL,
    httpStatus: source.httpStatus ?? 200, retrievedAt: source.retrievedAt, sourceObservedAt: source.retrievedAt, checkedAt: source.retrievedAt,
    lastCheckStatus: source.httpStatus ?? 200, etag: null, lastModified: source.contentHash === `sha256-${REGISTRATION_SOURCE_SHA256}` ? REGISTRATION_SOURCE_LAST_MODIFIED : null,
    contentType: source.contentType, reused: true };
}

export async function acquireRegistrationSource(options: {
  readonly signal: AbortSignal; readonly fetchImpl?: typeof fetch; readonly now?: () => Date;
  readonly store?: KnownReleaseOptions["store"]; readonly locks?: KnownReleaseOptions["locks"];
  readonly readHeld?: KnownReleaseOptions["readHeld"];
}): Promise<RegistrationSourceReceipt> {
  try {
    const release = await acquireKnownRelease({
      sourceId: "census-governments-registration", releaseId: "cog-2022", url: REGISTRATION_SOURCE_URL,
      parserVersion: REGISTRATION_PARSER_VERSION, signal: options.signal, maxBytes: 64 * 1024 * 1024, checkAfterMs: 90 * 24 * 60 * 60 * 1000,
      fetchImpl: options.fetchImpl, now: options.now ? () => options.now!().toISOString() : undefined,
      store: options.store, locks: options.locks, readHeld: options.readHeld ?? (() => heldRelease(options.signal)),
      validate: validateGovernmentRelease,
    });
    return { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus,
      retrievedAt: release.sourceObservedAt, sha256: release.sha256, bytes: release.bytes.byteLength,
      confirmedBy: release.reused ? "HELD_RELEASE" : "BYTES_HASHED", checkedAt: release.checkedAt,
      sourceCheck: knownReleaseSourceCheck(release), release };
  } catch (error) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `Census government release could not be acquired or decoded: ${error instanceof Error ? error.message : String(error)}`);
  }
}
