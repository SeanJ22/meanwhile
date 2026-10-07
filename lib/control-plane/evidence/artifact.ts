/**
 * What an Artifact is: the durable, content-addressed record of one retrieval,
 * the unit a replay re-runs and an audit points at.
 *
 * A retrieval whose body carries a confirmed third-party credential is
 * `RESTRICTED_RAW`: stored exactly, restricted retention, readable only by roles
 * allowed to see credential material. Every downstream consumer reads the
 * `SANITIZED_DERIVED` artifact instead, linked by hash. `deriveSanitized` is the
 * only way to get a parseable body from one, and `store.ts` refuses the raw to a
 * parser by name.
 *
 * No credential value crosses this boundary: only the class id, twelve-hex
 * fingerprint, length, line and occurrence count.
 *
 * Redaction is `sanitizeText` from `lib/ops/fixture-credentials.ts`; this file
 * records which `SANITIZER_VERSION` produced each derivative.
 *
 * No function here reads a clock.
 */

import { createHash } from "node:crypto";

import {
  SANITIZER_VERSION,
  credentials,
  sanitizeText,
  scanText,
  type CredentialFinding,
} from "../../ops/fixture-credentials.ts";
import type { PermissionState, TransportState } from "../../workstate/types.ts";
import { contentHash, fingerprint } from "../ids.ts";

/** The default digest for the credential scanner, which takes it as a parameter. */
export const sha256Hex = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

/** ------------------------------------------------------------------ tiers */

/** What a stored body is, decided by scanning the bytes at acquisition, never by the source's reputation. */
export const ARTIFACT_TIERS = [
  /** Exact retrieved bytes, carrying no known credential class. Freely readable. */
  "RAW",
  /**
   * Exact retrieved bytes that DO carry a confirmed third-party credential.
   * Quarantined. A sanitized derivative is mandatory and is what parsers read.
   */
  "RESTRICTED_RAW",
  /** A derivative produced by the shipped sanitizer from a specific raw artifact. */
  "SANITIZED_DERIVED",
  /** Machine transcription of retained document bytes; never original publisher bytes. */
  "EXTRACTED_DERIVED",
] as const;
export type ArtifactTier = (typeof ARTIFACT_TIERS)[number];

/** How long the vault keeps a body. Stated per artifact: a licence can shorten what the tier would allow. */
export const RETENTION_POLICIES = [
  /** Evidence for a published claim. Kept while the claim stands. */
  "EVIDENCE_PERMANENT",
  /** Credential-bearing bytes. Kept only as long as the derivation needs proving. */
  "RESTRICTED_SHORT",
  /** A licence or terms-of-use constrains how long the body may be held. */
  "LICENCE_LIMITED",
  /** Diagnostic capture — a wall, a challenge page, a failed parse. */
  "DIAGNOSTIC",
] as const;
export type RetentionPolicy = (typeof RETENTION_POLICIES)[number];

/** The default retention for a tier, when the caller states none. */
export function defaultRetention(tier: ArtifactTier): RetentionPolicy {
  return tier === "RESTRICTED_RAW" ? "RESTRICTED_SHORT" : "EVIDENCE_PERMANENT";
}

/** ------------------------------------------------------------- artifacts */

/**
 * Links a raw artifact to its sanitized derivative. Both hashes are recorded
 * and must differ. `fingerprints` and `redactionsByClass` are comparable
 * across runs and not invertible.
 */
export interface ArtifactDerivation {
  readonly rawArtifactId: string;
  readonly derivedArtifactId: string;
  /** Which rule set produced this. A rule-set change is a version change. */
  readonly sanitizerVersion: string;
  /** classId -> replaced occurrences. */
  readonly redactionsByClass: Readonly<Record<string, number>>;
  /** How many DISTINCT values were replaced. */
  readonly distinctValuesRedacted: number;
  /** How many substrings were replaced — the sum over occurrences. */
  readonly substringsReplaced: number;
  /** Fingerprints of the redacted values, sorted. Never the values. */
  readonly fingerprints: readonly string[];
  /** `sha256-…` of the input bytes. */
  readonly rawHash: string;
  /** `sha256-…` of the output bytes. Differs from `rawHash` whenever anything was replaced. */
  readonly derivedHash: string;
  /** Matches the scanner deliberately did not treat as credentials, with the reason. */
  readonly preserved: readonly CredentialFinding[];
  readonly derivedAt: string;
}

