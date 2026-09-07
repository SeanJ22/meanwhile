/**
 * **FAILURES SELF-HEAL LOCALLY; THE OWNER HEARS ONLY AT A THRESHOLD.**
 * (FCP-6, 2026-09-07.)
 *
 * ## The standing law this implements
 *
 * RULING 218 is explicit: a late or failed dispatch is an engineering and
 * freshness defect — an operational incident and a WorkItem — and **never a
 * Needs-Owner escalation by itself**. RULING 271: a decision that is the
 * author's becomes a row and the session continues. `debt.ts` already carries
 * the durable, self-retrying, root-cause-aggregated debt and produces no
 * escalation at all.
 *
 * What FCP-6 adds is the other end of that rule. "Never escalate" is not the
 * law either — there are conditions where the owner genuinely must be told, and
 * a system that cannot tell them apart from a 403 either shouts constantly or
 * goes quiet through something that matters. This module is the threshold.
 *
 * ## Six classes, because they have six different remedies
 *
 * ```
 *   SOURCE_ACQUISITION_FAILURE   the network, the host, the key      retry
 *   SOURCE_SEMANTIC_FAILURE      their bytes are wrong or unreadable  retry, then look
 *   CONSUMER_CORRECTNESS_DEFECT  our product is wrong                 do NOT retry
 *   PROOF_INFRASTRUCTURE_FAILURE we could not look                    retry
 *   SHIPPING_FAILURE             certified work cannot land           retry, then tell
 *   NO_VALID_LAST_GOOD           nothing safe is being served         TELL NOW
 * ```
 *
 * The last one is the only class that escalates on its first occurrence, and
 * the reason is the product's own constitution: a reader is being shown
 * something, and if there is no valid last-known-good then what they are being
 * shown is not backed by anything. That is the one failure this product cannot
 * survive quietly.
 *
 * ## What a threshold is measured in
 *
 * Age, not count. "Failed five times" is fifteen minutes of a flaky host under
 * the debt backoff; "overdue eleven hours" is a reader looking at yesterday.
 * Counting attempts measures how hard we tried, and RULING 250 is explicit that
 * effort is not evidence. So every threshold below is a duration against the
 * time the obligation was DUE, which is the same clock `debtHours` uses.
 *
 * PURE.
 */

export const ESCALATION_FORMAT_VERSION = 1;

export const FAILURE_DOMAINS = [
  "SOURCE_ACQUISITION_FAILURE",
  "SOURCE_SEMANTIC_FAILURE",
  "CONSUMER_CORRECTNESS_DEFECT",
  "PROOF_INFRASTRUCTURE_FAILURE",
  "SHIPPING_FAILURE",
  "NO_VALID_LAST_GOOD",
] as const;
export type FailureDomain = (typeof FAILURE_DOMAINS)[number];

/** What the runtime does with a failure on its own, before anybody is told. */
export const SELF_HEAL_ACTIONS = [
  "RETRY_LOCAL_BACKOFF",
  /** Carry the finding; a retry would find the same wrong bytes. */
  "HOLD_FOR_FIX",
  /** Nothing to heal — the condition is already an emergency. */
  "NONE",
] as const;
export type SelfHealAction = (typeof SELF_HEAL_ACTIONS)[number];

export interface DomainPolicy {
  readonly domain: FailureDomain;
  readonly selfHeal: SelfHealAction;
  /**
   * Hours a condition in this domain may persist before the owner is told.
   * Null means it never escalates on age alone — a WorkItem carries it.
   */
  readonly escalateAfterHours: number | null;
  /** Conditions that escalate regardless of age. */
  readonly escalateImmediatelyWhen: readonly string[];
  readonly why: string;
}

/**
 * The policy table. Every threshold carries the reader-facing reason for its
 * size, because a number with no reason is a number the next session edits by
 * feel — the same failure mode `refresh-cadence.ts` records about intervals.
 */
export const DOMAIN_POLICIES: readonly DomainPolicy[] = [
  {
    domain: "SOURCE_ACQUISITION_FAILURE",
    selfHeal: "RETRY_LOCAL_BACKOFF",
    escalateAfterHours: 48,
    escalateImmediatelyWhen: ["CREDENTIAL_MISSING", "CREDENTIAL_EXPIRED"],
    why:
      "a host refusing us is ours to work around and RULING 218 forbids making it the owner's " +
      "problem; two days is the point at which a route is not flaky, it is gone. A missing or " +
      "expired credential is different in kind: no amount of retrying obtains one, and the person " +
      "who can is the owner",
  },
  {
    domain: "SOURCE_SEMANTIC_FAILURE",
    selfHeal: "RETRY_LOCAL_BACKOFF",
    escalateAfterHours: 72,
    escalateImmediatelyWhen: [],
    why:
      "a publisher's own bytes changing shape is normal and usually transient — a mid-publish read, " +
      "a template being edited. Three days of it is a real format change, which is method work and " +
      "becomes a WorkItem before it becomes an escalation",
  },
  {
    domain: "CONSUMER_CORRECTNESS_DEFECT",
    selfHeal: "HOLD_FOR_FIX",
    escalateAfterHours: null,
    escalateImmediatelyWhen: ["BLOCKS_PROMOTION_DETERMINISTICALLY"],
    why:
      "our product being wrong about a government is the one failure this product cannot survive, " +
      "and it never self-heals: a retry finds the same wrong bytes. It does not escalate on AGE " +
      "because age would make it look like it might resolve itself. It escalates the moment it is " +
      "shown to deterministically block promotion, and otherwise it is a WorkItem with a fix",
  },
  {
    domain: "PROOF_INFRASTRUCTURE_FAILURE",
    selfHeal: "RETRY_LOCAL_BACKOFF",
    escalateAfterHours: 24,
    escalateImmediatelyWhen: [],
    why:
      "a browser that will not start or a provider that will not answer says nothing about any " +
      "holding, so the acquisitions stand and the certification waits. A day of it means the " +
      "instrument is broken rather than busy, and a repository that cannot prove anything is a " +
      "repository that cannot ship anything",
  },
  {
    domain: "SHIPPING_FAILURE",
    selfHeal: "RETRY_LOCAL_BACKOFF",
    escalateAfterHours: 12,
    escalateImmediatelyWhen: ["BRANCH_PROTECTION_REFUSED", "DEPLOY_KEY_REJECTED"],
    why:
      "certified work that cannot land is the shortest threshold of the retrying classes, because " +
      "the work is DONE and the only thing between it and a reader is machinery. A protection or " +
      "key refusal is immediate: those do not resolve by waiting and the fix is the owner's",
  },
  {
    domain: "NO_VALID_LAST_GOOD",
    selfHeal: "NONE",
    escalateAfterHours: 0,
    escalateImmediatelyWhen: ["ALWAYS"],
    why:
      "there is no safe thing to serve. Every other class in this table is survivable because a " +
      "reader keeps seeing the last-known-good; this is the class where that sentence stops being " +
      "true, so it is the one that escalates on sight",
  },
] as const;

