/**
 * **A DERIVED ROUTINE AUTHORITY: A CANDIDATE COMPUTED ONLY FROM WHAT IS
 * ALREADY PROMOTED OR VAULTED.** (NH330 Stage 2, piece 1: the interface.
 * 2026-09-24.)
 *
 * Stage 2 wires a meetings route that discovery has confirmed into production
 * without a code change. The wiring store (CURATED_READER_RECORD,
 * US:meeting-source-wiring) is kept by the standing runner, and every one of
 * its versions has to be recomputable from its inputs alone: promoted pointer
 * versions, vaulted verified evidence, discovery attempt and record ids, the
 * committed route hints, and the reviewed jurisdiction→body crosswalk. There is
 * no HTTP acquisition of its own, so no route or final URL can authorize it.
 * What authorizes it is the exact identity of those inputs.
 *
 * This module is the interface. It holds the shapes the row writer (the
 * discovery session's piece 2) produces, and the one pure rule every version
 * obeys. The door is the same as every routine contract's: the standing runner
 * promotes through processRoutineCandidate (RULING 282/283). Adding the door's
 * DERIVED branches to runner.ts, promotion.ts and validate.ts, the typed
 * reader verifier, and the cutover of meeting partitions from SOURCE_WIRING
 * comes after this, in one reader batch with one re-proof (B4).
 *
 * **The rule** (`planDerivedVersion`):
 * - A row is promoted only with its inputs, its host attestation, its adapter
 *   binding and the reader adapter's own verification for that body.
 * - A row the writer holds by name is never removed: an absent walk, a
 *   transport failure, a robots refusal or a challenge holds it.
 * - A row is removed only on ROUTE_WITHDRAWN_BY_PUBLISHER evidence: the route
 *   answered 404 or 410, or the attested page that linked it no longer links
 *   it (with that page's new sha256). This is the removal evidence the
 *   validator's horizon rule will accept for this class.
 * - A row the writer says nothing about this version is carried byte-exactly.
 * - A hand-wired route (SOURCE_WIRING) that covers the body holds the derived
 *   row as ALREADY_WIRED: the two are shadow-compared, never two writers.
 */
import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";

/** One input a derived version is computed from. Enough to recompute it. */
export type DerivedInputRef =
  | {
      readonly kind: "PROMOTED_VERSION";
      readonly recordClass: string;
      readonly scope: string;
      readonly versionId: string;
      /** sha256 (bare hex) of the promoted read model the version was computed from. */
      readonly readModelSha256: string;
      readonly promotedAt: string;
    }
  | {
      readonly kind: "VAULTED_EVIDENCE";
      readonly artifactId: string;
      /** The vault's own form, `sha256-<hex>`. */
      readonly contentHash: string;
      /** A credential-bearing body is cited as its sanitized derivative (#405), never raw. */
      readonly tier: "RAW" | "SANITIZED_DERIVED";
      readonly retrievedAt: string;
    }
  | {
      readonly kind: "DISCOVERY_ATTEMPT";
      readonly attemptId: string;
      readonly recordId: string;
      readonly recordedAt: string;
    }
  | {
      readonly kind: "COMMITTED_ROUTE_HINT";
      /** The hint's own fingerprint in lib/hunt/meetings-route-hints.ts. */
      readonly fingerprint: string;
    }
  | {
      readonly kind: "CROSSWALK_VERSION";
      /** The reviewed jurisdiction→body crosswalk version the body identity came from. */
      readonly versionId: string;
    };

/** Why a row's host may be read at all. A search find on a third-party host has none. */
export type HostAttestation =
  | { readonly kind: "RECORDED_ADDRESS"; readonly referenceVersionId: string }
  | { readonly kind: "REDIRECT_FROM_ATTESTED"; readonly fromUrl: string; readonly from: HostAttestation }
  | { readonly kind: "ROUTE_HINT"; readonly hintFingerprint: string }
  | { readonly kind: "LINKED_FROM_ATTESTED_PAGE"; readonly pageArtifactId: string; readonly page: HostAttestation };

/**
 * The reader adapter a row wires, pinned to the adapter's own closure digest,
 * so a parser change re-keys the row instead of silently re-validating it.
 */
export interface AdapterBinding {
  readonly adapter: string;
  readonly closureDigest: string;
  readonly config: Readonly<Record<string, string>>;
}

