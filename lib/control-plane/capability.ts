/**
 * THE POLICY / CAPABILITY ENGINE — what a worker is ALLOWED to do, decided
 * outside the worker.
 *
 * The premise of the control plane is that workers are disposable and not
 * trusted to describe themselves (see `attempt.ts`). A worker that cannot be
 * trusted to report its own death cannot be trusted to police its own reach
 * either. So authority is a GRANT held by the control plane and checked against
 * a closed capability list, never a convention a worker is expected to respect.
 *
 * Three properties are load-bearing, and each one is a real failure this design
 * is built to make impossible:
 *
 *   1. DEFAULT DENY. An unknown capability, an unrecognised role, or a role with
 *      no grant is REFUSED. The alternative — "not listed, so probably fine" —
 *      turns every future capability into a silently granted one on the day it
 *      is named.
 *
 *   2. LEAST PRIVILEGE BY ROLE. A PARSER has no network at all. Not "should not
 *      use the network", not "has no reason to": it cannot be authorized for it.
 *      A parser that can fetch is a parser that can quietly repair its own input,
 *      and a repaired input is an unsourced fact.
 *
 *   3. SOME THINGS ARE NOT CAPABILITIES AT ALL. Political neutrality and
 *      coverage symmetry are not privileges to be granted or withheld — they are
 *      invariants, and this module refuses to represent a world in which they
 *      are off. `assertNeutralityEnabled` exists so that an attempt to turn one
 *      off is an exception at the point of the attempt, not a quiet boolean that
 *      travels.
 *
 * TIME IS A PARAMETER. Nothing here reads a clock; `grantedAt` is supplied by
 * the caller so a grant can be replayed exactly.
 */

import { WORKER_ROLES, type WorkerRole } from "./attempt.ts";

/** ----------------------------------------------------------- capabilities */

/**
 * The CLOSED list. A capability that is not here does not exist, and asking for
 * one is a refusal rather than a pass-through.
 *
 * The list is deliberately finer-grained than "read" and "write" in the two
 * places where coarse grants have historically leaked: the evidence vault
 * (sanitized vs restricted) and the method store (propose vs promote).
 */
