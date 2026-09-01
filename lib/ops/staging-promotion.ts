/**
 * PROMOTION OUT OF STAGING — THE HALF THAT DECIDES, AND DECIDES NOTHING ELSE.
 * (Session C final, LANE 5. The promotion half of RULING 233, the staging-first
 * ruling — drafted against a brief that called it `R-0232`/`R-C10`, neither of
 * which is a legal id under `lib/governance/schema.ts`. RULING 233 is the
 * adopted number and the only one cited here.)
 *
 * ## What this is for
 *
 * `main` deploys to production. Under staging-first, nothing reaches `main`
 * that a green run against the staging origin has not already covered — and
 * "covered" is the entire question this module answers. (The host is named by
 * `STAGING_RENDER_ORIGIN` and nowhere else, comments included: the sweep in
 * `tests/origins.test.ts` reads raw text, and a comment repeating the host is
 * one more copy of a fact that is supposed to live in one place.) It is a
 * PERMISSION, not a mover: it never touches a ref, never opens a socket, never
 * reads a clock, a file or an environment variable. Every fact it needs is
 * measured by the caller and passed in, so every refusal below is
 * constructible in a test rather than waited for on a bad afternoon.
 *
 * ## TWO GATES, STACKED, AND NEITHER SUBSTITUTES FOR THE OTHER
 *
 * `main` is protected by a GitHub RULESET (id 21572280, enforcement active) —
 * NOT by classic branch protection, which is why
 * `GET .../branches/main/protection` answers 404 and why that 404 is not
 * absence of protection. The ruleset requires a pull request and three status
 * contexts, strictly (the head must be up to date with `main` for them to
 * count).
 *
 * That platform gate and this module are INDEPENDENT, and the design keeps
 * them so:
 *
 *   - The ruleset can only ever say *these three checks were green on this
 *     head*. It knows nothing about which database the run touched, what the
 *     staging host was serving, or whether production integrity is degraded.
 *   - This module knows all of that and cannot stop a push by itself.
 *
 * So `FREEZE_NOT_CLEAR` and `REQUIRED_CHECKS_NOT_GREEN` are two refusal codes
 * rather than one, and `NOT_FAST_FORWARD` is measured here even though the
 * ruleset's `strict: true` enforces something similar. **A gate that delegates
 * its refusal to the platform has not been shown to work** — it has only been
 * shown to agree with something else that was working.
 *
 * ## THE WRONG ANSWER THIS FILE EXISTS TO REFUSE
 *
 * The naive gate is one boolean: *did staging go green?* It reads the last
 * recorded run, sees PASS, and promotes. Every one of the refusals below is a
 * way that boolean is true while the promotion is unsafe, and three of them
 * are the ones that actually happen:
 *
 *   - **`STALE_HEAD`.** The green run was against the staging head as it stood
 *     an hour ago; two commits landed since. A green about an earlier commit
 *     is not a green about this one — the identical defect
 *     `production-integrity.ts` calls `STALE_HEALTHY`, in the other direction.
 *   - **`DEPLOY_BEHIND_HEAD`.** The suite ran against the staging HOST while
 *     the host was still serving the previous build. Every assertion passed,
 *     and not one of them touched the code being promoted. This is why the
 *     record carries `deployedSha` at all: without it, a green run against a
 *     stale deploy is indistinguishable from a green run against the head.
 *   - **`WRONG_DATABASE`.** The run was green because it was pointed at the
 *     PRODUCTION database. It proved production still works. It proved nothing
 *     about the staging branch's schema, and it wrote reader-shaped rows into
 *     the store that gets sold. A green run against the wrong database is
 *     worse than a red one, because a red one gets investigated.
 *
 * ## Why there is no age bound here, unlike the production freeze
 *
 * `MAX_READING_AGE_HOURS` exists in `production-integrity.ts` because a
 * healthy reading about a LIVING system — production, which keeps serving and
 * whose database keeps moving — stops being true without anything changing in
 * git. A staging gate record is bound to an immutable commit at both ends: the
 * sha it ran against and the sha the host served. It cannot quietly stop being
 * about its subject. If the subject moves, the head moves with it and
 * `STALE_HEAD` fires on the exact identity rather than on a guess about
 * elapsed time. Adding a clock here would add a way to be refused for a reason
 * that is not about the code, and no way to be permitted that the sha check
 * does not already give.
 *
 * ## Every refusal is collected
 *
 * `evaluatePromotion` short-circuits nothing it can measure. An owner reading
 * a refusal needs the WHOLE list — fixing `SUITE_RED`, re-running, and then
 * discovering `WRONG_DATABASE` is how a five-minute repair becomes four
 * round trips. `eligible` is derived from the empty list, never asserted
 * alongside it, so the two can never disagree.
 */