export interface FailureCondition {
  readonly domain: FailureDomain;
  /** The obligation, source or transaction this is about. */
  readonly subject: string;
  /** Hours since the thing was DUE — never since it last failed. */
  readonly overdueHours: number;
  /** Named conditions observed, matched against `escalateImmediatelyWhen`. */
  readonly flags: readonly string[];
  readonly detail: string;
}

export interface EscalationDecision {
  readonly formatVersion: typeof ESCALATION_FORMAT_VERSION;
  readonly subject: string;
  readonly domain: FailureDomain;
  readonly escalate: boolean;
  readonly selfHeal: SelfHealAction;
  /** What Admin should show while this is unresolved. */
  readonly adminState: "DEGRADED" | "PENDING" | "HEALTHY";
  readonly reason: string;
}

/**
 * Decide one condition.
 *
 * An unrecognised domain ESCALATES. That is the opposite direction from the
 * resource policy's unknowns and it is deliberate: an unknown resource request
 * is refused because spending on an unknown is the harm, and an unknown failure
 * is escalated because NOT telling anyone about a failure nobody classified is
 * the harm. Both defaults point away from the damage, which is the rule; they
 * point in opposite directions because the damage is in opposite places.
 */
export function decideEscalation(condition: FailureCondition): EscalationDecision {
  const policy = DOMAIN_POLICIES.find((p) => p.domain === condition.domain);
  if (!policy) {
    return {
      formatVersion: ESCALATION_FORMAT_VERSION,
      subject: condition.subject,
      domain: condition.domain,
      escalate: true,
      selfHeal: "NONE",
      adminState: "DEGRADED",
      reason:
        `${JSON.stringify(condition.domain)} is not a classified failure domain. An unclassified ` +
        "failure is the one most worth a person's attention, and it is escalated rather than " +
        "absorbed — the direction RULING 164's unknown case is adopted in",
    };
  }

  const immediate = policy.escalateImmediatelyWhen.filter(
    (f) => f === "ALWAYS" || condition.flags.includes(f),
  );
  if (immediate.length > 0) {
    return {
      formatVersion: ESCALATION_FORMAT_VERSION,
      subject: condition.subject,
      domain: condition.domain,
      escalate: true,
      selfHeal: policy.selfHeal,
      adminState: "DEGRADED",
      reason: `${immediate.join(", ")} — ${policy.why}`,
    };
  }

  const overThreshold =
    policy.escalateAfterHours !== null && condition.overdueHours >= policy.escalateAfterHours;

  return {
    formatVersion: ESCALATION_FORMAT_VERSION,
    subject: condition.subject,
    domain: condition.domain,
    escalate: overThreshold,
    selfHeal: policy.selfHeal,
    adminState: overThreshold ? "DEGRADED" : "PENDING",
    reason: overThreshold
      ? `overdue ${condition.overdueHours.toFixed(1)}h against a ${policy.escalateAfterHours}h ` +
        `threshold — ${policy.why}`
      : `overdue ${condition.overdueHours.toFixed(1)}h; the threshold is ` +
        `${policy.escalateAfterHours === null ? "not age-based" : `${policy.escalateAfterHours}h`}. ` +
        `${policy.selfHeal === "RETRY_LOCAL_BACKOFF" ? "It retries itself, locally, spending no hosted minutes" : policy.selfHeal === "HOLD_FOR_FIX" ? "It is held for a fix and will not retry into a green" : "There is nothing to heal"}`,
  };
}

/**
 * **RECOVERY CLEARS DEBT AUTOMATICALLY.** (FCP-6's last line.)
 *
 * Returns the subjects whose condition has resolved and whose debt the caller
 * must therefore clear. Separated from the escalation decision because clearing
 * is a WRITE and deciding is a READ, and a function that did both would clear
 * debt as a side effect of being asked a question.
 */
export function resolvedSubjects(
  open: readonly FailureCondition[],
  nowHealthy: readonly string[],
): readonly string[] {
  const healthy = new Set(nowHealthy);
  return open.filter((c) => healthy.has(c.subject)).map((c) => c.subject);
}

/** Every domain that never reaches the owner on age alone. For the digest. */
export function silentDomains(): readonly FailureDomain[] {
  return DOMAIN_POLICIES.filter((p) => p.escalateAfterHours === null).map((p) => p.domain);
}