export const CAPABILITIES = [
  /** Fetch a PUBLIC first-party URL. Never a credentialed or private surface. */
  "NETWORK_PUBLIC_READ",
  /** Read vault artifacts with credentials/PII stripped. */
  "VAULT_READ_SANITIZED",
  /** Read raw vault artifacts, including anything a sanitizer would remove. */
  "VAULT_READ_RESTRICTED",
  /** Write a new artifact into the evidence vault. */
  "VAULT_WRITE",
  /** Propose a method CANDIDATE. A proposal is not knowledge. */
  "METHOD_CANDIDATE_PROPOSE",
  /** Promote a candidate to a method ASSERTION that later jurisdictions inherit. */
  "METHOD_ASSERTION_PROMOTE",
  /** Promote parsed output to canonical, reader-facing data. */
  "CANONICAL_PROMOTE",
  "PRODUCTION_DB_READ",
  /** Granted to NO role by default. See DEFAULT_GRANTS. */
  "PRODUCTION_DB_WRITE",
  /** Commit to a non-default branch. */
  "CODE_BRANCH_WRITE",
  "MERGE_TO_MAIN",
  /** Send anything to a human outside this project. Owner-gated. */
  "EXTERNAL_COMMUNICATION",
  /** File a public-records request with a government body. Owner-gated. */
  "RECORDS_REQUEST_SEND",
  /** Drive a real browser (JS-rendered surfaces, session-bearing navigation). */
  "BROWSER_DRIVE",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set<string>(CAPABILITIES);

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

/**
 * Capabilities that no DEFAULT grant may ever carry.
 *
 * These are not "rarely needed". They are the ones whose blast radius lands on
 * something outside this repository — the production store, a government
 * records officer, a person's inbox — and each therefore requires a grant that
 * an owner constructed on purpose, for one job, with `notes` saying why.
 */
export const OWNER_GATED_CAPABILITIES: readonly Capability[] = [
  "PRODUCTION_DB_WRITE",
  "EXTERNAL_COMMUNICATION",
  "RECORDS_REQUEST_SEND",
];

/** ----------------------------------------------------------------- grants */

export interface CapabilityGrant {
  readonly role: WorkerRole;
  readonly capabilities: readonly Capability[];
  /** The project the grant is scoped to. A grant is never global. */
  readonly project: string;
  /** Pinned onto every Attempt, so a refusal can be replayed under its policy. */
  readonly policyVersion: string;
  /** Caller-supplied ISO stamp. This module never reads a clock. */
  readonly grantedAt: string;
  /** Required prose for any grant that widens beyond the role default. */
  readonly notes: string | null;
}

/**
 * LEAST PRIVILEGE, stated once and enforced everywhere.
 *
 * Read this table as a set of refusals rather than a set of permissions — the
 * interesting entries are the absences:
 *
 *   - PARSER has NO network capability of any kind, and no restricted vault
 *     read. It sees sanitized bytes that an ACQUIRER already captured, and
 *     nothing else. It cannot re-fetch to "check", so its output is a function
 *     of recorded evidence alone.
 *   - ACQUIRER can fetch and can write evidence, but cannot CANONICAL_PROMOTE.
 *     The role that obtains a document is not the role that declares it true.
 *   - MERGE_TO_MAIN belongs to RELEASE_ORCHESTRATOR alone.
 *   - PRODUCTION_DB_WRITE belongs to nobody. It is a separate, deliberate grant.
 *   - EXTERNAL_COMMUNICATION and RECORDS_REQUEST_SEND belong to nobody: sending
 *     something to a human outside this project is the author's decision.
 *   - ADVERSARIAL_AUDITOR KEEPS NETWORK_PUBLIC_READ. That is not an oversight
 *     and not a convenience. An auditor that can only re-read the artifacts the
 *     acquirer chose to keep can only ever confirm the acquirer's framing; its
 *     independence is exactly its ability to go get first-party evidence
 *     itself. It holds no write capability of any kind, which is what keeps that
 *     independence from becoming a second, unreviewed writer.
 */
export const DEFAULT_GRANTS: Record<WorkerRole, readonly Capability[]> = {
  /* A search-API request, not a worker: it holds no capability (2026-09-23). */
  DISCOVERY_SEARCH: [],
  SCOUT: [
    "NETWORK_PUBLIC_READ",
    "BROWSER_DRIVE",
    "VAULT_READ_SANITIZED",
    "VAULT_WRITE",
    "METHOD_CANDIDATE_PROPOSE",
  ],
  ACQUIRER: ["NETWORK_PUBLIC_READ", "BROWSER_DRIVE", "VAULT_READ_SANITIZED", "VAULT_WRITE"],
  PARSER: ["VAULT_READ_SANITIZED"],
  DETECTIVE: [
    "NETWORK_PUBLIC_READ",
    "BROWSER_DRIVE",
    "VAULT_READ_SANITIZED",
    "VAULT_READ_RESTRICTED",
    "VAULT_WRITE",
    "METHOD_CANDIDATE_PROPOSE",
  ],
  ENGINEERING: ["CODE_BRANCH_WRITE", "VAULT_READ_SANITIZED", "PRODUCTION_DB_READ"],
  VALIDATOR: [
    "VAULT_READ_SANITIZED",
    "VAULT_READ_RESTRICTED",
    "PRODUCTION_DB_READ",
    "CANONICAL_PROMOTE",
    "METHOD_ASSERTION_PROMOTE",
  ],
  ADVERSARIAL_AUDITOR: [
    "NETWORK_PUBLIC_READ",
    "BROWSER_DRIVE",
    "VAULT_READ_SANITIZED",
    "VAULT_READ_RESTRICTED",
    "PRODUCTION_DB_READ",
  ],
  RELEASE_ORCHESTRATOR: [
    "CODE_BRANCH_WRITE",
    "MERGE_TO_MAIN",
    "PRODUCTION_DB_READ",
    "VAULT_READ_SANITIZED",
  ],
};

/** Build the default grant for a role. Widening requires `notes`. */
export function defaultGrant(input: {
  role: WorkerRole;
  project: string;
  policyVersion: string;
  grantedAt: string;
  extraCapabilities?: readonly Capability[];
  notes?: string;
}): CapabilityGrant {
  const extra = input.extraCapabilities ?? [];
  if (extra.length > 0 && !input.notes) {
    throw new PolicyContract(
      `A grant for ${input.role} that adds ${extra.join(", ")} beyond the role default ` +
        "must carry notes saying why. An unexplained widening is indistinguishable from a mistake.",
    );
  }
  const base = DEFAULT_GRANTS[input.role] ?? [];
  const merged = [...new Set<Capability>([...base, ...extra])];
  return {
    role: input.role,
    capabilities: merged,
    project: input.project,
    policyVersion: input.policyVersion,
    grantedAt: input.grantedAt,
    notes: input.notes ?? null,
  };
}

export class PolicyContract extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyContract";
  }
}

/**
 * A refusal, carrying the two facts a report needs to be actionable: WHO asked
 * and WHAT they asked for.
 *
 * Both are fields as well as message text, because a downstream reporter that
 * has to regex a sentence to find out which role was refused will eventually
 * regex it wrong.
 */
export class PolicyRefusal extends Error {
  readonly role: WorkerRole | string;
  readonly capability: Capability | string;
  readonly reason: string;

  constructor(role: WorkerRole | string, capability: Capability | string, reason: string) {
    super(reason);
    this.name = "PolicyRefusal";
    this.role = role;
    this.capability = capability;
    this.reason = reason;
  }
}

