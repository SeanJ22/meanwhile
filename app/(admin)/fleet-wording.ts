/**
 * **THE FLEET'S FIVE GROUPS, IN THE OWNER'S CANONICAL WORDS.** (Admin Pass A,
 * 2026-09-06.)
 *
 * The control plane projects the seven worker roles onto five groups in
 * `lib/control-plane/fleet-view.ts`; that module owns the MEMBERSHIP and the
 * counts. This module owns only how the console SAYS it — the group name, its
 * roles as words, and the one-line description — verbatim from the canonical
 * grouping the owner set down:
 *
 *   HUNTERS — Scout + Acquirer — find where a public record is and fetch it
 *   DETECTIVES — Detective + Parser — read evidence, extract typed facts,
 *                resolve identity/completeness/conflicts
 *   VERIFIERS — Validator — independently check before trust
 *   AUDITORS — Adversarial Auditor — try to break the candidate using
 *              independent evidence
 *   ENGINEERS — Engineering — turn a verified reusable method into code when
 *               needed (conditional, not a mandatory stage)
 *
 * A wording module, nothing more: no counts, no stages, no pipeline. A role or
 * caller key that reaches a page as a code (`ADVERSARIAL_AUDITOR`) is rendered
 * through {@link roleWords} so the owner reads a name; the raw key stays
 * available for the hover.
 */
import type { WorkerRole } from "@/lib/control-plane/attempt.ts";
import type { FleetGroupKey } from "@/lib/control-plane/fleet-view.ts";

export interface FleetGroupWording {
  /** The group, as the canonical grouping capitalises it. */
  readonly name: string;
  /** The roles in it, as words. */
  readonly roles: string;
  /** What they do, in one line. */
  readonly does: string;
}

export const FLEET_GROUP_WORDING: Record<FleetGroupKey, FleetGroupWording> = {
  hunters: { name: "HUNTERS", roles: "Scout + Acquirer", does: "find where a public record is and fetch it" },
  detectives: {
    name: "DETECTIVES",
    roles: "Detective + Parser",
    does: "read evidence, extract typed facts, resolve identity/completeness/conflicts",
  },
  verifiers: { name: "VERIFIERS", roles: "Validator", does: "independently check before trust" },
  auditors: { name: "AUDITORS", roles: "Adversarial Auditor", does: "try to break the candidate using independent evidence" },
  engineers: {
    name: "ENGINEERS",
    roles: "Engineering",
    does: "turn a verified reusable method into code when needed (conditional, not a mandatory stage)",
  },
};

/** Each worker role as a name. RELEASE_ORCHESTRATOR has never written an Attempt and sits in no group. */
export const ROLE_WORDS: Record<WorkerRole, string> = {
  SCOUT: "Scout",
  ACQUIRER: "Acquirer",
  PARSER: "Parser",
  DETECTIVE: "Detective",
  ENGINEERING: "Engineering",
  VALIDATOR: "Validator",
  ADVERSARIAL_AUDITOR: "Adversarial Auditor",
  RELEASE_ORCHESTRATOR: "Release Orchestrator",
};

/** The group each role reports under, mirroring `FLEET_GROUPS` membership by name. */
export const ROLE_GROUP: Record<WorkerRole, FleetGroupKey | null> = {
  SCOUT: "hunters",
  ACQUIRER: "hunters",
  PARSER: "detectives",
  DETECTIVE: "detectives",
  VALIDATOR: "verifiers",
  ADVERSARIAL_AUDITOR: "auditors",
  ENGINEERING: "engineers",
  RELEASE_ORCHESTRATOR: null,
};

/**
 * A role code as a name, and anything that is not a role code untouched. A
 * cost-ledger caller key such as `SCOUT (control-plane model workers)` keeps
 * its parenthetical and gains the name.
 */
export function roleWords(raw: string): string {
  const m = /^([A-Z_]+)(.*)$/.exec(raw.trim());
  if (!m) return raw;
  const name = (ROLE_WORDS as Record<string, string>)[m[1]];
  return name ? `${name}${m[2]}` : raw;
}

/** `SCHEDULED_BLACKOUT` → `Scheduled blackout`: a state code as a phrase, for beside its label. */
export function codeWords(code: string): string {
  const lower = code.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
