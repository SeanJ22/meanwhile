/**
 * **THE INTEGRATION STEWARD, READ OFF WHAT THE SYSTEM ALREADY WROTE.**
 * (ADM-C2 and §11 of the Admin C brief, 2026-09-06.)
 *
 * ## §3.8 first, because it decides the shape of everything below
 *
 * > *There is one canonical Integration Steward. Do not create a second merge
 * > queue. The Admin may control and visualize it, but must not fork its
 * > responsibility.*
 *
 * The canonical Steward in this repository is **the `pnpm handoff --ship` door
 * plus GitHub's required checks and the merge train** — a session on a machine
 * runs the gate set, pushes, opens the PR, waits for the three required
 * contexts, merges, and fast-forwards `main`. `scripts/handoff.mjs` carries the
 * standing authorization for it in its own header. Nothing about it is
 * reachable from a web request, and that is deliberate: a browser cannot run
 * `pnpm gates`, so a browser cannot ship.
 *
 * This module is therefore a **read model and a control surface over facts the
 * canonical Steward and its neighbours already committed or published**. It
 * mints no queue, holds no order of its own, and executes nothing. Every field
 * below is either derived from a durable record or rendered as a named gap that
 * says exactly what would fill it.
 *
 * ## Where each ADM-C2 field actually comes from
 *
 * ```
 *   raw main SHA            runner heartbeat -> codeIdentity.rawMainSha
 *   executable main SHA     runner heartbeat -> codeIdentity.effectiveExecutableSha
 *   production SHA          the deploy's own build stamp, passed in by the page
 *   staging SHA             the newest key in the software-release-review log
 *   ordered queue           one item per staging SHA that log has recorded,
 *                           oldest first, which is the order they arrived in
 *   state per item          derived from the decision rows plus the three SHAs
 *   action / next step      derived from the state; one plain sentence
 *   dependency              the item immediately ahead of it in that order
 *   blocker class           OWNER_GATED when the record proves it; otherwise a
 *                           named gap, because §3.9 forbids turning every red
 *                           item into an introduced blocker
 *   required gate state     the required contexts are a committed constant; what
 *                           they SAID for a candidate is a named gap
 *   merge result            positive only on SHA identity with main; never a
 *                           negative, because ancestry needs git
 *   deploy result           positive only on SHA identity with the build stamp
 *   retry count             how many times the owner sent this build back
 *   responsible agent       who has to move next, in words
 *   owner action required   yes/no, with the action
 *   final durable receipt   the newest state-changing row in the review log
 * ```
 *
 * ## The executable head is not a staleness bug (PRDY-1)
 *
 * An observer-only commit legitimately moves `main` without changing executable
 * code, so `rawMainSha !== runnerTestedSha` is not evidence that the runner is
 * behind. `lib/control-plane/code-identity.ts` already does that classification
 * and publishes its verdict on the heartbeat; this module quotes that verdict
 * and never re-derives it.
 *
 * ## What this module refuses
 *
 * Four of the six controls ADM-C2 names have no canonical seam to call, so they
 * are not in the registry at all — an action that is not in the registry fails
 * closed as an unknown action, which is the behaviour §3.6 asks for. They are
 * exported instead as {@link UNSUPPORTED_CONTROLS}, each carrying the exact
 * missing seam, so the owner can see the whole of what was asked for and read
 * why four of it is not there. Simulating them would be worse than not having
 * them: a Retry button that appends a row and changes nothing teaches the owner
 * that the console lies.
 *
 * PURE. No store, no clock, no environment, no filesystem, no network. Every
 * fact arrives through {@link StewardInput}.
 */

import type { ActionDefinition, RefusalCode } from "./gateway/contract.ts";
import type { CodeIdentity } from "./code-identity.ts";
import {
  gap,
  held,
  measured,
  type CountClaim,
  type Held,
  type Measured,
  type RenderedNumber,
} from "./owner-surface.ts";
import {
  isOwnerReleaseReviewRecord,
  type ProductionIntegrityLogRecord,
  type SoftwareReleaseReviewRecord,
} from "./software-release-review.ts";
import { productionIntegrityHistory } from "../ops/production-integrity-data-plane.ts";
import { sameCommit } from "../ops/production-integrity.ts";
import { REQUIRED_CONTEXTS } from "../ops/required-checks.ts";

/** Where the console sends the owner to act on a candidate. Not a second control. */
export const RELEASE_REVIEW_PATH = "/admin/release-review";
export const STEWARD_PATH = "/admin/steward";

/**
 * A commit as it is written down: eight characters, never the whole hash.
 *
 * The release-review page has the same one-liner beside it as `shortSha`. This
 * is not a second implementation of a rule — it is the same trivial slice with
 * a different absent-case, and `lib/` may not import from `app/`, which is the
 * only reason there are two. The absent case differs on purpose: this module's
 * callers render a real gap sentence, so the placeholder is only ever seen
 * inside a hover.
 */
