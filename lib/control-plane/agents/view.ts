/**
 * **WHAT THE AGENT BRIDGE PAGE SHOWS, COMPUTED WITHOUT A DATABASE.**
 * (ADM-C8 and ADM-C9; §9A.1 and §9A.2 of the Admin C brief, 2026-09-06.)
 *
 * The page is a projection and this module is the projection. It takes what was
 * read (or the named reason it could not be), and returns the exact rows and
 * sentences the page renders — so the surface can be tested by `node --test`,
 * which cannot import a `.tsx`, and so the page itself holds no arithmetic and
 * no branching about what a state means.
 *
 * Two rules from the render law shape every field here:
 *
 *   - **Absence is argued, never asserted.** A store that could not be reached
 *     and a store that holds nothing are different facts and get different
 *     sentences with different owners: `UNKNOWABLE_NOW` for "we could not ask",
 *     `OURS` for "we asked and there is nothing yet". Neither becomes a zero.
 *   - **Stated N equals rendered rows.** The list is capped, and the cap is a
 *     `Measured` — shown OF recorded — so the number over the table is the
 *     length of the array under it and says what it is out of.
 *
 * PURE. No clock, no store, no environment; `readAgentBridge` in `./read.ts`
 * does the asking and hands the answer here.
 */

import { latestByJob } from "../gateway/agent-job.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import { gap, held, measured, type Held, type Measured } from "../owner-surface.ts";

import {
  JOB_STATE_WORDS,
  MODE_WORDS,
  inFlightFor,
  latestFor,
  type AgentMode,
  type DelegatedAgentJob,
  type FrozenContext,
  type JobRole,
  type JobState,
} from "./job.ts";
import {
  AGENT_PROVIDERS,
  PROVIDER_WORDS,
  apiFallbackPolicy,
  describeProvider,
  unobservedFromWeb,
  type AgentProviderDescriptor,
  type AgentProviderId,
  type ApiFallbackPolicy,
  type LatestError,
  type LatestTask,
  type ObservationPoint,
  type ProviderProbe,
} from "./provider.ts";
import type { IsolationProof, ReviewComparison } from "./review.ts";

/** How many jobs the list shows. The rest are still recorded and still counted. */
export const JOBS_SHOWN = 25;

/** The console path this page lives at, for the buttons that come back to it. */
export const AGENTS_PAGE_PATH = "/admin/agents";

/** The subject a decision recorded against one review carries, so it can be read back. */
export const REVIEW_DECISION_SUBJECT_PREFIX = "agent-review:";

export function reviewDecisionSubject(reviewId: string): string {
  return `${REVIEW_DECISION_SUBJECT_PREFIX}${reviewId}`;
}

/* ------------------------------------------------------------------ rows */

/** One job, as the table renders it. Every raw form is here for the hover, none of it leads. */
export interface JobRow {
  readonly jobId: string;
  readonly shortId: string;
  readonly mode: AgentMode;
  readonly modeName: string;
  readonly role: JobRole;
  readonly providerName: string | null;
  readonly scope: string;
  readonly state: JobState;
  readonly stateWords: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly says: string;
  readonly snapshotHash: string;
  readonly snapshotShort: string;
  readonly snapshotDescribes: string;
  readonly authority: string;
  readonly allowedFiles: readonly string[];
  readonly allowedSystems: readonly string[];
  readonly requestedOutput: string;
  readonly producedBranch: string | null;
  readonly producedPullRequest: string | null;
  readonly refusalSays: string | null;
  readonly receiptId: string;
}

/** A decision the owner recorded against a review. */
export interface ReviewDecision {
  readonly chose: string;
  readonly inHisWords: string | null;
  readonly decidedAt: string;
}

/** One seat of a two-reviewer run, as the page renders it. */
export interface SeatRow {
  readonly slot: string;
  readonly providerName: string;
  readonly state: JobState;
  readonly stateWords: string;
  readonly says: string;
  readonly jobId: string;
}

