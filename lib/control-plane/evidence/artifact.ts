/**
 * THE EVIDENCE PLANE, PART ONE — WHAT AN ARTIFACT IS.
 *
 * ## The gap this closes
 *
 * Today the project acquires bytes, hashes them, extracts what a parser wants,
 * stamps the rung and the attribution, and then **discards the bytes**. The only
 * durable publisher bytes anywhere in the repository are 73 sanitized test
 * fixtures. That means:
 *
 *   - a parse cannot be re-run against what was actually served, only against
 *     what someone happened to keep;
 *   - a disputed claim about a government cannot be answered with "here is the
 *     page we read", only with "here is a hash of a page we no longer have";
 *   - a parser bug found in September cannot be replayed over August's
 *     retrievals, so every fix silently re-opens every prior conclusion and
 *     nobody can tell which ones actually changed.
 *
 * An Artifact is the durable, content-addressed record of one retrieval. It is
 * the unit the replay gate re-runs and the unit an audit points at.
 *
 * ## WHY THERE ARE THREE TIERS AND NOT ONE
 *
 * PR #217 is the reason. `tests/fixtures/legistar-insite-pima-clerk-schedule.html`
 * was a byte-for-byte capture of a public county page, and the PUBLISHER's own
 * bootstrap JSON carried a live Google Maps browser key and a thirty-day bearer
 * token. Nobody pasted anything. Keeping the bytes made this repository a mirror
 * of a third party's live credential.
 *
 * The naive readings of that incident are both wrong:
 *
 *   - "keep nothing" throws away the evidence, which is the product;
 *   - "sanitize everything and keep only that" throws away the ability to prove
 *     what the server actually sent, and quietly makes every artifact a claim
 *     about our redactor rather than about the publisher.
 *
 * So the bytes are kept AND they are quarantined. A retrieval whose body carries
 * a CONFIRMED third-party credential is `RESTRICTED_RAW`: stored exactly, with a
 * restricted retention policy, readable only by roles that are allowed to see
 * credential material at all. Every consumer downstream — every parser, every
 * extractor, every summarizer, every log line — reads the `SANITIZED_DERIVED`
 * artifact instead, and the derivation record links the two by hash so the
 * substitution is provable rather than assumed.
 *
 * **A sanitized derivative is MANDATORY for a `RESTRICTED_RAW` artifact.** That
 * is not a convention; `deriveSanitized` is the only way to obtain a parseable
 * body from one, and `lib/control-plane/evidence/store.ts` refuses the raw to a
 * parser by name.
 *
 * ## NO CREDENTIAL VALUE CROSSES THIS BOUNDARY
 *
 * RULING 127. Nothing in an `Artifact`, an `ArtifactDerivation`, an error
 * message, or anything either of them is serialized into carries a matched
 * value. What is carried is the class id, the twelve-hex fingerprint, the
 * length, the line and the occurrence count — enough for a reader to confirm a
 * redaction happened and to compare two runs, and not enough to reconstruct
 * anything.
 *
 * ## ONE SANITIZER, NOT TWO
 *
 * The redaction here is `sanitizeText` from `lib/ops/fixture-credentials.ts`,
 * imported and called. A second scanner living in the control plane would drift
 * from the first within a month and the divergence would show up as a fixture
 * that passes one gate and fails the other. The class list, the two-stage
 * confirm predicate and `SANITIZER_VERSION` are that module's to own; this file
 * records WHICH version produced a given derivative so a rule-set change is
 * visible as a version change rather than as a mysterious hash difference.
 *
 * ## TIME IS A PARAMETER
 *
 * No function here reads a clock. The reproducibility gate re-runs immutable
 * inputs and compares identities; a library that reaches for `Date.now()`
 * cannot be replayed, and a replay that fails for a reason unrelated to truth
 * teaches everyone to ignore the gate.
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

/**
 * WHAT A STORED BODY IS, AND THEREFORE WHO MAY READ IT.
 *
 * The tier is a fact about the BYTES, decided at acquisition by scanning them.
 * It is never a fact about the source's reputation, the route, or how careful
 * the retrieving session felt. A trusted publisher emits a live key exactly as
 * readily as an untrusted one — that is precisely what happened in PR #217.
 */
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
] as const;
export type ArtifactTier = (typeof ARTIFACT_TIERS)[number];

/**
 * How long the vault keeps a body, and why.
 *
 * Retention is stated per artifact rather than inferred from the tier, because
 * the two answer different questions and a licence can shorten a retention that
 * the tier would happily leave permanent.
 */
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
 * The link between a `RESTRICTED_RAW` (or `RAW`) artifact and the sanitized
 * derivative made from it.
 *
 * **Both hashes are recorded and they must differ**, which is the whole point:
 * a derivation whose output hashes to its input redacted nothing, and a record
 * that cannot tell those apart is a record that lets a leak through wearing a
 * "sanitized" label.
 *
 * **Nothing here is a credential value.** `fingerprints` are the twelve-hex
 * prefixes `lib/ops/fixture-credentials.ts` produces; `redactionsByClass` counts
 * occurrences per class id. Both are comparable across runs and neither is
 * invertible.
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
  /**
   * Matches the scanner saw and deliberately did NOT treat as credentials, with
   * the reason. Nothing is set aside silently — a scanner that quietly drops
   * matches is indistinguishable from one that never looked.
   */
  readonly preserved: readonly CredentialFinding[];
  readonly derivedAt: string;
}