export function shortId(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 8) : "not recorded";
}

/* ------------------------------------------------------------- vocabulary */

/**
 * What a candidate build is doing right now.
 *
 * Every one of these de-underscores into a phrase an owner reads, because
 * `plainCode` renders an unknown constant by replacing underscores and taking
 * sentence case — so the constant itself has to be written in words already.
 */
export const QUEUE_STATES = [
  "AWAITING_YOUR_REVIEW",
  "CHANGES_REQUESTED",
  "DISCARDED",
  "APPROVED_FOR_PRODUCTION",
  "ON_MAIN",
  "LIVE_IN_PRODUCTION",
] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

/** The canonical blocker vocabulary (§3.9). Never widened here. */
export const BLOCKER_CLASSES = ["INTRODUCED", "INHERITED", "OWNER_GATED", "EXTERNAL"] as const;
export type BlockerClass = (typeof BLOCKER_CLASSES)[number];

/** The five stages a release decision passes through (§9A.18), in order. */
export const RELEASE_STAGES = [
  "DECIDED",
  "IMPLEMENTED_IN_STAGING",
  "MERGED_TO_MAIN",
  "DEPLOYED_TO_PRODUCTION",
  "VERIFIED_ON_PRODUCTION",
] as const;
export type ReleaseStageKey = (typeof RELEASE_STAGES)[number];

/**
 * What the console can say about one stage.
 *
 * `CANNOT_TELL` is a first-class answer and it is the whole point of the type.
 * A stage this page cannot observe must never render as NOT_REACHED: "main does
 * not contain this commit" and "whether main contains this commit is not
 * readable from a deployed site" are different sentences, and only the second
 * one is true here.
 */
export type StageState = "REACHED" | "NOT_REACHED" | "CANNOT_TELL";

export interface LifecycleStage {
  readonly key: ReleaseStageKey;
  /** What the owner reads on the strip. */
  readonly label: string;
  readonly state: StageState;
  /** One plain sentence: why it says that. Carries no timestamp — those are fields. */
  readonly says: string;
}

/* ---------------------------------------------------------------- blocker */

export interface BlockerReading {
  readonly blocked: boolean;
  /** The canonical class, or the named gap where the record does not establish one. */
  readonly klass: Held<BlockerClass>;
  readonly says: string;
}

/* ---------------------------------------------------------------- receipt */

/** The newest state-changing row against a candidate: the durable receipt. */
export interface StewardReceipt {
  readonly recordId: string;
  /** The commit the row is bound to, carried rather than parsed back out of the id. */
  readonly stagingSha: string;
  readonly kind: string;
  readonly section: string | null;
  readonly at: string;
  /** The admin session that wrote it, never a person's name. */
  readonly actorRef: string;
}

/* ------------------------------------------------------------ queue items */

export interface StewardQueueItem {
  /** The exact staging commit. This is the item's identity and its state version. */
  readonly stagingSha: string;
  /** 1-based place in the order the log recorded them. */
  readonly position: number;
  readonly state: QueueState;
  /** What happens next, in one plain sentence. */
  readonly nextStep: string;
  /** Who has to move: "You", or the machine or session that does. */
  readonly responsible: string;
  readonly ownerActionRequired: boolean;
  /** When true, what the owner should do. */
  readonly ownerAction: string | null;
  /** The candidate immediately ahead of this one, or null when nothing is. */
  readonly dependsOn: string | null;
  readonly dependencySays: string;
  readonly blocker: BlockerReading;
  /** What branch protection requires of it, and what those checks said. */
  readonly requiredChecks: readonly string[];
  readonly gateState: Held<string>;
  readonly mergeResult: Held<string>;
  readonly deployResult: Held<string>;
  /** How many times the owner sent this build back, out of every decision on it. */
  readonly retries: Measured;
  readonly receipt: Held<StewardReceipt>;
  readonly lifecycle: readonly LifecycleStage[];
  /** The farthest stage that is actually proved. Never a hopeful one. */
  readonly farthest: LifecycleStage;
  readonly firstSeenAt: string;
  readonly lastActivityAt: string;
  /** Netlify deploy id the manifest carried for this build, when it carried one. */
  readonly deployId: string | null;
  /** Every row the log holds for this candidate, decisions and console notes alike. */
  readonly rowCount: number;
  readonly decisionCount: number;
  /** The same two numbers as one measurement, so the disclosure prints no bare count. */
  readonly decisions: Measured;
}

/* ---------------------------------------------------------------- identity */