import { STAGING_RENDER_ORIGIN, hostOf } from "./origins.ts";
// The three required contexts are IMPORTED, never re-typed (RULING 103,
// RULING 156). They are matched by GitHub as literal strings, and a second
// copy here would be a second place for a rename to disagree — which is the
// exact way that protection disarms itself with nothing going red.
import { REQUIRED_CONTEXTS } from "./required-checks.ts";
// `sameCommit` is imported, never re-implemented. RULING 103: one
// implementation of one comparison. It is prefix-tolerant with a seven
// character floor, which matters here for exactly the reason it mattered
// there — a record written with an abbreviated sha must not read as a
// DIFFERENT commit from the forty characters `git rev-parse` returns.
import { sameCommit } from "./production-integrity.ts";

/** ------------------------------------------------------------- the record */

/**
 * The three results a gate arm may carry.
 *
 * `NOT_RUN` is a first-class value and NOT a synonym for `FAIL`, because the
 * two are different facts and the owner acts on them differently: a `FAIL` is
 * a defect to fix, a `NOT_RUN` is an arm nobody executed. They are refused
 * identically — an arm that did not run has proved nothing (RULING 24) — and
 * they are REPORTED distinctly, so "the visual suite is broken" is never
 * printed for "the visual suite was never invoked".
 */
export const GATE_RESULTS = ["PASS", "FAIL", "NOT_RUN"] as const;
export type GateResult = (typeof GATE_RESULTS)[number];

/**
 * Which database the staging run actually reached.
 *
 * `unknown` is deliberately present and is refused exactly as `production` is.
 * A run that cannot say which database it touched has not established that it
 * touched the staging one, and the whole point of the isolation work this
 * pairs with is that "probably staging" is not a measurement.
 */
export const DATABASE_ROLES = ["staging", "production", "unknown"] as const;
export type DatabaseRole = (typeof DATABASE_ROLES)[number];

/**
 * The green/red record for ONE EXACT staging commit.
 *
 * Written by whatever runs the staging gate; read by `scripts/promote-staging.mts`.
 * Two sha fields, and they are not redundant:
 *
 *   - `stagingSha` — the commit the suite was ASKED ABOUT.
 *   - `deployedSha` — the commit the staging host was SERVING when it was
 *     asked. `GET /api/build` returns it with no credential, the same way the
 *     production observer learns what production serves.
 *
 * They disagree constantly in practice: a branch deploy takes minutes and a
 * suite starts immediately. Recording one number for both would silently
 * bless every run that raced its own deploy.
 */
export interface StagingGateRecord {
  /** Schema version of this file, so a reader can refuse a shape it predates. */
  readonly formatVersion: 1;
  /** The staging commit this record is ABOUT. */
  readonly stagingSha: string | null;
  /** The commit the staging host was actually serving when it was measured. */
  readonly deployedSha: string | null;
  readonly observedAt: string | null;
  /** `pnpm gates` — tests, lint, tsc, the whole local gate set. */
  readonly suite: GateResult;
  /** The visual/capture suite. */
  readonly visual: GateResult;
  /** `pnpm walk:all`, the standing regression net. */
  readonly walk: GateResult;
  /**
   * Were ALL THREE of the ruleset's required contexts green on this exact
   * staging commit? (`REQUIRED_CONTEXTS` — imported, never re-typed.)
   *
   * This is not a duplicate of `suite`. `suite` is what a session ran locally;
   * this is what the platform observed on the commit, and the two disagree
   * whenever a local run is stale, targeted at the wrong tree, or simply never
   * pushed. The ruleset will refuse the merge on its own — this exists so the
   * refusal is MEASURED here too rather than discovered after a pull request
   * has been opened and left sitting red.
   */
  readonly requiredChecks: GateResult;
  /** Which database the run reached. Anything but `staging` is refused. */
  readonly databaseRole: DatabaseRole;
  /**
   * Did the production release freeze (NH273) permit a release at the time of
   * this run? `null` is "not established", which is never a pass.
   */
  readonly freezeClear: boolean | null;
  /** One sentence a person can act on. */
  readonly detail: string;
}

