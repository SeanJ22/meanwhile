/**
 * **THE FLEET'S FIVE GROUPS AND SIX ROLES, IN THE OWNER'S CANONICAL WORDS.**
 * (Admin Pass A, 2026-09-06; one name and one sentence per role for Admin C,
 * ADM-43 and §9A.20, 2026-09-06.)
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
 * ## One name per role (ADM-43)
 *
 * The role cards used to print a title AND two codes beside it — `Parsers
 * PARSER · DETECTIVES`, `Auditors ADVERSARIAL_AUDITOR`. The owner, verbatim:
 * *"it should just simply say Detectives, as opposed to right now where it
 * says Parsers and next to it, parser.detective. What I wanted to say is
 * Detective and next to it in smaller font I want to say, 'What is that? What
 * does that mean? What does a detective do?'"* And on the auditor:
 * *"Adversarial Auditor/Auditor. We don't need all that."*
 *
 * So a role reaches the face as exactly one name and one sentence.
 * {@link ROLE_WORDS} is the name and is DERIVED from `plainCode`, the console's
 * one translation layer, so `SCOUT` reads "Hunter" and `ADVERSARIAL_AUDITOR`
 * reads "Auditor" on every surface at once rather than on the one screen the
 * feedback named (RULING 262). {@link ROLE_ONE_LINER} is the sentence, checked
 * against the canonical worker contracts in `lib/control-plane/workers/*`, not
 * against the group's marketing line.
 *
 * A wording module, nothing more: no counts, no stages, no pipeline.
 */
import type { WorkerRole } from "@/lib/control-plane/attempt.ts";
import { WORKER_ROLES } from "@/lib/control-plane/attempt.ts";
import type { FleetGroupKey } from "@/lib/control-plane/fleet-view.ts";
import { plainCode } from "@/lib/control-plane/plain-words.ts";

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

/**
 * Each worker role as the ONE name the owner reads, from `plainCode` so the
 * console never carries a second role dictionary that can disagree with the
 * first. `SCOUT` is "Hunter" and `ADVERSARIAL_AUDITOR` is "Auditor" because
 * that is what the dictionary says and what the owner asked for.
 * RELEASE_ORCHESTRATOR has never written an Attempt and sits in no group.
 */
export const ROLE_WORDS: Record<WorkerRole, string> = Object.fromEntries(
  WORKER_ROLES.map((role) => [role, plainCode(role)]),
) as Record<WorkerRole, string>;

/**
 * What each role actually does, in one sentence, checked against the canonical
 * runtime contract rather than the group's summary line:
 *
 * ```
 *   SCOUT                lib/control-plane/scheduler/scout-executor.ts — the
 *                        bounded model worker that walks a ladder of public
 *                        routes looking for a way in
 *   ACQUIRER             workers/acquirer.ts — fetches bytes through a route
 *                        and vaults them with their provenance
 *   PARSER               workers/parser.ts — extracts typed records from text
 *                        ALREADY vaulted; it never fetches
 *   DETECTIVE            workers/detective.ts — answers ONE bounded factual
 *                        question by testing at least two alternatives against
 *                        cited evidence and a declared external authority
 *   VALIDATOR            workers/validator.ts — checks the extraction against
 *                        the contract and an outside authority
 *   ADVERSARIAL_AUDITOR  workers/auditor.ts — attacks the extraction from
 *                        independent evidence
 *   ENGINEERING          workers/engineering.ts — turns a proved method into
 *                        reviewable code; it may not fetch, write or merge
 * ```
 */
export const ROLE_ONE_LINER: Record<WorkerRole, string> = {
  SCOUT: "Goes looking for the official source, or a promising route to it, when the system does not yet have one.",
  ACQUIRER: "Fetches the public record through a route that is already known, and files the bytes as evidence.",
  // "structured civic facts" was the phrase the owner read and could not use
  // (9.6.26, ACLOSE-6). The role is unchanged; the sentence is his.
  PARSER: "Pulls the useful facts out of a document that has already been fetched. It never goes to the internet itself.",
  DETECTIVE:
    "When the obvious route is missing, blocked, ambiguous or incomplete, investigates other legitimate ways to answer the same question — and has to test at least two explanations against real evidence.",
  VALIDATOR: "Checks that the extracted information matches the source and the rules before anything is trusted.",
  ADVERSARIAL_AUDITOR: "Tries to disprove a checked fact using independent evidence. If it survives, confidence goes up.",
  ENGINEERING: "Turns a proven, reusable method into durable code, proved in isolation and put up for review. It never merges anything itself.",
  RELEASE_ORCHESTRATOR: "Carries a release through the ordinary gates. It has never run here.",
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

/** The card's own heading: one name, plural, and nothing else. */
export function roleTitle(role: string): string {
  const name = (ROLE_WORDS as Record<string, string>)[role];
  return name === undefined ? plainCode(role) : `${name}s`;
}

/** The sentence that goes beside the heading in smaller type. */
export function roleOneLiner(role: string): string {
  return (ROLE_ONE_LINER as Record<string, string>)[role] ?? "";
}

/**
 * How this role is counted on the fleet view, said in words rather than
 * printed as a second code beside the first (ADM-43).
 *
 * Parser and Detective really are ONE GROUP in `fleet-view.ts` and two
 * separate roles in `workers/types.ts`, with different contracts and different
 * evidence rules. The brief allows a combined heading only when they are
 * genuinely the same role in code, and they are not — so the card says the
 * grouping in a sentence and keeps its own single name.
 */
export function roleGroupNote(role: string): string {
  const key = (ROLE_GROUP as Record<string, FleetGroupKey | null>)[role] ?? null;
  if (key === null) return "";
  const title = plainCode(FLEET_GROUP_WORDING[key].name);
  const mine = roleTitle(role);
  const others = (Object.keys(ROLE_GROUP) as WorkerRole[])
    .filter((r) => r !== role && ROLE_GROUP[r] === key)
    .map((r) => roleTitle(r));
  if (others.length === 0) {
    return title === mine
      ? `On the fleet view, ${mine} are their own group.`
      : `On the fleet view, ${mine} are counted on their own, in a group called ${title}.`;
  }
  const members = [mine, ...others];
  const listed = `${members.slice(0, -1).join(", ")} and ${members[members.length - 1]}`;
  return `On the fleet view, ${listed} are counted together in one group called ${title}. They are still separate roles with different jobs.`;
}

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

/**
 * `SCHEDULED_BLACKOUT` → `Scheduled quiet period`: a state code as a phrase,
 * for beside its label.
 *
 * This used to be a second implementation of the same rule — a de-underscore
 * and a capital — beside `plainCode`, which is the console's one translation
 * layer and gives the OWNER'S wording rather than the mechanical one (RULING
 * 103). It is now that function under its old name so existing callers keep
 * working.
 */
export { plainCode as codeWords } from "@/lib/control-plane/plain-words.ts";