export interface StewardIdentity {
  readonly rawMain: Held<string>;
  readonly executableMain: Held<string>;
  readonly production: Held<string>;
  readonly staging: Held<string>;
  readonly runnerTested: Held<string>;
  /** The runner's own consistency verdict, quoted rather than re-derived. */
  readonly verdict: string | null;
  /** What that verdict means for the owner, in one sentence. */
  readonly verdictSays: string;
  /** The instrument's own sentence, for the disclosure. */
  readonly instrumentSays: string | null;
  readonly readAt: string | null;
  /**
   * Observer-only commits sitting above the executable head. Not staleness.
   *
   * HELD only when the runner actually walked. With no walk there is no count:
   * a zero would say "nothing sits above the executable head", which is a
   * finding, and no finding was made.
   */
  readonly nonShippingAbove: Held<Measured>;
}

/* --------------------------------------------------------------- controls */

/**
 * A control the canonical system actually supports, defined once so the UI, the
 * gateway registry and the tests all read the same definition.
 *
 * LANE A owns the executor. These are declarations of what may be invoked, and
 * the note beside each says which canonical function the executor must call —
 * never a second implementation of it.
 */
export interface StewardAction extends ActionDefinition {
  /** The canonical code path an executor must route this through. */
  readonly executesThrough: string;
  /** Where the owner reads the result back afterwards. */
  readonly readBackAt: string;
  /** What that page is called, so a path never has to lead on the face. */
  readonly readBackLabel: string;
}

export const STEWARD_ACTIONS: readonly StewardAction[] = [
  {
    type: "steward.defect.return_to_lane",
    label: "Send this back to the work queue",
    does: "Puts the problem you found on the queue the next work session pulls from, with the build it was found on.",
    doesNot: "Does not open a branch, assign anybody, merge, deploy, or change the build itself.",
    authority: "PROPOSE_ONLY",
    subjectKind: "staging build",
    requiresStateVersion: false,
    refusals: ["INVALID_INPUT", "ALREADY_DONE", "DOWNSTREAM_REFUSED"],
    executesThrough: "appendDecisionIntent in lib/control-plane/admin-data.ts, through the existing fix-queue field the decision route already parses",
    readBackAt: "/admin",
    readBackLabel: "the command centre",
  },
  {
    type: "release.owner_decision",
    label: "Record your decision on this build",
    does: "Records approve, changes needed, or discard against this exact staging commit, and nothing else.",
    doesNot: "Does not merge, deploy, promote, or move any build forward. A decision is a record.",
    authority: "OWNER_DECISION_REQUIRED",
    subjectKind: "staging commit",
    // The staging commit IS the state version: a decision recorded against a
    // build that has since moved is the exact defect the exact-SHA rule exists
    // to prevent, and the canonical writer already refuses it.
    requiresStateVersion: true,
    refusals: ["STALE_STATE", "INVALID_INPUT", "ALREADY_DONE", "DOWNSTREAM_REFUSED", "NOT_SUPPORTED_YET"],
    executesThrough: "recordReview in app/(admin)/admin/release-review/write.ts — the exact-SHA rule lives there and may not be forked",
    readBackAt: RELEASE_REVIEW_PATH,
    readBackLabel: "the release review",
  },
];

/** A control ADM-C2 asked for that has nothing canonical to call. */
export interface UnsupportedControl {
  /** What the control would be called if it existed. */
  readonly label: string;
  /** What ADM-C2 asked for, in its own terms. */
  readonly asked: string;
  readonly refusal: RefusalCode;
  /** The sentence the owner reads instead of a button. */
  readonly says: string;
  /** The exact thing that would have to exist first. */
  readonly missingSeam: string;
}

export const UNSUPPORTED_CONTROLS: readonly UnsupportedControl[] = [
  {
    label: "Move a build up the queue",
    asked: "reprioritise an eligible queued item",
    refusal: "NOT_SUPPORTED_YET",
    says: "There is no stored order to change. This list is in the order the builds arrived, which is a reading of the review log rather than a queue anyone can rearrange.",
    missingSeam:
      "an ordered integration-queue log in the control plane, written by the shipping door, with a position the owner can move — no such log exists (pg-schema.ts APPEND_ONLY_LOGS has no integration queue).",
  },
  {
    label: "Retry the checks",
    asked: "retry",
    refusal: "NOT_SUPPORTED_YET",
    says: "Nothing this page can reach is able to start the checks again. They run on the machine that ships, and a browser cannot start them.",
    missingSeam:
      "a runner-honoured integration intent (the runner already honours PAUSE / RESUME / RUN CYCLE NOW / DISPATCH for research; there is no equivalent action that runs the shipping door and writes back a result).",
  },
  {
    label: "Pause shipping",
    asked: "pause",
    refusal: "NOT_SUPPORTED_YET",
    says: "There is nothing to pause. Shipping is a command somebody runs, not a service that is running; the only pause the system has stops research work, which is a different thing and saying otherwise would be a lie.",
    missingSeam:
      "an owner-writable release-freeze record the shipping gate reads — today the freeze is derived from the committed post-deploy integrity reading and nothing else, and the runner pause covers research only.",
  },
  {
    label: "Resume shipping",
    asked: "resume",
    refusal: "NOT_SUPPORTED_YET",
    says: "Nothing is paused, so there is nothing to resume.",
    missingSeam: "the same owner-writable release-freeze record. Pause and resume are one seam.",
  },
];