/**
 * The record a repository with no staging evaluation yet carries.
 *
 * DELIBERATELY NOT GREEN, mirroring `NEVER_CHECKED` in
 * `production-integrity.ts`: every arm `NOT_RUN`, the database `unknown`, the
 * freeze unestablished, both shas absent. The absent case is the weak case,
 * always — a default that promoted would mean the gate's very first run, on a
 * repository that had never evaluated anything, waved a release through.
 */
export const NEVER_EVALUATED: StagingGateRecord = {
  formatVersion: 1,
  stagingSha: null,
  deployedSha: null,
  observedAt: null,
  suite: "NOT_RUN",
  visual: "NOT_RUN",
  walk: "NOT_RUN",
  requiredChecks: "NOT_RUN",
  databaseRole: "unknown",
  freezeClear: null,
  detail: "No staging gate record has been written.",
};

/**
 * A record AS READ, before its format version has been checked.
 *
 * `StagingGateRecord.formatVersion` is the literal `1`, which is what makes
 * `UNKNOWN_FORMAT_VERSION` unrepresentable in the checked type — and therefore
 * what would make it untestable if the evaluator only accepted the checked
 * type. A file on disk may declare any number at all, so the evaluator takes
 * this and refuses the versions it does not understand rather than being
 * handed a shape that has already assumed the answer.
 */
export type UnverifiedGateRecord = Omit<StagingGateRecord, "formatVersion"> & {
  readonly formatVersion: number;
};

/** ---------------------------------------------------------- the refusals */

/**
 * Exactly why a promotion is refused. NAMED, never "not eligible".
 *
 * A gate that prints one boolean teaches nobody what to fix. Each of these is
 * a distinct repair, and the printed list is the owner's work order.
 */
export const PROMOTION_REFUSALS = [
  /** Nothing has ever recorded a staging evaluation, or the file is absent. */
  "NO_GATE_RECORD",
  /** The file exists and could not be parsed. Not an absence — a failed read. */
  "GATE_RECORD_UNREADABLE",
  /** The record is about a different commit than the staging head being promoted. */
  "STALE_HEAD",
  /** The staging host was serving a different commit than the head when measured. */
  "DEPLOY_BEHIND_HEAD",
  /** `pnpm gates` did not pass — or did not run. */
  "SUITE_RED",
  /** The visual suite did not pass — or did not run. */
  "VISUAL_RED",
  /** The walk did not pass — or did not run. */
  "WALK_RED",
  /** The ruleset's three required contexts were not all green on this commit. */
  "REQUIRED_CHECKS_NOT_GREEN",
  /** The run reached the production database, or could not say which it reached. */
  "WRONG_DATABASE",
  /** The production release freeze did not permit a release, or was never asked. */
  "FREEZE_NOT_CLEAR",
  /** `main` is not an ancestor of the staging head, so this is not a fast-forward. */
  "NOT_FAST_FORWARD",
  /** The record declares a schema version this evaluator does not understand. */
  "UNKNOWN_FORMAT_VERSION",
] as const;
export type PromotionRefusal = (typeof PROMOTION_REFUSALS)[number];

const STAGING_HOST = hostOf(STAGING_RENDER_ORIGIN);