/**
 * One retrieval, durably recorded. `sourceId`, `methodRouteId`, `workItemId`
 * and `attemptId` walk a claim back to its obligation and execution.
 * `permission` and `transport` are separate: failing to fetch robots.txt is
 * never "robots disallows this host".
 */
export interface Artifact {
  readonly id: string;
  readonly tier: ArtifactTier;
  /** `sha256-<hex>` of the stored bytes. The vault key is derived from it. */
  readonly contentHash: string;
  readonly byteLength: number;
  /** As served, or as the retriever determined. Not guessed from the extension. */
  readonly contentType: string;
  /** The stable public address of the record — what a citation points at. */
  readonly canonicalUrl: string;
  /** The URL actually fetched: a redirect target, a mirror, a print view. */
  readonly retrievalUrl: string;
  readonly retrievedAt: string;
  readonly httpStatus: number;
  /** Response headers, as received. Request headers are never stored here. */
  readonly headers: Readonly<Record<string, string>>;
  readonly sourceId: string;
  /** The `lib/method` route this retrieval walked. */
  readonly methodRouteId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  /** MAY we read this host. Never a transport reading. */
  readonly permission: PermissionState;
  /** What happened when we tried. Never a permission verdict. */
  readonly transport: TransportState;
  readonly retentionPolicy: RetentionPolicy;
  /** Present exactly on `SANITIZED_DERIVED` artifacts. */
  readonly derivation?: ArtifactDerivation;
  /** Exact retained input and procedure for an unverified document transcription. */
  readonly extraction?: {
    readonly kind: "PDF_TEXT" | "PDF_TABLES";
    readonly version: string;
    readonly complete: boolean;
    readonly pages: number;
    readonly parent: Artifact;
  };
}

/** A derived artifact id: content address plus tier, so a raw and its sanitized body are different objects. */
export function artifactId(tier: ArtifactTier, hash: string): string {
  return `ar-${fingerprint([tier, hash])}`;
}

/** Structural refusals — an artifact that cannot be what it says it is. */
export class ArtifactContract extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactContract";
  }
}

/**
 * A quarantined body was requested by something that may not have it. Thrown
 * by name so "you may not read this" is distinct from "this does not exist".
 * The message never names a credential, class or fingerprint.
 */
export class RestrictedArtifactRefused extends Error {
  readonly artifactId: string;
  readonly role: string;
  readonly sanitizedDerivativeId: string | null;

  constructor(id: string, role: string, sanitizedDerivativeId: string | null) {
    super(
      `Artifact ${id} is RESTRICTED_RAW and role ${role} may not read it. ` +
        (sanitizedDerivativeId
          ? `Read the sanitized derivative ${sanitizedDerivativeId} instead.`
          : "No sanitized derivative exists yet; derive one with deriveSanitized()."),
    );
    this.name = "RestrictedArtifactRefused";
    this.artifactId = id;
    this.role = role;
    this.sanitizedDerivativeId = sanitizedDerivativeId;
  }
}

/** --------------------------------------------------- acquisition triage */

/** What a scan of the acquired bytes decided. `findings` carries unconfirmed matches too, with why. */
export interface AcquisitionClassification {
  readonly tier: "RAW" | "RESTRICTED_RAW";
  /** True when a sanitized derivative must exist before any parser reads this. */
  readonly sanitizedDerivativeRequired: boolean;
  /** Every match, confirmed or not. Values never carried. */
  readonly findings: readonly CredentialFinding[];
  /** The confirmed subset — what forces the restriction. */
  readonly confirmed: readonly CredentialFinding[];
  readonly sanitizerVersion: string;
}

/**
 * Decide the tier from the bytes with the shipped scanner. One confirmed
 * finding is enough. A `RAW` verdict is a claim about the known classes only.
 */
export function classifyAcquisition(
  text: string,
  digest: (input: string) => string = sha256Hex,
): AcquisitionClassification {
  const findings = scanText(text, digest);
  const confirmed = credentials(findings);
  return {
    tier: confirmed.length > 0 ? "RESTRICTED_RAW" : "RAW",
    sanitizedDerivativeRequired: confirmed.length > 0,
    findings,
    confirmed,
    sanitizerVersion: SANITIZER_VERSION,
  };
}

/** ------------------------------------------------------- raw artifacts */