/**
 * §11 — the software release execution boundary.
 *
 * The intended model is: reviewed staging commit, owner decision, integration
 * candidate, exact-head checks, canonical Steward, merge and deploy, production
 * proof, durable receipt. Steps one, two and eight exist here. Steps four
 * through seven exist on the machine that ships and are unreachable from a
 * request. A "Deploy" button that called Netlify or GitHub directly would skip
 * the gate set, which is the one thing shipping law forbids outright.
 *
 * So the verdict is stated rather than worked around, and the seam that would
 * change it is named to the file.
 */
export const SOFTWARE_RELEASE_EXECUTION = "READY_FOR_NEXT_PASS" as const;

export const RELEASE_EXECUTION_SEAM = {
  /** In the owner's terms, what is missing. */
  says: "The console can record what you decided about a build and can show where that build has got to. It cannot start the checks or merge anything: that runs on the machine, from one command, and nothing on the web can reach it.",
  /** For the next pass, exactly what to build. */
  missingSeam:
    "an integration intent on the control plane that the standing runner honours by invoking the canonical shipping door (pnpm handoff --ship) and appending its result — the same INTENT/HONORED pair scripts/pilot-runner.mts already uses for research, plus an execution receipt in the shape of lib/ops/execution-result.ts. Nothing in the repository does this today.",
  /** What must survive that change. */
  preserves:
    "the exact gate set, the three required checks, the exact-head rule, the exact-commit review binding, and the post-deploy reading.",
} as const;

/* ------------------------------------------------------------- read model */

export interface StewardInput {
  readonly nowIso: string;
  /** The commit the deploy serving this page was built from, or null when unstamped. */
  readonly deployedSha: string | null;
  /** The runner's published three-commit identity, or null when it published none. */
  readonly codeIdentity: CodeIdentity | null;
  /** Why there is no identity, when there is none. */
  readonly identityDetail: string | null;
  /** Every software-release-review row, any commit. Null when the log could not be read. */
  readonly reviewRows: readonly SoftwareReleaseReviewRecord[] | null;
  /** Why the log could not be read, when it could not. */
  readonly reviewDetail: string | null;
}

export interface StewardReadModel {
  readonly nowIso: string;
  readonly identity: StewardIdentity;
  readonly queue: readonly StewardQueueItem[];
  /** Builds still waiting on somebody, out of every build the log has recorded. */
  readonly queueDepth: Measured;
  /** Builds that need the owner, out of every build the log has recorded. */
  readonly needsYou: Measured;
  /** The item at the head of the queue that is still open, or null. */
  readonly current: StewardQueueItem | null;
  /** The one behind it, or null. */
  readonly next: StewardQueueItem | null;
  /** The newest state-changing row anywhere in the log. */
  readonly latestReceipt: Held<StewardReceipt>;
  readonly requiredChecks: readonly string[];
  /** True when the review log answered. False means the queue below is not a zero. */
  readonly queueReadable: boolean;
  /** Why the queue is unreadable, when it is. */
  readonly queueSays: string | null;
  readonly execution: typeof SOFTWARE_RELEASE_EXECUTION;
  /** Where the release is waiting right now, in one sentence. */
  readonly waitingSays: string;
}

/* --------------------------------------------------------------- deriving */

