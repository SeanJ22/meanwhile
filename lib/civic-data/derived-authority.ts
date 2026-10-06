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
 * This module is the interface. It holds the shapes the row writer
 * (`lib/control-plane/discovery/derived-wiring.ts`) produces, and the one pure
 * rule every version obeys. The door is the same as every routine contract's:
 * the standing runner promotes through processRoutineCandidate (RULING
 * 282/283), with the DERIVED branches in runner.ts, promotion.ts and
 * validate.ts. The wiring store's ACTIVE rows are the members of the derived
 * meeting families (`lib/civic-data/derived-meeting-family.ts`), so a promoted
 * row publishes through the runner with no code release.
 *
 * **The rule** (`planDerivedVersion`):
 * - A row is promoted only with its inputs, its host attestation, its adapter
 *   binding and the reader adapter's own verification for that body.
 * - A row the writer holds by name is never removed: an absent walk, a
 *   transport failure, a server error, or an access control (a 401, 403 or
 *   429, a bot challenge, a recorded wall) holds it. An outage never suspends
 *   or removes a connection; what was verified stays served. A robots.txt
 *   verdict is recorded evidence and holds nothing by itself (owner decision
 *   2026-09-25); only a walk made before that decision skipped a route for it.
 * - A promoted row is SUSPENDED, never silently kept publishing, when its
 *   evidence says the connection may be wrong (rulings §3; "C16" was a session
 *   label, not Sean's decision): the route answered 404 or 410; its events
 *   now name another body; the evidence conflicts; or the calendar changed
 *   (the filter no longer selects, or the feed moved or changed shape). A
 *   suspended row stays in the version, marked, so its previously verified
 *   records are preserved, and it publishes nothing new until a review later
 *   than the suspension restores or corrects it.
 * - A row is removed only on ROUTE_WITHDRAWN_BY_PUBLISHER evidence, vaulted.
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
    }
  | {
      /**
       * One item the control plane's promotion pipeline APPROVED (the campaign-site chain,
       * lib/control-plane/promotion/campaign-site-chain.ts): the approval record a published row rests on. The
       * writer reads it from the pipeline log and verifies its vaulted bytes again before citing it.
       */
      readonly kind: "PIPELINE_APPROVAL";
      readonly itemId: string;
      readonly recordId: string;
      readonly approvedAt: string;
    }
  | {
      /**
       * One read a derived meeting family made of one wired row's route. Not recomputable: it is the read itself,
       * authorized only by the promoted wiring version the candidate also names (checked at the door).
       */
      readonly kind: "MEMBER_ACQUISITION";
      /** The wiring row whose route this read. */
      readonly memberKey: string;
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly httpStatus: number;
      /** sha256 (bare hex) of the bytes read. */
      readonly rawHash: string;
      readonly retrievedAt: string;
    };

export type DerivedInputKind = DerivedInputRef["kind"];
export const DERIVED_INPUT_KINDS = [
  "PROMOTED_VERSION",
  "VAULTED_EVIDENCE",
  "DISCOVERY_ATTEMPT",
  "COMMITTED_ROUTE_HINT",
  "CROSSWALK_VERSION",
  "PIPELINE_APPROVAL",
  "MEMBER_ACQUISITION",
] as const satisfies readonly DerivedInputKind[];

/** Why a row's host may be read at all. A search find on a third-party host has none. */
export type HostAttestation =
  | {
      readonly kind: "RECORDED_ADDRESS";
      /**
       * Where the walked address was recorded: the promoted operational
       * reference (dispatched and mission needs), the gap ledger CH-21 retired
       * (walks recorded before it; versionId is that file's sha256 at the
       * runtime's commit), or — for a state with no reviewed registry — its
       * promoted registration (2026-09-25).
       */
      readonly source: "OPERATIONAL_REFERENCE" | "GAP_LEDGER" | "REGISTRATION";
      readonly versionId: string;
    }
  | { readonly kind: "REDIRECT_FROM_ATTESTED"; readonly fromUrl: string; readonly from: HostAttestation }
  | { readonly kind: "ROUTE_HINT"; readonly hintFingerprint: string }
  | { readonly kind: "LINKED_FROM_ATTESTED_PAGE"; readonly pageArtifactId: string; readonly page: HostAttestation };

