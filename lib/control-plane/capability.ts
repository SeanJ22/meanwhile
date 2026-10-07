/**
 * The policy/capability engine: what a worker is allowed to do, decided
 * outside the worker against a closed capability list.
 *
 *   1. Default deny: an unknown capability, unrecognised role, or role with no
 *      grant is refused.
 *   2. Least privilege by role (a PARSER has no network at all).
 *   3. Neutrality and coverage symmetry are invariants, not capabilities;
 *      `assertNeutralityEnabled` throws on an attempt to turn one off.
 *
 * Nothing here reads a clock; `grantedAt` is caller-supplied.
 */

import { WORKER_ROLES, type WorkerRole } from "./attempt.ts";

/** ----------------------------------------------------------- capabilities */

/** The closed list. Finer-grained than read/write for the evidence vault and the method store. */
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

/** Capabilities no default grant may carry: each needs an owner-constructed grant with `notes`. */
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
 * Least privilege, read as refusals:
 *
 *   - PARSER has no network and no restricted vault read; its output is a
 *     function of recorded evidence alone.
 *   - ACQUIRER can fetch and write evidence, but cannot CANONICAL_PROMOTE.
 *   - MERGE_TO_MAIN belongs to RELEASE_ORCHESTRATOR alone.
 *   - PRODUCTION_DB_WRITE, EXTERNAL_COMMUNICATION and RECORDS_REQUEST_SEND
 *     belong to nobody by default.
 *   - ADVERSARIAL_AUDITOR keeps NETWORK_PUBLIC_READ so it can fetch first-party
 *     evidence independently, and holds no write capability.
 */
export const DEFAULT_GRANTS: Record<WorkerRole, readonly Capability[]> = {
  /* A search-API request, not a worker: it holds no capability. */
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

/** A refusal, carrying who asked and what they asked for as fields as well as message text. */
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

/** The single decision point. Default deny: every non-allow path refuses. */
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

/** Invariants, modelled as flags only so an attempt to disable one can be refused. */
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

/** Throws if an always-on invariant was turned off. Called at policy load and before any scheduling decision. */
export function assertNeutralityEnabled(policy: PolicyFlags): void {
  if (!policy.politicalNeutrality) throw new NeutralityDisabled("POLITICAL_NEUTRALITY");
  if (!policy.coverageSymmetry) throw new NeutralityDisabled("COVERAGE_SYMMETRY");
}