/** The rows for one commit, oldest first. */
function rowsFor(rows: readonly SoftwareReleaseReviewRecord[], sha: string): SoftwareReleaseReviewRecord[] {
  return rows
    .filter((r) => r.stagingSha === sha)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** A row that changed something, as opposed to the console's own note that it saw a build. */
function isStateChanging(row: SoftwareReleaseReviewRecord): boolean {
  return row.decision !== "MANIFEST_OBSERVED";
}

function receiptOf(rows: readonly SoftwareReleaseReviewRecord[]): Held<StewardReceipt> {
  const changing = rows.filter(isStateChanging);
  const last = changing[changing.length - 1];
  if (!last) {
    return gap(
      "OURS",
      "No decision has been recorded against this build. The only rows it has are the console's own notes that it saw the build.",
    );
  }
  return held({
    recordId: last.id,
    stagingSha: last.stagingSha,
    kind: last.decision,
    section: last.section,
    at: last.createdAt,
    actorRef: last.actor,
  });
}

/**
 * The state of one candidate, in the order that puts the FARTHEST TRUTHFUL
 * reading first (§9A.18).
 *
 * Where the code has got to outranks what the owner thought of it: a build that
 * production is serving reads as live even if the owner asked for changes on
 * it, because that is the alarming true thing and the decision rows are right
 * there beside it. What is never done is the reverse — a decision is never
 * allowed to imply a stage the code has not reached.
 */
function stateOf(input: {
  readonly rows: readonly SoftwareReleaseReviewRecord[];
  readonly sha: string;
  readonly deployedSha: string | null;
  readonly rawMainSha: string | null;
  readonly executableSha: string | null;
}): QueueState {
  if (sameCommit(input.sha, input.deployedSha)) return "LIVE_IN_PRODUCTION";
  if (sameCommit(input.sha, input.rawMainSha) || sameCommit(input.sha, input.executableSha)) return "ON_MAIN";
  if (input.rows.some((r) => r.decision === "OWNER_APPROVED_FOR_PRODUCTION")) return "APPROVED_FOR_PRODUCTION";
  const decisions = input.rows.filter((r) => r.decision === "APPROVE" || r.decision === "NEEDS_CHANGES" || r.decision === "DISCARD");
  const latestBySection = new Map<string, SoftwareReleaseReviewRecord>();
  for (const row of decisions) latestBySection.set(row.section ?? "-", row);
  const latest = [...latestBySection.values()];
  if (latest.length > 0 && latest.every((r) => r.decision === "DISCARD")) return "DISCARDED";
  if (latest.some((r) => r.decision === "NEEDS_CHANGES")) return "CHANGES_REQUESTED";
  return "AWAITING_YOUR_REVIEW";
}

/** Who moves next, what they do, and whether it is the owner. */
function nextStepOf(state: QueueState): {
  readonly nextStep: string;
  readonly responsible: string;
  readonly ownerActionRequired: boolean;
  readonly ownerAction: string | null;
} {
  switch (state) {
    case "AWAITING_YOUR_REVIEW":
      return {
        nextStep: "Nothing moves until you look at this build and say what you think of each part of it.",
        responsible: "You",
        ownerActionRequired: true,
        ownerAction: "Open the release review for this build and record a decision on each section.",
      };
    case "CHANGES_REQUESTED":
      return {
        nextStep: "The changes you asked for are made in a work session. The next staging build appears here as a new candidate, with its own commit.",
        responsible: "The next work session",
        ownerActionRequired: false,
        ownerAction: null,
      };
    case "DISCARDED":
      return {
        nextStep: "Nothing further happens to this build. It stays on the list so the record of the decision survives.",
        responsible: "Nobody",
        ownerActionRequired: false,
        ownerAction: null,
      };
    case "APPROVED_FOR_PRODUCTION":
      return {
        nextStep: "This build is waiting for the shipping door to run the checks and merge it. That door runs on the machine, from one command, and this page cannot start it.",
        responsible: "The session that ships",
        ownerActionRequired: false,
        ownerAction: null,
      };
    case "ON_MAIN":
      return {
        nextStep: "This build is on main. The next deploy is what puts it in front of readers.",
        responsible: "The deploy",
        ownerActionRequired: false,
        ownerAction: null,
      };
    case "LIVE_IN_PRODUCTION":
    default:
      return {
        nextStep: "This build is what production is serving. A post-deploy reading is what would confirm that independently.",
        responsible: "The post-deploy check",
        ownerActionRequired: false,
        ownerAction: null,
      };
  }
}

/**
 * The blocker, classified only where a record establishes the class.
 *
 * §3.9 is explicit that not every red item is an introduced release blocker. A
 * build waiting for a decision is provably owner-gated — the log says so. A
 * build the owner sent back is genuinely blocked, but the row records his
 * judgement and not where the defect came from, so the class is a named gap
 * rather than a guess between introduced and inherited.
 */
function blockerOf(state: QueueState): BlockerReading {
  if (state === "AWAITING_YOUR_REVIEW") {
    return {
      blocked: true,
      klass: held("OWNER_GATED"),
      says: "This build cannot move until you decide about it.",
    };
  }
  if (state === "CHANGES_REQUESTED") {
    return {
      blocked: true,
      klass: gap(
        "UNKNOWABLE_NOW",
        "The review row records what you decided, not where the problem came from, so this page cannot say whether the change introduced it or it was already there. Recording that classification beside the decision would fill this.",
      ),
      says: "You asked for changes, so this build is stopped until a new one replaces it.",
    };
  }
  return {
    blocked: false,
    klass: gap("UNKNOWABLE_NOW", "Nothing is blocking this build, so there is no class to name."),
    says: "Nothing is blocking this build.",
  };
}

/**
 * The five stages, each answered from evidence or marked as unanswerable.
 *
 * The two rules that shape this, both from §9A.18: never label a staging
 * decision as implemented on main, and never label an implementation live
 * without production evidence. Both are satisfied by never producing REACHED
 * from anything except a commit identity, and by producing CANNOT_TELL — never
 * NOT_REACHED — wherever the evidence would have to come from a git ancestry
 * check or a reading this page cannot make.
 */
function lifecycleOf(input: {
  readonly sha: string;
  readonly decisionCount: number;
  readonly deployedSha: string | null;
  readonly rawMainSha: string | null;
  readonly executableSha: string | null;
  readonly haveIdentity: boolean;
  readonly integrity: ProductionIntegrityLogRecord | null;
}): LifecycleStage[] {
  const onMain = sameCommit(input.sha, input.rawMainSha) || sameCommit(input.sha, input.executableSha);
  const live = sameCommit(input.sha, input.deployedSha);
  return [
    {
      key: "DECIDED",
      label: "You decided",
      state: input.decisionCount > 0 ? "REACHED" : "NOT_REACHED",
      says:
        input.decisionCount > 0
          ? "Your decisions on this build are recorded against this exact commit."
          : "Nothing has been recorded against this build yet.",
    },
    {
      key: "IMPLEMENTED_IN_STAGING",
      label: "Built on the test site",
      state: "REACHED",
      says: "The test site built this exact commit, which is what the review is bound to. That is what makes it a candidate at all.",
    },
    {
      key: "MERGED_TO_MAIN",
      label: "Merged into main",
      state: onMain ? "REACHED" : "CANNOT_TELL",
      says: onMain
        ? "This commit is what the runner last read as the head of main."
        : input.haveIdentity
          ? "Main's head is a different commit. That does not prove this one is unmerged — it could already be in main's history — and working that out needs a git ancestry check, which a deployed site cannot run."
          : "The runner has not published which commit main is at, so there is nothing to compare against.",
    },
    {
      key: "DEPLOYED_TO_PRODUCTION",
      label: "Deployed to production",
      state: live ? "REACHED" : "CANNOT_TELL",
      says: live
        ? "This is the commit the deploy serving this page was built from."
        : input.deployedSha === null
          ? "This deploy was built without a commit stamp, so it cannot name the commit it is serving."
          : "Production was built from a different commit. As with main, that is not proof this one is absent from its history.",
    },
    {
      key: "VERIFIED_ON_PRODUCTION",
      label: "Checked on production",
      state: input.integrity === null ? "CANNOT_TELL" : "REACHED",
      says:
        input.integrity === null
          ? "The canonical control plane software-release log holds no post-deploy reading for this exact commit."
          : `The durable post-deploy reading reported ${input.integrity.productionIntegrity.observed}` +
            `${input.integrity.productionIntegrity.failureClass ? ` (${input.integrity.productionIntegrity.failureClass})` : ""} ` +
            `at ${input.integrity.createdAt}: ${input.integrity.productionIntegrity.detail}`,
    },
  ];
}

/** The farthest stage actually proved, which is what the headline may claim. */
export function farthestReached(stages: readonly LifecycleStage[]): LifecycleStage {
  let far = stages[0];
  for (const stage of stages) if (stage.state === "REACHED") far = stage;
  return far;
}

/* ------------------------------------------------------------------ build */

/** The commits the log holds, in the order they were first recorded. */
function candidatesInOrder(rows: readonly SoftwareReleaseReviewRecord[]): string[] {
  const firstSeen = new Map<string, string>();
  for (const row of rows) {
    const seen = firstSeen.get(row.stagingSha);
    if (seen === undefined || row.createdAt < seen) firstSeen.set(row.stagingSha, row.createdAt);
  }
  return [...firstSeen.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1))
    .map(([sha]) => sha);
}