/** A promoted pointer cited as a derived input, or null while it has no promoted version. */
export function promotedInputRef(recordClass: string, scope: string, versionId: string | null, value: unknown, promotedAt: string | null): DerivedInputRef | null {
  return versionId === null || promotedAt === null
    ? null
    : { kind: "PROMOTED_VERSION", recordClass, scope, versionId, readModelSha256: createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex"), promotedAt };
}

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
  "ADAPTER_REFUSED",
  "ADAPTER_CONFIG_INCOMPLETE",
  "BODY_FILTER_NOT_ESTABLISHED",
  "EVIDENCE_NOT_VAULTED",
  "VERIFICATION_STALE",
  "ALREADY_WIRED",
  "LEAD_ONLY",
  "WALK_ABSENT",
  "TRANSPORT_FAILED",
  /**
   * Historical cause: a walk made before the owner decision of 2026-09-25 skipped the route for robots.txt, so the
   * latest walk has no read of it. Held only until the next walk, which reads it; never produced for a current walk.
   */
  "ROBOTS_REFUSED",
  /** An access control answered in place of the route (a recorded wall, a 401, 403 or 429, a bot challenge). Never bypassed. */
  "CHALLENGED",
  /** The latest walk read the reviewed route but did not confirm it; nothing new is published from it. */
  "ROUTE_NOT_CONFIRMED",
  /** A row that has never been promoted meets a review trigger: it waits for the review, unpromoted. */
  "REVIEW_TRIGGERED",
  /** A suspended row waits for a review later than its suspension. */
  "REVIEW_OWED",
] as const;
export type DerivedHeldReason = (typeof DERIVED_HELD_REASONS)[number];

/**
 * What suspends a promoted connection until it is reviewed (C16). Each is evidence the connection may be wrong,
 * never an outage: a timeout, a server error, a refused connection or a challenge holds the row as it is.
 */
export const DERIVED_REVIEW_TRIGGERS = [
  /** The route answered 404 or 410. */
  "ROUTE_GONE",
  /** The events the filter selects now name another body. */
  "WRONG_ATTRIBUTION",
  /** Two reviewed rows claim the same route and meetings for different bodies, or the reviewed evidence disagrees. */
  "CONFLICTING_EVIDENCE",
  /** The filter no longer selects any event, or the feed moved or changed shape. */
  "CALENDAR_CHANGED",
  /** The reviewed crosswalk row the connection rested on is no longer promoted. */
  "CROSSWALK_WITHDRAWN",
] as const;
export type DerivedReviewTrigger = (typeof DERIVED_REVIEW_TRIGGERS)[number];

/** A promoted row's suspension, carried on the row until a later review restores or corrects it. */
export interface DerivedSuspension {
  readonly trigger: DerivedReviewTrigger;
  readonly detail: string;
  /** When the trigger was first recorded. Only a review after it may restore the row. */
  readonly since: string;
  readonly evidence: readonly DerivedInputRef[];
}