/** One two-provider run: what was reviewed, by whom, and what it came to. */
export interface ReviewRow {
  readonly reviewId: string;
  readonly mode: "INDEPENDENT_REVIEW" | "ASK_BOTH";
  readonly modeName: string;
  /** True only for INDEPENDENT_REVIEW. ASK_BOTH may never be described as independent. */
  readonly independent: boolean;
  readonly scope: string;
  readonly asked: string;
  readonly snapshot: FrozenContext;
  readonly snapshotShort: string;
  readonly startedAt: string;
  readonly seats: readonly SeatRow[];
  readonly comparison: Held<ReviewComparison>;
  readonly isolation: Held<IsolationProof>;
  readonly decision: Held<ReviewDecision>;
  readonly says: string;
  readonly needsYou: boolean;
  readonly needsYouAction: string | null;
}

/** What the page is handed, once the reading is done. */
export interface AgentBridgeInput {
  readonly observedFrom: ObservationPoint;
  readonly at: string;
  /**
   * The delegated-job log as this bridge could read it, or the named reason it
   * is not here. `unreadable` counts rows another writer put in the same log:
   * they are not this bridge's jobs and they are not nothing either.
   */
  readonly jobs: Held<{ readonly jobs: readonly DelegatedAgentJob[]; readonly unreadable: number }>;
  /** The owner's operational policy, or null when none is recorded. Null is OFF. */
  readonly config: AdminConfig | null;
  /** One probe per provider, taken on the runner host. Absent on the website, by nature. */
  readonly probes: Held<readonly ProviderProbe[]>;
  /**
   * Owner decisions whose subject names a review, or the named reason the
   * decision log could not be read. Held, not a bare array: an empty list means
   * "he decided nothing", and a failed read must never say that for him.
   */
  readonly decisions: Held<readonly { readonly subjectId: string; readonly chosenOption: string; readonly ownerAnswer: string | null; readonly decidedAt: string }[]>;
}

/** The whole page. */
export interface AgentBridgeView {
  readonly observedFrom: ObservationPoint;
  readonly at: string;
  readonly fallback: ApiFallbackPolicy;
  readonly providers: readonly AgentProviderDescriptor[];
  readonly jobs: Held<readonly JobRow[]>;
  /** Jobs shown OF jobs recorded. The number over the table is the length of the array under it. */
  readonly jobCount: Held<Measured>;
  readonly reviews: Held<readonly ReviewRow[]>;
  readonly reviewCount: Held<Measured>;
  /**
   * Rows in the shared job log this page could not read, and the sentence that
   * says so. Never folded into the counts above: a row we cannot read is not a
   * job that did not happen.
   */
  readonly unreadableRows: number;
  readonly unreadableSays: string | null;
  /** The whole page in one sentence, for the top of it. */
  readonly happened: string;
  readonly next: string;
  readonly needsYou: boolean;
  readonly needsYouAction: string | null;
}

/* -------------------------------------------------------------- helpers */

/** A hash the owner can recognise without reading 64 characters of it. */
export function shortHash(hash: string): string {
  const bare = hash.startsWith("sha256-") ? hash.slice(7) : hash;
  return bare.slice(0, 12);
}

function jobRow(job: DelegatedAgentJob): JobRow {
  return {
    jobId: job.jobId,
    shortId: job.jobId.slice(0, 11),
    mode: job.mode,
    modeName: MODE_WORDS[job.mode].name,
    role: job.role,
    providerName: job.provider === null ? null : PROVIDER_WORDS[job.provider].name,
    scope: job.scope,
    state: job.state,
    stateWords: JOB_STATE_WORDS[job.state],
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    says: job.says,
    snapshotHash: job.context.hash,
    snapshotShort: shortHash(job.context.hash),
    snapshotDescribes: job.context.describes,
    authority: job.authority,
    allowedFiles: job.allowed.files,
    allowedSystems: job.allowed.systems,
    requestedOutput: job.requestedOutput,
    producedBranch: job.producedBranch,
    producedPullRequest: job.producedPullRequest,
    refusalSays: job.refusal === null ? null : job.refusal.says,
    receiptId: job.receiptId,
  };
}