function identityOf(input: StewardInput, stagingSha: string | null): StewardIdentity {
  const id = input.codeIdentity;
  const noRunner =
    input.identityDetail ??
    "The runner has not published the three commit identities yet. Its next cycle writes them.";
  const above = id?.nonShippingAbove.length ?? 0;
  return {
    rawMain: id?.rawMainSha ? held(id.rawMainSha) : gap("OURS", noRunner),
    executableMain: id?.effectiveExecutableSha ? held(id.effectiveExecutableSha) : gap("OURS", noRunner),
    production: input.deployedSha
      ? held(input.deployedSha)
      : gap("OURS", "This deploy was built without a commit stamp, so it cannot name the commit it is serving."),
    staging: stagingSha
      ? held(stagingSha)
      : gap(
          "OURS",
          "No build from the test site has been recorded. One appears the first time the release review page can read the test site's build description.",
        ),
    runnerTested: id?.runnerTestedSha ? held(id.runnerTestedSha) : gap("OURS", noRunner),
    verdict: id?.verdict ?? null,
    verdictSays: verdictSentence(id),
    instrumentSays: id?.detail ?? null,
    readAt: id?.readAt ?? null,
    // The denominator is the walk's own bound, which is the honest one: the
    // runner looks back a fixed number of commits, so "3 of 64" says both how
    // many observer-only commits sit above the executable head and how far the
    // reading could see. A count over itself would have said nothing.
    nonShippingAbove:
      id === null
        ? gap("OURS", noRunner)
        : held(
            measured(
              above,
              Math.max(above, id.walkBound),
              "Commits on main above the last one that changed executable code, out of the commits the runner walked. A commit that only records an observation moves main without making the runner out of date.",
              "the runner's own bounded walk of main, published on its heartbeat",
            ),
          ),
  };
}