/** One row of a derived version: the row, and its suspension when it has one. */
export interface DerivedVersionEntry<Row> {
  readonly key: string;
  readonly row: Row;
  readonly suspension?: DerivedSuspension;
}

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
      /** When the reviewed row this promotion rests on was reviewed; a suspended row is restored only by a later review. */
      readonly reviewedAt?: string;
    }
  | {
      readonly disposition: "SUSPEND";
      readonly key: string;
      readonly trigger: DerivedReviewTrigger;
      readonly detail: string;
      /** When this pass observed the trigger. */
      readonly at: string;
      readonly evidence: readonly DerivedInputRef[];
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
  /** The next version's rows, keyed and sorted; a suspended row carries its suspension. */
  readonly rows: readonly DerivedVersionEntry<Row>[];
  readonly promoted: readonly string[];
  readonly carried: readonly string[];
  /** Suspended rows, by trigger; `newly` when this version suspends them. */
  readonly suspended: readonly { readonly key: string; readonly trigger: DerivedReviewTrigger; readonly since: string; readonly newly: boolean }[];
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
  | "REMOVAL_EVIDENCE_NOT_VAULTED"
  | "SUSPEND_OF_UNKNOWN_ROW"
  | "SUSPEND_WITHOUT_EVIDENCE"
  | "PROMOTE_OF_SUSPENDED_WITHOUT_REVIEW";

const inputKey = (input: DerivedInputRef): string => canonicalCivicDataJson(input);

/**
 * **THE RULE.** Plan the next version from the previous one and this
 * version's decisions. Pure: it reads nothing and writes nothing.
 */
export function planDerivedVersion<Row>(
  previous: readonly DerivedVersionEntry<Row>[],
  decisions: readonly DerivedRowDecision<Row>[],
): DerivedVersionPlan<Row> {
  const before = new Map(previous.map((entry) => [entry.key, entry]));
  const next = new Map(before);
  const promoted: string[] = [];
  const suspended: { key: string; trigger: DerivedReviewTrigger; since: string; newly: boolean }[] = [];
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
      const suspension = before.get(decision.key)?.suspension;
      if (suspension !== undefined && !(decision.reviewedAt !== undefined && Date.parse(decision.reviewedAt) > Date.parse(suspension.since))) {
        refusals.push({
          key: decision.key,
          code: "PROMOTE_OF_SUSPENDED_WITHOUT_REVIEW",
          detail: `suspended since ${suspension.since} (${suspension.trigger}); only a review after that restores it`,
        });
        continue;
      }
      next.set(decision.key, { key: decision.key, row: decision.row });
      promoted.push(decision.key);
      decided.add(decision.key);
      for (const input of [...decision.inputs, verification.evidence]) inputs.set(inputKey(input), input);
    } else if (decision.disposition === "SUSPEND") {
      const prior = before.get(decision.key);
      if (prior === undefined) {
        refusals.push({ key: decision.key, code: "SUSPEND_OF_UNKNOWN_ROW", detail: "only a promoted row is suspended; a new row is held" });
        continue;
      }
      if (decision.evidence.length === 0) {
        refusals.push({ key: decision.key, code: "SUSPEND_WITHOUT_EVIDENCE", detail: "a suspension names the evidence that triggered it" });
        continue;
      }
      /* A row already suspended keeps its first suspension, so the review it waits for is the one it has waited for. */
      const suspension: DerivedSuspension = prior.suspension ?? { trigger: decision.trigger, detail: decision.detail, since: decision.at, evidence: decision.evidence };
      next.set(decision.key, { key: decision.key, row: prior.row, suspension });
      suspended.push({ key: decision.key, trigger: suspension.trigger, since: suspension.since, newly: prior.suspension === undefined });
      decided.add(decision.key);
      for (const input of suspension.evidence) inputs.set(inputKey(input), input);
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
  /* A suspended row this version said nothing new about stays suspended, and is listed as such. */
  for (const [key, entry] of next) {
    if (entry.suspension !== undefined && !suspended.some((s) => s.key === key)) {
      suspended.push({ key, trigger: entry.suspension.trigger, since: entry.suspension.since, newly: false });
    }
  }
  return {
    rows: [...next.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry),
    promoted: promoted.sort(),
    carried,
    suspended: suspended.sort((a, b) => (a.key < b.key ? -1 : 1)),
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
        : input.kind === "VAULTED_EVIDENCE" || input.kind === "MEMBER_ACQUISITION" ? input.retrievedAt
          : input.kind === "DISCOVERY_ATTEMPT" ? input.recordedAt
            : input.kind === "PIPELINE_APPROVAL" ? input.approvedAt
              : null)
    .filter((time): time is string => time !== null && Number.isFinite(Date.parse(time)))
    .sort();
  return {
    rawHash: createHash("sha256").update(canonical).digest("hex"),
    retrievedAt: times.at(-1) ?? null,
  };
}