/**
 * The latest job for a provider, as the card's "latest task" line.
 *
 * The outcome is the state in words rather than the state, because the card is
 * read by someone who does not know what `REFUSED` means to this codebase.
 */
function latestTaskOf(jobs: readonly DelegatedAgentJob[], provider: AgentProviderId): LatestTask | null {
  const job = latestFor(jobs, provider);
  if (job === null) return null;
  return { jobId: job.jobId, says: job.scope, at: job.startedAt, outcome: JOB_STATE_WORDS[job.state] };
}

/** The most recent job of a provider that ended badly. Absence of one is not "nothing went wrong". */
function latestErrorOf(jobs: readonly DelegatedAgentJob[], provider: AgentProviderId): LatestError | null {
  const bad = jobs.filter((j) => j.provider === provider && (j.state === "FAILED" || j.state === "REFUSED") && j.refusal !== null);
  if (bad.length === 0) return null;
  const last = bad.reduce((best, j) => (j.startedAt > best.startedAt ? j : best));
  return {
    at: last.completedAt === null ? last.startedAt : last.completedAt,
    says: last.refusal === null ? last.says : last.refusal.says,
    raw: last.refusal === null ? last.state : last.refusal.code,
  };
}

/**
 * Read a comparison back out of the COMPARISON job's detail.
 *
 * The detail is written by `runIndependentReview` as JSON, and a page that
 * `JSON.parse`s a stored string without a guard renders a blank card when the
 * string is anything else. A detail that cannot be read is a gap of ours with a
 * sentence, not an empty comparison that reads as "they agreed on nothing".
 */
export function parseComparisonDetail(detail: string): Held<{ readonly comparison: ReviewComparison; readonly isolation: IsolationProof }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return gap("OURS", "The comparison for this review was recorded in a form this page could not read, so nothing is shown rather than a guess.");
  }
  const obj = parsed as { comparison?: unknown; isolation?: unknown };
  const comparison = obj?.comparison as ReviewComparison | undefined;
  const isolation = obj?.isolation as IsolationProof | undefined;
  if (comparison === undefined || isolation === undefined || !Array.isArray(comparison.agreements) || !Array.isArray(comparison.disagreements)) {
    return gap("OURS", "The comparison for this review is missing the agreements, the disagreements or the isolation check, so it is not shown as one.");
  }
  return held({ comparison, isolation });
}

/**
 * Group the job log into two-provider runs.
 *
 * A run is the jobs sharing a mode, a scope and a frozen-snapshot hash — which
 * is exactly what `runIndependentReview` writes, because both seats and the
 * comparison are opened against one `freezeContext` result. Grouping on the
 * hash rather than on a stored review id means a run is reconstructable from
 * the log alone, with no second index to fall out of step with it.
 */