export interface AuthorizationResult {
  readonly allowed: boolean;
  /** Always populated — an allow states its basis, a refusal states its cause. */
  readonly reason: string;
  readonly role: WorkerRole | string;
  readonly capability: Capability | string;
}

/**
 * The single decision point. DEFAULT DENY.
 *
 * Every non-allow path here refuses. There is no branch that falls through to
 * `allowed: true` because a lookup missed, which is the shape every "we forgot
 * to handle that case" privilege escalation actually takes.
 */
export function authorize(
  grant: CapabilityGrant | null | undefined,
  capability: Capability | string,
): AuthorizationResult {
  if (!grant) {
    return {
      allowed: false,
      reason:
        `Refused ${String(capability)}: no capability grant was presented. ` +
        "An absent grant is a refusal, never an implicit allow.",
      role: "(no grant)",
      capability,
    };
  }

  if (!isCapability(String(capability))) {
    return {
      allowed: false,
      reason:
        `Refused ${String(capability)} for role ${grant.role}: it is not a known capability. ` +
        "The capability list is closed; an unrecognised name is refused rather than passed through.",
      role: grant.role,
      capability,
    };
  }

  if (!WORKER_ROLES.includes(grant.role)) {
    return {
      allowed: false,
      reason:
        `Refused ${String(capability)}: role ${grant.role} is not a known worker role. ` +
        "An unrecognised role holds no capabilities.",
      role: grant.role,
      capability,
    };
  }

  if (!grant.capabilities.includes(capability as Capability)) {
    return {
      allowed: false,
      reason:
        `Refused ${String(capability)} for role ${grant.role}: the grant does not carry it ` +
        `(policy ${grant.policyVersion}, project ${grant.project}). ` +
        `Granted: ${grant.capabilities.length > 0 ? grant.capabilities.join(", ") : "(nothing)"}.`,
      role: grant.role,
      capability,
    };
  }

  return {
    allowed: true,
    reason: `${grant.role} holds ${String(capability)} under policy ${grant.policyVersion}.`,
    role: grant.role,
    capability,
  };
}

/** `authorize`, as a throw. Used where the caller has no branch to take. */
export function requireCapability(
  grant: CapabilityGrant | null | undefined,
  capability: Capability | string,
): void {
  const result = authorize(grant, capability);
  if (!result.allowed) {
    throw new PolicyRefusal(result.role, result.capability, result.reason);
  }
}

/** Which roles hold a capability by default. Used by the invariant tests. */
export function rolesWithCapabilityByDefault(capability: Capability): WorkerRole[] {
  return WORKER_ROLES.filter((role) => DEFAULT_GRANTS[role].includes(capability));
}

/** ------------------------------------------------------- always-on policy */

/**
 * Invariants, not privileges.
 *
 * These are modelled as flags ONLY so that an attempt to disable one is
 * representable long enough to be refused. Nothing in this module ever
 * constructs a policy with one of them off, and `assertNeutralityEnabled`
 * throws the moment such a policy is handed to it.
 */
export const ALWAYS_ON_INVARIANTS = ["POLITICAL_NEUTRALITY", "COVERAGE_SYMMETRY"] as const;
export type AlwaysOnInvariant = (typeof ALWAYS_ON_INVARIANTS)[number];

export interface PolicyFlags {
  /**
   * No ranking, no recommendation, no alignment score, no ordering by anything
   * but a neutral criterion. Cannot be turned off, for any caller, ever.
   */
  readonly politicalNeutrality: boolean;
  /**
   * Effort and coverage do not vary with the politics of the subject. A body is
   * hunted as hard as its neighbour regardless of who holds it.
   */
  readonly coverageSymmetry: boolean;
  /** Genuinely optional operational switches live here and MAY be off. */
  readonly browserDriveEnabled: boolean;
}

export const ALWAYS_ON_POLICY: PolicyFlags = {
  politicalNeutrality: true,
  coverageSymmetry: true,
  browserDriveEnabled: true,
};

export class NeutralityDisabled extends Error {
  readonly invariant: AlwaysOnInvariant;

  constructor(invariant: AlwaysOnInvariant) {
    super(
      `${invariant} is an ALWAYS-ON invariant and cannot be disabled. ` +
        "It is not a capability, not a feature flag, and not subject to a grant: " +
        "a run with it off is refused rather than degraded.",
    );
    this.name = "NeutralityDisabled";
    this.invariant = invariant;
  }
}

/**
 * Throws if anyone has tried to turn an always-on invariant off.
 *
 * Called at policy load and before any scheduling decision. The refusal is at
 * the point of the attempt on purpose — a boolean that travels one function
 * further has already made the wrong behaviour reachable.
 */
export function assertNeutralityEnabled(policy: PolicyFlags): void {
  if (!policy.politicalNeutrality) throw new NeutralityDisabled("POLITICAL_NEUTRALITY");
  if (!policy.coverageSymmetry) throw new NeutralityDisabled("COVERAGE_SYMMETRY");
}