/**
 * **THE INTEGRATION BRANCH'S NAME, DERIVED FROM THE HOST IT SERVES.**
 * (ITEM I, 2026-09-01. One implementation — RULING 103.)
 *
 * Measured on the Netlify API on 2026-09-01, four ways:
 *
 * ```
 *   branch_deploy_custom_domain is a SUFFIX, not a per-branch map. Set to the
 *     staging host it created a wildcard one level BELOW it; set to the apex it
 *     created the apex wildcard. Branch deploys are served at <branch>.<suffix>
 *   GET /sites/<id>/domains          -> 404   (no such endpoint)
 *   GET /sites/<id>/branch_domains   -> 404   (no such endpoint)
 *   POST a NETLIFY dns record aimed at a branch deploy -> 422 "invalid site"
 * ```
 *
 * Positive control, the same day: an unused `<label>.<apex>/api/build`
 * resolves, presents a valid certificate off the apex wildcard, and returns
 * 404 — Netlify answering "no branch deploy by that name". So the suffix
 * mechanism is what ROUTES, rather than merely being what did not fail.
 *
 * **The branch name and the subdomain label are therefore ONE FACT on this
 * provider**, and writing them down twice is how they come to disagree — which
 * is the entire argument of `lib/ops/origins.ts`. Point the origin somewhere
 * else and every consumer of this follows it, with no edit.
 *
 * **This is a CONSTRAINT, not a preference, and it is not law.** RULING 233
 * names the integration branch `staging` and the host `test.…`; the provider
 * will not serve both. RULING 235 records these measurements as a FACT and
 * explicitly does NOT amend 233 — a session does not legislate — and NH304
 * carries the choice to the owner. Session C ships under the derived name
 * because RULING 233 is not operative until the session AFTER Session C
 * closes, so nothing here decides anything the owner cannot undo.
 */
export const STAGING_BRANCH = STAGING_HOST.split(".")[0];

/**
 * One sentence per refusal, naming the WRONG ANSWER it prevents rather than
 * restating the condition. The condition is already in the code; what a person
 * reading a red gate at speed needs is why it is not merely pedantry.
 */
export const REFUSAL_EXPLANATIONS: Record<PromotionRefusal, string> = {
  NO_GATE_RECORD:
    "No staging evaluation has ever been recorded. An absent record is not a passing one — " +
    "promoting on it would mean the gate's very first act was to wave a release through.",
  GATE_RECORD_UNREADABLE:
    "The gate record exists and could not be parsed. That is a FAILED READ, not an empty " +
    "document, and a read that could not reach its subject must never print like one that did.",
  STALE_HEAD:
    "The record is about a different commit than the staging head being promoted. A green " +
    "answer about an earlier commit is not an answer about this one — commits landed after " +
    "the suite ran, and nothing has measured them.",
  DEPLOY_BEHIND_HEAD:
    `The suite ran against ${STAGING_HOST} while it was still serving a different build. ` +
    "Every assertion passed and not one of them touched the code being promoted.",
  SUITE_RED:
    "`pnpm gates` did not pass. A NOT_RUN arm is refused identically to a FAIL: an arm nobody " +
    "executed has proved nothing (RULING 24).",
  VISUAL_RED:
    "The visual suite did not pass. A capture is evidence; a missing capture is a missing " +
    "measurement, never a passing one.",
  WALK_RED:
    "`pnpm walk:all` did not pass. The walk is the standing regression net, and a release that " +
    "skips it is a release nothing checked end to end.",
  REQUIRED_CHECKS_NOT_GREEN:
    `The ruleset's required contexts were not all green on this commit (${REQUIRED_CONTEXTS.join(", ")}). ` +
    "The ruleset will refuse the merge on its own, and this refuses first so the red is found " +
    "before a pull request is opened rather than after it has sat there. It is a SECOND gate " +
    "under the freeze, not a substitute for it: it can only say those three checks were green, " +
    "and knows nothing about which database the run reached.",
  WRONG_DATABASE:
    "The run reached the production database, or could not say which database it reached. A " +
    "green run against production proves production still works and proves NOTHING about the " +
    "staging schema — and it writes reader-shaped rows into the store that gets sold.",
  FREEZE_NOT_CLEAR:
    "The production release freeze (NH273) did not permit a release, or was never asked. " +
    "Staging being green says nothing about whether production and the committed migrations " +
    "currently agree.",
  NOT_FAST_FORWARD:
    "`main` was not established to be an ancestor of the staging head. Either something is on " +
    "`main` that staging has never carried — and therefore never tested — or the ancestry could " +
    "not be measured at all. The two are NOT reported as one fact: `git merge-base --is-ancestor` " +
    "answers with an exit code where anything but 0 or 1 means git could not say, and an " +
    "unmeasured ancestry is refused rather than assumed. Read the `ancestry` line above for which " +
    "of the two this run hit.",
  UNKNOWN_FORMAT_VERSION:
    "The record declares a schema version this evaluator does not understand. Its fields are " +
    "NOT interpreted, because reading fields under an unrecognised schema is precisely the " +
    "act of assuming compatibility.",
};

