import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";

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
      readonly fingerprint: string;
    }
  | {
      readonly kind: "CROSSWALK_VERSION";
      readonly versionId: string;
    }
  | {
      readonly kind: "PIPELINE_APPROVAL";
      readonly itemId: string;
      readonly recordId: string;
      readonly approvedAt: string;
    }
  | {
      readonly kind: "MEMBER_ACQUISITION";
      readonly memberKey: string;
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly httpStatus: number;
      readonly rawHash: string;
      readonly retrievedAt: string;
    }
  | {
      /** One door of the door registry as it stood: its id, its record's revision and when it was written, and the sha256 of what it says. */
      readonly kind: "DOOR_RECORD";
      readonly doorId: string;
      readonly revision: number;
      readonly updatedAt: string;
      readonly recordSha256: string;
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
  "DOOR_RECORD",
] as const satisfies readonly DerivedInputKind[];

export type HostAttestation =
  | {
      readonly kind: "RECORDED_ADDRESS";
      readonly source: "OPERATIONAL_REFERENCE" | "GAP_LEDGER" | "REGISTRATION" | "WEBSITE_EVIDENCE";
      readonly versionId: string;
    }
  | { readonly kind: "REDIRECT_FROM_ATTESTED"; readonly fromUrl: string; readonly from: HostAttestation }
  | { readonly kind: "ROUTE_HINT"; readonly hintFingerprint: string }
  | { readonly kind: "LINKED_FROM_ATTESTED_PAGE"; readonly pageArtifactId: string; readonly page: HostAttestation };

export function promotedInputRef(recordClass: string, scope: string, versionId: string | null, value: unknown, promotedAt: string | null): DerivedInputRef | null {
  return versionId === null || promotedAt === null
    ? null
    : { kind: "PROMOTED_VERSION", recordClass, scope, versionId, readModelSha256: createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex"), promotedAt };
}

export interface AdapterBinding {
  readonly adapter: string;
  readonly closureDigest: string;
  readonly config: Readonly<Record<string, string>>;
}

export interface AdapterVerification {
  readonly adapter: string;
  readonly closureDigest: string;
  readonly verifiedAt: string;
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
  "ROBOTS_REFUSED",
  "CHALLENGED",
  "ROUTE_NOT_CONFIRMED",
  "REVIEW_TRIGGERED",
  "REVIEW_OWED",
] as const;
export type DerivedHeldReason = (typeof DERIVED_HELD_REASONS)[number];

export const DERIVED_REVIEW_TRIGGERS = [
  "ROUTE_GONE",
  "WRONG_ATTRIBUTION",
  "CONFLICTING_EVIDENCE",
  "CALENDAR_CHANGED",
  "CROSSWALK_WITHDRAWN",
] as const;
export type DerivedReviewTrigger = (typeof DERIVED_REVIEW_TRIGGERS)[number];

export interface DerivedSuspension {
  readonly trigger: DerivedReviewTrigger;
  readonly detail: string;
  /** When the trigger was first recorded. Only a review after it may restore the row. */
  readonly since: string;
  readonly evidence: readonly DerivedInputRef[];
}

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
      readonly linkingPageSha256: string;
      readonly evidence: DerivedInputRef & { readonly kind: "VAULTED_EVIDENCE" };
    };

export type DerivedRowDecision<Row> =
  | {
      readonly disposition: "PROMOTE";
      readonly key: string;
      readonly row: Row;
      readonly attestation: HostAttestation;
      readonly binding: AdapterBinding;
      readonly verification: AdapterVerification;
      readonly inputs: readonly DerivedInputRef[];
      readonly reviewedAt?: string;
    }
  | {
      readonly disposition: "SUSPEND";
      readonly key: string;
      readonly trigger: DerivedReviewTrigger;
      readonly detail: string;
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
  readonly rows: readonly DerivedVersionEntry<Row>[];
  readonly promoted: readonly string[];
  readonly carried: readonly string[];
  readonly suspended: readonly { readonly key: string; readonly trigger: DerivedReviewTrigger; readonly since: string; readonly newly: boolean }[];
  readonly held: readonly { readonly key: string; readonly reason: DerivedHeldReason; readonly detail: string; readonly carried: boolean }[];
  readonly removed: readonly { readonly key: string; readonly removal: RouteWithdrawnByPublisher }[];
  readonly refusals: readonly { readonly key: string; readonly code: DerivedPlanRefusal; readonly detail: string }[];
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
              : input.kind === "DOOR_RECORD" ? input.updatedAt
                : null)
    .filter((time): time is string => time !== null && Number.isFinite(Date.parse(time)))
    .sort();
  return {
    rawHash: createHash("sha256").update(canonical).digest("hex"),
    retrievedAt: times.at(-1) ?? null,
  };
}