export interface AcquisitionInput {
  readonly canonicalUrl: string;
  readonly retrievalUrl?: string;
  readonly retrievedAt: string;
  readonly httpStatus: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contentType: string;
  readonly sourceId: string;
  readonly methodRouteId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly permission: PermissionState;
  readonly transport: TransportState;
  readonly retentionPolicy?: RetentionPolicy;
}

/** Build the raw-side artifact for a text retrieval, tier decided by scanning. Binary bodies do not come through here. */
export function recordAcquisition(
  input: AcquisitionInput,
  body: string,
  digest: (input: string) => string = sha256Hex,
): { artifact: Artifact; classification: AcquisitionClassification } {
  const classification = classifyAcquisition(body, digest);
  const hash = contentHash(body);
  const artifact: Artifact = {
    id: artifactId(classification.tier, hash),
    tier: classification.tier,
    contentHash: hash,
    byteLength: Buffer.byteLength(body, "utf8"),
    contentType: input.contentType,
    canonicalUrl: input.canonicalUrl,
    retrievalUrl: input.retrievalUrl ?? input.canonicalUrl,
    retrievedAt: input.retrievedAt,
    httpStatus: input.httpStatus,
    headers: { ...(input.headers ?? {}) },
    sourceId: input.sourceId,
    methodRouteId: input.methodRouteId,
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    permission: input.permission,
    transport: input.transport,
    retentionPolicy: input.retentionPolicy ?? defaultRetention(classification.tier),
  };
  return { artifact, classification };
}

/** --------------------------------------------------------- derivation */

/**
 * Produce the sanitized derivative and its derivation record. Refuses when the
 * bytes do not hash to the claimed artifact, when the input is itself a
 * derivative, and when a `RESTRICTED_RAW` input produces an identical body.
 * The derivative inherits the raw's provenance, not its tier or retention.
 */
export function deriveSanitized(
  raw: Artifact,
  body: string,
  now: string,
  digest: (input: string) => string = sha256Hex,
): { artifact: Artifact; derivation: ArtifactDerivation; text: string } {
  if (raw.tier === "SANITIZED_DERIVED") {
    throw new ArtifactContract(
      `Artifact ${raw.id} is already SANITIZED_DERIVED. Deriving from a derivative ` +
        "would name it as the raw and break the chain back to the served bytes.",
    );
  }

  const rawHash = contentHash(body);
  if (rawHash !== raw.contentHash) {
    throw new ArtifactContract(
      `The bytes handed to deriveSanitized hash to ${rawHash}, not to artifact ` +
        `${raw.id}'s recorded ${raw.contentHash}. A derivation from unverified bytes ` +
        "records provenance it does not have.",
    );
  }

  const { text, redactions, preserved, replaced } = sanitizeText(body, digest);
  const derivedHash = contentHash(text);

  if (raw.tier === "RESTRICTED_RAW" && derivedHash === rawHash) {
    throw new ArtifactContract(
      `Artifact ${raw.id} is RESTRICTED_RAW and sanitizing it replaced nothing — ` +
        "the derivative would be the quarantined bytes under a readable label.",
    );
  }

  const redactionsByClass: Record<string, number> = {};
  for (const r of redactions) {
    redactionsByClass[r.classId] = (redactionsByClass[r.classId] ?? 0) + r.occurrences;
  }

  const derivedId = artifactId("SANITIZED_DERIVED", derivedHash);
  const derivation: ArtifactDerivation = {
    rawArtifactId: raw.id,
    derivedArtifactId: derivedId,
    sanitizerVersion: SANITIZER_VERSION,
    redactionsByClass,
    distinctValuesRedacted: redactions.length,
    substringsReplaced: replaced,
    fingerprints: redactions.map((r) => r.fingerprint).sort(),
    rawHash,
    derivedHash,
    preserved,
    derivedAt: now,
  };

  const artifact: Artifact = {
    ...raw,
    id: derivedId,
    tier: "SANITIZED_DERIVED",
    contentHash: derivedHash,
    byteLength: Buffer.byteLength(text, "utf8"),
    retentionPolicy: "EVIDENCE_PERMANENT",
    derivation,
  };

  return { artifact, derivation, text };
}

/** The body a parser is entitled to for this artifact; null means look for the derivative. */
export function parserMayRead(artifact: Artifact): boolean {
  return artifact.tier !== "RESTRICTED_RAW";
}