export function groupReviews(
  jobs: readonly DelegatedAgentJob[],
  decisions: AgentBridgeInput["decisions"],
): readonly ReviewRow[] {
  const groups = new Map<string, DelegatedAgentJob[]>();
  // The log holds every transition of every job. Grouping the raw rows would
  // give a run four seats — each reviewer's opening row and its closing one.
  for (const job of latestByJob(jobs)) {
    if (job.mode !== "INDEPENDENT_REVIEW" && job.mode !== "ASK_BOTH") continue;
    const key = `${job.mode}${job.scope}${job.context.hash}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [job]);
    else bucket.push(job);
  }

  const rows: ReviewRow[] = [];
  for (const bucket of groups.values()) {
    const mode = bucket[0].mode as "INDEPENDENT_REVIEW" | "ASK_BOTH";
    const independent = mode === "INDEPENDENT_REVIEW";
    const snapshot = bucket[0].context;
    const reviewId = `${independent ? "ir" : "ab"}-${shortHash(snapshot.hash)}`;
    const seatJobs = bucket.filter((j) => j.role === "REVIEWER_A" || j.role === "REVIEWER_B");
    const seats: SeatRow[] = seatJobs
      .slice()
      .sort((x, y) => x.role.localeCompare(y.role))
      .map((j) => ({
        slot: j.role === "REVIEWER_A" ? "First reviewer" : "Second reviewer",
        providerName: j.provider === null ? "Not recorded" : PROVIDER_WORDS[j.provider].name,
        state: j.state,
        stateWords: JOB_STATE_WORDS[j.state],
        says: j.refusal === null ? (j.result === null ? j.says : j.result.says) : j.refusal.says,
        jobId: j.jobId,
      }));

    const comparisonJob = bucket.find((j) => j.role === "COMPARISON" && j.result !== null);
    const read = comparisonJob === undefined || comparisonJob.result === null ? null : parseComparisonDetail(comparisonJob.result.detail);

    let comparison: Held<ReviewComparison>;
    let isolation: Held<IsolationProof>;
    if (read === null) {
      const why = seats.every((s) => s.state === "DONE")
        ? "Both reviewers finished and no comparison was recorded. Nothing is shown, because one answer set against nothing would read as agreement."
        : "The two answers were never put side by side, because one of the reviewers did not finish.";
      comparison = gap("OURS", why);
      isolation = gap(
        "OURS",
        independent
          ? "There is no comparison for this run, so there is nothing to check for independence."
          : "This mode does not prove independence. Both were asked; nothing here says they answered separately.",
      );
    } else if (read.held) {
      comparison = held(read.value.comparison);
      isolation = independent
        ? held(read.value.isolation)
        : gap("UNKNOWABLE_NOW", "This mode does not prove independence. Both were asked and both answered; nothing here says they answered without seeing each other.");
    } else {
      comparison = read;
      isolation = gap("OURS", read.gap.says);
    }

    const recorded = decisions.held ? decisions.value.filter((d) => d.subjectId === reviewDecisionSubject(reviewId)) : [];
    let decision: Held<ReviewDecision>;
    if (!decisions.held) {
      decision = gap("UNKNOWABLE_NOW", decisions.gap.says);
    } else if (recorded.length === 0) {
      decision = gap("OURS", "You have not recorded a decision about this review.");
    } else {
      const last = recorded.reduce((best, d) => (d.decidedAt > best.decidedAt ? d : best));
      decision = held({ chose: last.chosenOption, inHisWords: last.ownerAnswer, decidedAt: last.decidedAt });
    }

    // Only ask for a decision when we KNOW there is none. A decision log we
    // could not read is not a decision he failed to make.
    const disagreed = comparison.held && comparison.value.disagreements.length > 0;
    const knownUndecided = !decision.held && decision.gap.whose === "OURS";
    const needsYouAction = disagreed && knownUndecided
      ? "read the points they disagreed on and record what you want done"
      : null;

    rows.push({
      reviewId,
      mode,
      modeName: MODE_WORDS[mode].name,
      independent,
      scope: bucket[0].scope,
      asked: bucket[0].requestedOutput,
      snapshot,
      snapshotShort: shortHash(snapshot.hash),
      startedAt: bucket.reduce((earliest, j) => (j.startedAt < earliest ? j.startedAt : earliest), bucket[0].startedAt),
      seats,
      comparison,
      isolation,
      decision,
      says: comparison.held ? comparison.value.says : comparison.gap.says,
      needsYou: needsYouAction !== null,
      needsYouAction,
    });
  }
  return rows.slice().sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1));
}

/* ------------------------------------------------------------- the view */

/**
 * Build the whole page.
 *
 * The provider cards come from probes when there are probes and from
 * {@link unobservedFromWeb} when there are not — the website has no way to look
 * at the runner machine, and a card that filled itself in anyway would be the
 * "fake green" the render law forbids.
 */
export function buildAgentBridgeView(input: AgentBridgeInput): AgentBridgeView {
  const fallback = apiFallbackPolicy(input.config);
  // Collapsed once, here, so every count below is about jobs rather than about
  // rows: the log records each transition and a job appears in it more than
  // once.
  const jobs = input.jobs.held ? latestByJob(input.jobs.value.jobs) : [];

  const probeFor = new Map<AgentProviderId, ProviderProbe>();
  if (input.probes.held) for (const p of input.probes.value) probeFor.set(p.provider, p);

  const providers = AGENT_PROVIDERS.map((provider) => {
    const probe = probeFor.get(provider);
    if (probe === undefined) return unobservedFromWeb(provider, fallback, input.at);
    return describeProvider({
      probe,
      fallback,
      inFlight: inFlightFor(jobs, provider),
      latestTask: latestTaskOf(jobs, provider),
      latestError: latestErrorOf(jobs, provider),
    });
  });

  const rows = jobs
    .slice()
    .sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1))
    .map(jobRow);
  const shown = rows.slice(0, JOBS_SHOWN);

  const jobsHeld: Held<readonly JobRow[]> = input.jobs.held ? held(shown) : gap("UNKNOWABLE_NOW", input.jobs.gap.says);
  const jobCount: Held<Measured> = input.jobs.held
    ? held(
        measured(
          shown.length,
          rows.length,
          "Delegated jobs listed here, out of every job recorded in the log. Nothing is filtered out; the list is capped and the rest are older.",
          "the delegated-job log in the control plane, counted at read",
        ),
      )
    : gap("UNKNOWABLE_NOW", input.jobs.gap.says);

  const reviewRows = input.jobs.held ? groupReviews(jobs, input.decisions) : [];
  const reviews: Held<readonly ReviewRow[]> = input.jobs.held ? held(reviewRows) : gap("UNKNOWABLE_NOW", input.jobs.gap.says);
  const reviewCount: Held<Measured> = input.jobs.held
    ? held(
        measured(
          reviewRows.length,
          reviewRows.length,
          "Two-provider runs reconstructed from the job log. Every one of them is shown.",
          "the delegated-job log, grouped by mode, subject and frozen snapshot",
        ),
      )
    : gap("UNKNOWABLE_NOW", input.jobs.gap.says);

  const ready = providers.filter((p) => p.canRunNow);
  const waiting = providers.filter((p) => p.needsYou);
  const happened = input.observedFrom === "WEB_FUNCTION"
    ? "Nothing about the two agent providers was checked from this website. The jobs below are the durable record of what they were asked to do."
    : ready.length === providers.length
      ? "Both providers start on the runner machine and both have a saved sign-in."
      : `${ready.length} of ${providers.length} providers can take a job right now.`;
  const next = fallback.enabled
    ? "Paid API spending is on: a job a subscription cannot take will be billed per use."
    : "Paid API spending is off: a job a subscription cannot take is refused and told to you, never billed.";

  const unreadableRows = input.jobs.held ? input.jobs.value.unreadable : 0;
  return {
    observedFrom: input.observedFrom,
    at: input.at,
    fallback,
    providers,
    jobs: jobsHeld,
    jobCount,
    reviews,
    reviewCount,
    unreadableRows,
    unreadableSays:
      unreadableRows === 0
        ? null
        : `${unreadableRows} row${unreadableRows === 1 ? "" : "s"} in this log ${unreadableRows === 1 ? "was" : "were"} written by something other than the agent bridge. ` +
          "They are not counted above and they are not being called nothing — this page simply cannot read them.",
    happened,
    next,
    needsYou: waiting.length > 0,
    needsYouAction: waiting.length === 0 ? null : waiting.map((p) => p.needsYouAction).filter((a): a is string => a !== null).join("; "),
  };
}