/** The reader adapter's own verification for this body, not discovery's content check. */
export interface AdapterVerification {
  readonly adapter: string;
  readonly closureDigest: string;
  readonly verifiedAt: string;
  /** Sittings the adapter itself produced for the body from the vaulted bytes. */
  readonly sittings: number;
  readonly evidence: DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" };
}

/** Every named reason a row is held. A held row is kept as it was, never removed. */
export const DERIVED_HELD_REASONS = [
  "NO_REVIEWED_BODY_IDENTITY",
  "BODY_NOT_REGISTERED",
  "HOST_NOT_ATTESTED",
  "PERMISSION_NOT_ALLOWED",
  "ADAPTER_REFUSED",
  "ADAPTER_CONFIG_INCOMPLETE",
  "BODY_FILTER_NOT_ESTABLISHED",
  "EVIDENCE_NOT_VAULTED",
  "VERIFICATION_STALE",
  "ALREADY_WIRED",
  "LEAD_ONLY",
  "WALK_ABSENT",
  "TRANSPORT_FAILED",
  "ROBOTS_REFUSED",
  "CHALLENGED",
] as const;
export type DerivedHeldReason = (typeof DERIVED_HELD_REASONS)[number];

/** The only evidence that removes a derived row. */
export type RouteWithdrawnByPublisher =
  | {
      readonly kind: "ROUTE_WITHDRAWN_BY_PUBLISHER";
      readonly how: "ROUTE_GONE";
      readonly httpStatus: 404 | 410;
      readonly evidence: DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" };
    }
  | {
      readonly kind: "ROUTE_WITHDRAWN_BY_PUBLISHER";
      readonly how: "NO_LONGER_LINKED";
      readonly linkingPageArtifactId: string;
      /** The linking page's new sha256, which no longer carries the route. */
      readonly linkingPageSha256: string;
      readonly evidence: DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" };
    };

/** What the row writer decides about one row this version. */
export type DerivedRowDecision<Row> =
  | {
      readonly disposition: "PROMOTE";
      readonly key: string;
      readonly row: Row;
      readonly attestation: HostAttestation;
      readonly binding: AdapterBinding;
      readonly verification: AdapterVerification;
      readonly inputs: readonly DerivedInputRef[];
    }
  | {
      readonly disposition: "HOLD";
      readonly key: string;
      readonly reason: DerivedHeldReason;
      readonly detail: string;
      readonly inputs: readonly DerivedInputRef[];
    }
  | {
      readonly disposition: "REMOVE";
      readonly key: string;
      readonly removal: RouteWithdrawnByPublisher;
    };

export interface DerivedVersionPlan<Row> {
  /** The next version's rows, keyed and sorted. */
  readonly rows: readonly { readonly key: string; readonly row: Row }[];
  readonly promoted: readonly string[];
  readonly carried: readonly string[];
  /** Held by name this version: a held row that was promoted before is carried, never dropped. */
  readonly held: readonly { readonly key: string; readonly reason: DerivedHeldReason; readonly detail: string; readonly carried: boolean }[];
  readonly removed: readonly { readonly key: string; readonly removal: RouteWithdrawnByPublisher }[];
  /** Decisions that break the rule, by name. A plan with any is not a candidate. */
  readonly refusals: readonly { readonly key: string; readonly code: DerivedPlanRefusal; readonly detail: string }[];
  /** Every input the version was computed from, deduplicated and sorted. */
  readonly inputs: readonly DerivedInputRef[];
}

export type DerivedPlanRefusal =
  | "DUPLICATE_DECISION"
  | "PROMOTE_WITHOUT_INPUTS"
  | "PROMOTE_WITHOUT_VAULTED_EVIDENCE"
  | "VERIFICATION_NOT_THIS_BINDING"
  | "VERIFICATION_PRODUCED_NOTHING"
  | "REMOVE_OF_UNKNOWN_ROW"
  | "REMOVAL_EVIDENCE_NOT_VAULTED";

const inputKey = (input: DerivedInputRef): string => canonicalCivicDataJson(input);

/**
 * **THE RULE.** Plan the next version from the previous one and this
 * version's decisions. Pure: it reads nothing and writes nothing.
 */