/**
 * ONE RETRIEVAL, DURABLY RECORDED.
 *
 * Provenance is not optional and is not a comment. `sourceId`, `methodRouteId`,
 * `workItemId` and `attemptId` are what let a claim be walked back to the
 * obligation it answers and the physical execution that produced it, and what
 * let a parser fix be replayed over exactly the retrievals it would have
 * changed.
 *
 * `permission` and `transport` are carried SEPARATELY and are imported from
 * `lib/workstate/types.ts` rather than re-declared. RULING 182: "could not fetch
 * robots.txt with this client" is never "robots disallows this host", and an
 * artifact that collapsed the two would launder a transport failure into a
 * permission verdict every time it was read back.
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
}

/**
 * A derived, deterministic artifact id.
 *
 * Content address plus tier, and the tier belongs in it: the same bytes stored
 * as `RESTRICTED_RAW` and the sanitized body made from them are two different
 * objects with two different readerships, and an id that could not tell them
 * apart would let a store lookup hand a parser the quarantined body.
 */
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
 * A quarantined body was requested by something that may not have it.
 *
 * Thrown BY NAME so a caller can distinguish "you may not read this" from "this
 * does not exist" — the second is a claim about the record and the first is a
 * claim about the reader, and collapsing them is how a policy refusal becomes a
 * missing document.
 *
 * The message names the artifact, the role and the derivative that IS readable.
 * It never names a credential, a class, or a fingerprint: an access refusal is
 * read by more eyes than a sanitization report and has no business hinting at
 * what the body contains.
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

/**
 * What a scan of the acquired bytes decided, and everything it saw on the way.
 *
 * `findings` carries the UNCONFIRMED matches too. An unconfirmed finding is not
 * a non-event: it is the scanner saying "this is shaped like a credential and
 * here is why I concluded it is not one", and a reader who disagrees needs to
 * see it. See `lib/ops/fixture-credentials.ts` on the GovDelivery signed link
 * that decodes to a public justice.gov URL — redacting it would have destroyed
 * the provenance of a source link to protect nothing.
 */
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
 * DECIDE THE TIER FROM THE BYTES, using the shipped scanner.
 *
 * One CONFIRMED finding is enough. There is no threshold, no "only one key", no
 * allowance for a trusted publisher: PR #217's key came from a county
 * government's own page. The scanner's two-stage `confirm` predicate is what
 * keeps this from flagging meeting ids, GUIDs, dates and signed public links,
 * and it lives in `lib/ops/fixture-credentials.ts` where the fixture gate can
 * hold it to the same standard.
 *
 * **A `RAW` verdict is a claim about the KNOWN classes, never about the file.**
 * `CLASSES` is what the project knows now; it is a floor and never a completion
 * condition.
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

/**
 * Build the RAW-side artifact for a retrieval, tier decided by scanning.
 *
 * The bytes are handed in as a string because the sanitizer works on text; a
 * binary body (a PDF, an image) is stored as `RAW` without a text scan and does
 * not come through this function.
 */
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
 * PRODUCE THE SANITIZED DERIVATIVE, and the record that links it to its raw.
 *
 * Three refusals, each a failure this could otherwise commit silently:
 *
 *   1. **The bytes must hash to the artifact they claim to be.** A derivation
 *      built from a body that is not the recorded one produces a derivative
 *      whose provenance is a lie, and the hash chain is the only thing that
 *      would ever have caught it.
 *   2. **A derivative may not be derived from a derivative.** Sanitizing twice
 *      is harmless to the bytes and fatal to the record: the second derivation
 *      would name the first as its raw, and the chain back to what the server
 *      actually sent would be quietly one link short.
 *   3. **A `RESTRICTED_RAW` input must actually produce a different body.** If
 *      the sanitizer replaced nothing, the "sanitized" derivative is the
 *      quarantined bytes wearing a readable label, and every parser downstream
 *      would receive the credential while the record said otherwise. This is
 *      the exact shape of the PR #217 leak, one layer up.
 *
 * The derivative inherits the raw's provenance verbatim — same URL, same
 * retrieval moment, same route, same attempt — because it IS that retrieval.
 * What it does not inherit is the tier or the retention.
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

/**
 * The body a PARSER is entitled to for this artifact.
 *
 * `null` means "not this one" rather than "nothing exists", and the caller is
 * expected to look for the derivative. Stated as a function so no consumer
 * re-derives the rule from the tier list and gets it subtly wrong.
 */
export function parserMayRead(artifact: Artifact): boolean {
  return artifact.tier !== "RESTRICTED_RAW";
}