/** ------------------------------------------------------------ the inputs */

/**
 * Where the gate record came from, as a MEASUREMENT rather than a value.
 *
 * `MISSING` and `UNREADABLE` are different facts and both must survive to the
 * verdict: "there is no record" is a true statement about the repository, and
 * "the record would not parse" is a true statement about a failure. Collapsing
 * them into `record: null` would throw away the distinction the owner needs to
 * know whether to run the gate or fix the file.
 */
export type GateRecordSource =
  | { readonly kind: "RECORD"; readonly record: UnverifiedGateRecord }
  | { readonly kind: "MISSING"; readonly how: string }
  | { readonly kind: "UNREADABLE"; readonly how: string };

/**
 * Whether `main` is an ancestor of the staging head.
 *
 * The SAME three-value vocabulary `classifyEquivalenceRange` uses, for the same
 * reason: `git merge-base --is-ancestor` answers with an exit code where 0 is
 * yes, 1 is no and anything else is "git could not say". Collapsing the third
 * into the second would turn a failed measurement into a fact about the
 * history. `unknown` is refused, never assumed.
 */
export const ANCESTRY_VERDICTS = ["ancestor", "not-ancestor", "unknown"] as const;
export type AncestryVerdict = (typeof ANCESTRY_VERDICTS)[number];

export interface PromotionInput {
  readonly gate: GateRecordSource;
  /** The commit at the tip of the staging branch, measured by the caller. */
  readonly stagingHeadSha: string | null;
  /** The commit at the tip of `main`, measured by the caller. */
  readonly mainSha: string | null;
  /** Is `mainSha` an ancestor of `stagingHeadSha`? Measured by the caller with git. */
  readonly ancestry: AncestryVerdict;
}

export interface PromotionVerdict {
  eligible: boolean;
  refusals: readonly PromotionRefusal[];
  reason: string;
  stagingSha: string | null;
  mainSha: string | null;
}

/** ---------------------------------------------------------- the evaluator */

/**
 * May the staging head be promoted to `main`?
 *
 * The order below is the order refusals are PRINTED, not a precedence: nothing
 * here stops early on a refusal it could have kept measuring past. The one
 * thing that legitimately stops further measurement is an unusable record —
 * absent, unparseable, or of an unknown schema — and even then the ancestry
 * check still runs, because ancestry is a fact about git that the record has
 * no bearing on. That is the difference between "not measured because there
 * was nothing to measure it from" and "not measured because we gave up".
 */