export function planDerivedVersion<Row>(
  previous: readonly { readonly key: string; readonly row: Row }[],
  decisions: readonly DerivedRowDecision<Row>[],
): DerivedVersionPlan<Row> {
  const before = new Map(previous.map((entry) => [entry.key, entry.row]));
  const next = new Map(before);
  const promoted: string[] = [];
  const held: { key: string; reason: DerivedHeldReason; detail: string; carried: boolean }[] = [];
  const removed: { key: string; removal: RouteWithdrawnByPublisher }[] = [];
  const refusals: { key: string; code: DerivedPlanRefusal; detail: string }[] = [];
  const inputs = new Map<string, DerivedInputRef>();
  const seen = new Set<string>();
  const decided = new Set<string>();

  for (const decision of decisions) {
    if (seen.has(decision.key)) {
      refusals.push({ key: decision.key, code: "DUPLICATE_DECISION", detail: "one row, one decision per version" });
      continue;
    }
    seen.add(decision.key);
    if (decision.disposition === "PROMOTE") {
      if (decision.inputs.length === 0) {
        refusals.push({ key: decision.key, code: "PROMOTE_WITHOUT_INPUTS", detail: "a derived row names the inputs it was computed from" });
        continue;
      }
      if (!decision.inputs.some((input) => input.kind === "VAULTED_EVIDENCE")) {
        refusals.push({ key: decision.key, code: "PROMOTE_WITHOUT_VAULTED_EVIDENCE", detail: "a promoted row cites vaulted verified evidence" });
        continue;
      }
      const { verification, binding } = decision;
      if (verification.adapter !== binding.adapter || verification.closureDigest !== binding.closureDigest) {
        refusals.push({
          key: decision.key,
          code: "VERIFICATION_NOT_THIS_BINDING",
          detail: `verified by ${verification.adapter}@${verification.closureDigest}, bound to ${binding.adapter}@${binding.closureDigest}`,
        });
        continue;
      }
      if (verification.sittings < 1) {
        refusals.push({ key: decision.key, code: "VERIFICATION_PRODUCED_NOTHING", detail: "the reader adapter produced no sitting for this body" });
        continue;
      }
      next.set(decision.key, decision.row);
      promoted.push(decision.key);
      decided.add(decision.key);
      for (const input of [...decision.inputs, verification.evidence]) inputs.set(inputKey(input), input);
    } else if (decision.disposition === "HOLD") {
      held.push({ key: decision.key, reason: decision.reason, detail: decision.detail, carried: before.has(decision.key) });
      decided.add(decision.key);
      for (const input of decision.inputs) inputs.set(inputKey(input), input);
    } else {
      if (!before.has(decision.key)) {
        refusals.push({ key: decision.key, code: "REMOVE_OF_UNKNOWN_ROW", detail: "only a promoted row can be withdrawn" });
        continue;
      }
      if (decision.removal.evidence.kind !== "VAULTED_EVIDENCE") {
        refusals.push({ key: decision.key, code: "REMOVAL_EVIDENCE_NOT_VAULTED", detail: "withdrawal evidence is vaulted bytes" });
        continue;
      }
      next.delete(decision.key);
      removed.push({ key: decision.key, removal: decision.removal });
      decided.add(decision.key);
      inputs.set(inputKey(decision.removal.evidence), decision.removal.evidence);
    }
  }

  const carried = [...before.keys()].filter((key) => next.has(key) && !promoted.includes(key)).sort();
  return {
    rows: [...next.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, row]) => ({ key, row })),
    promoted: promoted.sort(),
    carried,
    held: held.sort((a, b) => (a.key < b.key ? -1 : 1)),
    removed: removed.sort((a, b) => (a.key < b.key ? -1 : 1)),
    refusals,
    inputs: [...inputs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, input]) => input),
  };
}

/**
 * The retrieval a derived candidate carries in place of an HTTP read.
 *
 * - `rawHash` is the sha256 (bare hex) of the canonical input list, so the same
 *   inputs always give the same hash and a changed input always changes it.
 * - `retrievedAt` is the newest input's own time: the version cannot claim to
 *   be fresher than the newest thing it was computed from.
 */
export function derivedRetrieval(inputs: readonly DerivedInputRef[]): {
  readonly rawHash: string;
  readonly retrievedAt: string | null;
} {
  const canonical = canonicalCivicDataJson([...inputs].map(inputKey).sort());
  const times = inputs
    .map((input) =>
      input.kind === "PROMOTED_VERSION" ? input.promotedAt
        : input.kind === "VAULTED_EVIDENCE" ? input.retrievedAt
          : input.kind === "DISCOVERY_ATTEMPT" ? input.recordedAt
            : null)
    .filter((time): time is string => time !== null && Number.isFinite(Date.parse(time)))
    .sort();
  return {
    rawHash: createHash("sha256").update(canonical).digest("hex"),
    retrievedAt: times.at(-1) ?? null,
  };
}