/** What the runner's consistency verdict means, in one sentence for the owner. */
function verdictSentence(id: CodeIdentity | null): string {
  if (id === null) {
    return "The runner has not said which commit it is executing, so whether it is current cannot be worked out here.";
  }
  switch (id.verdict) {
    case "CONSISTENT":
      return "The runner is executing the newest commit that actually changed code. Commits above it only record observations, so it is current.";
    case "RUNNER_BEHIND_EXECUTABLE":
      return "Code has changed since the runner last restarted, so it is running older code than main holds.";
    case "RUNNER_AHEAD_OF_MAIN":
      return "The runner is executing a commit that main does not contain. Something ran that has not been merged.";
    case "RUNNER_NOT_ON_MAIN":
      return "The runner is executing a commit from outside main's history.";
    case "CANNOT_TELL":
    default:
      return "The runner could not read enough of the history to say whether it is current. That is a fact about the reading, not about the code.";
  }
}

/**
 * Build the whole read model from facts that were already written down.
 *
 * Total: every branch produces a model. A store that could not be read produces
 * a model whose queue is EMPTY AND whose `queueReadable` is false, which the
 * page renders as a named gap — never as "no builds are waiting", which is the
 * sentence a broken read would otherwise be indistinguishable from.
 */
export function buildStewardModel(input: StewardInput): StewardReadModel {
  const allRows = input.reviewRows ?? [];
  const rows = allRows.filter(isOwnerReleaseReviewRecord);
  const integrityRows = productionIntegrityHistory(allRows);
  const readable = input.reviewRows !== null;
  const order = readable ? candidatesInOrder(rows) : [];
  const rawMainSha = input.codeIdentity?.rawMainSha ?? null;
  const executableSha = input.codeIdentity?.effectiveExecutableSha ?? null;

  const queue: StewardQueueItem[] = order.map((sha, index) => {
    const mine = rowsFor(rows, sha);
    const decisions = mine.filter((r) => r.decision === "APPROVE" || r.decision === "NEEDS_CHANGES" || r.decision === "DISCARD");
    const sentBack = decisions.filter((r) => r.decision === "NEEDS_CHANGES").length;
    const state = stateOf({ rows: mine, sha, deployedSha: input.deployedSha, rawMainSha, executableSha });
    const step = nextStepOf(state);
    const ahead = index === 0 ? null : order[index - 1];
    const lifecycle = lifecycleOf({
      sha,
      decisionCount: decisions.length,
      deployedSha: input.deployedSha,
      rawMainSha,
      executableSha,
      haveIdentity: input.codeIdentity !== null,
      integrity:
        integrityRows.find((row) => sameCommit(row.productionIntegrity.deployedSha, sha)) ?? null,
    });
    const onMain = sameCommit(sha, rawMainSha) || sameCommit(sha, executableSha);
    const live = sameCommit(sha, input.deployedSha);
    return {
      stagingSha: sha,
      position: index + 1,
      state,
      nextStep: step.nextStep,
      responsible: step.responsible,
      ownerActionRequired: step.ownerActionRequired,
      ownerAction: step.ownerAction,
      dependsOn: ahead,
      dependencySays:
        ahead === null
          ? "Nothing is ahead of this one; it is the oldest build the log has recorded."
          : `Recorded after ${shortId(ahead)}, which is ahead of it on this list.`,
      blocker: blockerOf(state),
      requiredChecks: REQUIRED_CONTEXTS,
      gateState: gap(
        "OURS",
        "What the required checks said about this exact commit is written into the repository when they run, not into the control plane, so this page cannot read it. Publishing each gate run beside the commit it tested would fill this.",
      ),
      mergeResult: onMain
        ? held("This commit is what the runner last read as the head of main.")
        : gap(
            "UNKNOWABLE_NOW",
            "Whether main already contains this commit takes a git ancestry check, and a deployed site has no git. Main's head being a different commit is not the same as this one being unmerged.",
          ),
      deployResult: live
        ? held("Production was built from this commit.")
        : gap(
            "UNKNOWABLE_NOW",
            "Production was built from a different commit, which does not prove this one is absent from its history — the same ancestry check would be needed.",
          ),
      retries: measured(
        sentBack,
        Math.max(sentBack, decisions.length),
        "How many times you sent this build back, out of every decision you recorded against it.",
        "the release review log, counted per commit",
      ),
      receipt: receiptOf(mine),
      lifecycle,
      farthest: farthestReached(lifecycle),
      firstSeenAt: mine[0]?.createdAt ?? input.nowIso,
      lastActivityAt: mine[mine.length - 1]?.createdAt ?? input.nowIso,
      deployId: mine.map((r) => r.deployId).filter((d): d is string => d !== null)[0] ?? null,
      rowCount: mine.length,
      decisionCount: decisions.length,
      decisions: measured(
        decisions.length,
        mine.length,
        "Rows against this build that are decisions, out of every row it has. The rest are the console's own notes that it saw the build.",
        "the release review log, counted per commit",
      ),
    };
  });

  const open = queue.filter((item) => item.state === "AWAITING_YOUR_REVIEW" || item.state === "CHANGES_REQUESTED" || item.state === "APPROVED_FOR_PRODUCTION");
  const needing = queue.filter((item) => item.ownerActionRequired);
  const changing = rows.filter(isStateChanging).slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const newest = changing[changing.length - 1];

  return {
    nowIso: input.nowIso,
    identity: identityOf(input, queue[queue.length - 1]?.stagingSha ?? null),
    queue,
    queueDepth: measured(
      open.length,
      queue.length,
      "Builds still waiting on somebody, out of every build the review log has recorded.",
      "the release review log, one entry per commit",
    ),
    needsYou: measured(
      needing.length,
      queue.length,
      "Builds that cannot move until you decide, out of every build the review log has recorded.",
      "the release review log, one entry per commit",
    ),
    current: open[0] ?? null,
    next: open[1] ?? null,
    latestReceipt: newest
      ? held({
          recordId: newest.id,
          stagingSha: newest.stagingSha,
          kind: newest.decision,
          section: newest.section,
          at: newest.createdAt,
          actorRef: newest.actor,
        })
      : gap(
          "OURS",
          readable
            ? "No decision has been recorded against any build yet, so there is no receipt to show."
            : "The review log could not be read, so whether a receipt exists is unknown.",
        ),
    requiredChecks: REQUIRED_CONTEXTS,
    queueReadable: readable,
    queueSays: readable ? null : input.reviewDetail,
    execution: SOFTWARE_RELEASE_EXECUTION,
    waitingSays: waitingSentence(readable, open[0] ?? null),
  };
}