export function evaluatePromotion(input: PromotionInput): PromotionVerdict {
  const refusals: PromotionRefusal[] = [];
  const stagingSha = input.stagingHeadSha;
  const mainSha = input.mainSha;

  const record =
    input.gate.kind === "RECORD" ? input.gate.record : null;

  if (input.gate.kind === "MISSING") refusals.push("NO_GATE_RECORD");
  if (input.gate.kind === "UNREADABLE") refusals.push("GATE_RECORD_UNREADABLE");

  // An unknown schema version means the field NAMES may still be there while
  // their MEANINGS are not ours. Reading `suite: "PASS"` out of a shape written
  // by a future writer and treating it as this evaluator's `PASS` is the exact
  // assumption `formatVersion` exists to prevent, so nothing below is read.
  const versionKnown = record !== null && record.formatVersion === 1;
  if (record !== null && !versionKnown) refusals.push("UNKNOWN_FORMAT_VERSION");

  if (record !== null && versionKnown) {
    /*
     * EXACT HEAD ONLY. This is the whole rule and everything else is detail.
     * `sameCommit` is prefix-tolerant, so an abbreviated sha in the record
     * matches the forty characters git returns; it is NOT tolerant of a
     * different commit, and it refuses a null on either side rather than
     * treating "we do not know" as a match.
     */
    if (!sameCommit(record.stagingSha, stagingSha)) refusals.push("STALE_HEAD");

    /*
     * ...AND THE HOST MUST HAVE BEEN SERVING IT. A branch deploy takes minutes
     * and a suite starts immediately, so this disagrees with the head far more
     * often than anyone expects. A green suite against a host still serving an
     * older build proves nothing whatsoever about the head being promoted.
     */
    if (!sameCommit(record.deployedSha, stagingSha)) refusals.push("DEPLOY_BEHIND_HEAD");

    // NOT_RUN and FAIL are refused identically. `!== "PASS"` is deliberate:
    // a future fourth result would be refused by default rather than silently
    // treated as a pass by an `=== "FAIL"` test that had never heard of it.
    if (record.suite !== "PASS") refusals.push("SUITE_RED");
    if (record.visual !== "PASS") refusals.push("VISUAL_RED");
    if (record.walk !== "PASS") refusals.push("WALK_RED");
    // The platform's own verdict on this commit, measured rather than assumed
    // from the local arms above. A local green and a red required context is a
    // routine disagreement, not a contradiction: they observe different trees.
    if (record.requiredChecks !== "PASS") refusals.push("REQUIRED_CHECKS_NOT_GREEN");

    /*
     * THE ISOLATION HALF. A run against the production database is refused
     * even when every other arm is green — especially then, because that is
     * the case where it looks like the strongest evidence in the repository
     * and is instead a measurement of the wrong system.
     */
    if (record.databaseRole !== "staging") refusals.push("WRONG_DATABASE");

    // `!== true` rather than `=== false`: `null` is "never established", and
    // an unasked question is not a passing answer.
    if (record.freezeClear !== true) refusals.push("FREEZE_NOT_CLEAR");
  }

  /*
   * Measured from git, so it stands whatever the record says — or does not say.
   *
   * The ruleset's `strict: true` enforces something close to this at the
   * platform, and that is NOT a reason to drop it. A gate whose only refusal is
   * the platform's refusal has never been shown to work; it has been shown to
   * agree with something else that works. This one is measured locally, refused
   * locally, and tested locally.
   */
  if (input.ancestry !== "ancestor") refusals.push("NOT_FAST_FORWARD");

  const eligible = refusals.length === 0;
  const head = stagingSha ? stagingSha.slice(0, 7) : "an unmeasured staging head";
  const target = mainSha ? mainSha.slice(0, 7) : "an unmeasured main";
  const reason = eligible
    ? `Promotion permitted: the staging gate record is for ${head} exactly, the staging host ` +
      `served ${head}, every arm passed against the staging database, the required contexts were ` +
      `green on it, the production freeze was clear, and ${target} is an ancestor of ${head} so ` +
      "the move is a fast-forward. The ruleset on `main` still gets its own say."
    : `PROMOTION REFUSED — ${refusals.length} refusal(s): ${refusals.join(", ")}. Promoting ${head} ` +
      `onto ${target} is not permitted until every one of them is cleared. There is no skip flag.`;

  return { eligible, refusals, reason, stagingSha, mainSha };
}

/**
 * Render a verdict for a human reading a terminal.
 *
 * Every refusal is printed BY NAME with its explanation. A gate that prints
 * "not eligible" and stops is a gate whose reader has to read its source to
 * act on it.
 */
export function explainPromotion(v: PromotionVerdict): string {
  const lines = [
    v.eligible ? "PROMOTION ELIGIBLE" : "PROMOTION REFUSED",
    `  staging head   ${v.stagingSha ?? "COULD NOT BE MEASURED"}`,
    `  main           ${v.mainSha ?? "COULD NOT BE MEASURED"}`,
    "",
    `  ${v.reason}`,
  ];
  if (v.refusals.length > 0) {
    lines.push("");
    for (const r of v.refusals) lines.push(`  ${r}`, `      ${REFUSAL_EXPLANATIONS[r]}`);
  }
  return lines.join("\n");
}