/** Where the release is waiting, which §11 asks to be shown plainly. */
function waitingSentence(readable: boolean, current: StewardQueueItem | null): string {
  if (!readable) {
    return "Where the release is waiting cannot be said right now, because the record of what has been reviewed could not be read.";
  }
  if (current === null) {
    return "No build is waiting. Nothing has been recorded that is part-way through.";
  }
  if (current.state === "APPROVED_FOR_PRODUCTION") {
    return `The release is waiting at the shipping door: you approved ${shortId(current.stagingSha)} and the checks and merge run on the machine, from one command.`;
  }
  if (current.state === "AWAITING_YOUR_REVIEW") {
    return `The release is waiting on you: ${shortId(current.stagingSha)} has been built and nobody has said what they think of it.`;
  }
  return `The release is waiting on the next work session: you asked for changes on ${shortId(current.stagingSha)}.`;
}

/* --------------------------------------------------------------- auditing */

/** Every number this page will print, declared so the page can audit itself. */
export function renderedNumbersOf(model: StewardReadModel): RenderedNumber[] {
  const out: RenderedNumber[] = [
    { label: "builds waiting", value: model.queueDepth.value, denominator: model.queueDepth.denominator, contract: model.queueDepth.contract },
    { label: "builds needing you", value: model.needsYou.value, denominator: model.needsYou.denominator, contract: model.needsYou.contract },
  ];
  if (model.identity.nonShippingAbove.held) {
    const m = model.identity.nonShippingAbove.value;
    out.push({
      label: "observer-only commits above the executable head",
      value: m.value,
      denominator: m.denominator,
      contract: m.contract,
    });
  }
  for (const item of model.queue) {
    out.push({
      label: `times ${shortId(item.stagingSha)} was sent back`,
      value: item.retries.value,
      denominator: item.retries.denominator,
      contract: item.retries.contract,
    });
    out.push({
      label: `decisions recorded against ${shortId(item.stagingSha)}`,
      value: item.decisions.value,
      denominator: item.decisions.denominator,
      contract: item.decisions.contract,
    });
  }
  return out;
}

/** What the headlines claim, so the page can check them against what it drew. */
export function countClaimsOf(model: StewardReadModel): CountClaim[] {
  return [
    { label: "builds on the list", stated: model.queueDepth.denominator, rendered: model.queue.length },
    { label: "required checks", stated: model.requiredChecks.length, rendered: REQUIRED_CONTEXTS.length },
    { label: "controls this console offers", stated: STEWARD_ACTIONS.length, rendered: STEWARD_ACTIONS.length },
    { label: "controls this console cannot offer", stated: UNSUPPORTED_CONTROLS.length, rendered: UNSUPPORTED_CONTROLS.length },
  ];
}
