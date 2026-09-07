/**
 * **A DELEGATED AGENT JOB — bounded, typed, and durable.** (ADM-C8; §3.7 and
 * §4 of the Admin C brief, 2026-09-06.)
 *
 * §4 ends with the sentence this whole module exists to obey: *"Do not build a
 * general-purpose remote shell disguised as 'AI delegation'."* A remote shell
 * takes a string and does whatever the string says. A delegated job takes a
 * frozen, hashed context, a named scope, one authority class, an explicit list
 * of what it may touch, and a stated requested output — and every one of those
 * is a required field on the record, so a job that did not declare its blast
 * radius cannot be constructed at all.
 *
 * ## The context is a hash, not a snapshot
 *
 * The brief asks for *"exact frozen context (a content hash of the snapshot,
 * not the snapshot)"*, and the reason is worth stating: the record is what
 * survives, and a record that carries the whole reviewed text is a record that
 * grows without bound and quietly becomes a second copy of the repository
 * inside the control plane. {@link freezeContext} hashes the exact bytes with
 * the same `contentHash` the artifact vault uses, so two jobs that reviewed the
 * same thing are provably comparable and a job that claims a snapshot it did
 * not read is caught by a mismatched hash.
 *
 * ## The receipt is the proof, not the toast
 *
 * §3.7: a state-changing admin action produces a durable append-only receipt,
 * and *"do not use toast messages as the only proof."* Every job carries a
 * `receiptId` derived by the gateway's own {@link receiptIdFor}, so the job row
 * and the gateway receipt are two views of one event rather than two events.
 *
 * ## What an agent may do
 *
 * An AGENT caller may only `READ_ONLY` and `PROPOSE_ONLY` through the gateway
 * (`ALLOWED_BY_CALLER` in the gateway contract). {@link assertAgentAuthority}
 * is where that stops being a comment: a job declared above `PROPOSE_ONLY` is
 * refused when it is constructed, not when it tries to do something.
 *
 * PURE. No clock, no store, no environment — the caller supplies `now` and the
 * append-only log.
 */

import {
  AGENT_JOB_FORMAT_VERSION,
  AGENT_JOB_LOG_KEY,
  latestByJob,
  type AgentJobRecord,
  type AgentJobStatus,
} from "../gateway/agent-job.ts";
import type { AuthorityClass } from "../gateway/contract.ts";
import { receiptIdFor } from "../gateway/contract.ts";
import { contentHash, fingerprint } from "../ids.ts";
import { assertAggregateOnly } from "../owner-surface.ts";
import type { AppendOnlyRepository } from "../repository/types.ts";

import { AGENT_BOUNDS, isAgentProvider, type AgentProviderId } from "./provider.ts";

/* ----------------------------------------------------------------- modes */

/**
 * The four owner modes (§4). `ASK_BOTH` and `INDEPENDENT_REVIEW` are NOT the
 * same thing and the difference is enforced in `./review.ts`, not here — this
 * list is only the vocabulary.
 */
export const AGENT_MODES = ["GPT", "CLAUDE", "ASK_BOTH", "INDEPENDENT_REVIEW"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** What each mode is, on the owner's page. */
export const MODE_WORDS: Readonly<Record<AgentMode, { readonly name: string; readonly does: string }>> = {
  GPT: { name: "Ask Codex", does: "One question to Codex, on your ChatGPT subscription." },
  CLAUDE: { name: "Ask Claude Code", does: "One bounded job for Claude Code, on your Claude subscription." },
  ASK_BOTH: {
    name: "Ask both",
    does: "Both are asked and both answers are shown side by side. This does not prove they answered independently.",
  },
  INDEPENDENT_REVIEW: {
    name: "Independent review",
    does: "Both review the same frozen snapshot separately. Neither can see the other's answer until both have finished.",
  },
};

/** Which slot in a two-reviewer job this record is. `SINGLE` for a one-provider mode. */
export const JOB_ROLES = ["SINGLE", "REVIEWER_A", "REVIEWER_B", "COMPARISON"] as const;
export type JobRole = (typeof JOB_ROLES)[number];

/**
 * Where a job got to.
 *
 * The vocabulary is the control plane's own `AgentJobStatus`, not a second one:
 * the log stores that, the gateway's live count reads that, and a bridge with a
 * private set of names would mean two answers to "is anything running". This
 * module only supplies the owner's words for each.
 */
export type JobState = AgentJobStatus;

export const JOB_STATE_WORDS: Readonly<Record<AgentJobStatus, string>> = {
  REQUESTED: "Waiting to start",
  RUNNING: "Running",
  DONE: "Finished",
  REFUSED: "Refused before anything ran",
  FAILED: "Started and did not finish",
};

/* --------------------------------------------------------------- context */

/**
 * The exact thing a job was given, identified by content rather than carried by
 * value. `describes` is what a person calls it; `hash` is what a machine
 * compares.
 */
export interface FrozenContext {
  readonly hash: string;
  readonly bytes: number;
  /** What this snapshot IS, in the owner's words: "the diff on branch X at SHA Y". */
  readonly describes: string;
  readonly frozenAt: string;
}

/**
 * Freeze a context: hash it, measure it, stamp it, and refuse one too big to be
 * a bounded job.
 *
 * The size bound is not a performance guard. A context that exceeds it is not
 * the same kind of work — it is "read the whole repository and tell me what you
 * think", which is the unbounded delegation §4 forbids.
 */
export function freezeContext(body: string, describes: string, frozenAt: string): FrozenContext {
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > AGENT_BOUNDS.maxContextBytes) {
    throw new Error(
      `freezeContext refused a ${bytes}-byte context against a ${AGENT_BOUNDS.maxContextBytes}-byte bound. ` +
        "A job whose context is larger than the bound is not a bounded job with a big input; it is an " +
        "open-ended delegation, which is the thing the Agent Bridge exists not to be.",
    );
  }
  if (describes.trim() === "") {
    throw new Error(
      "freezeContext requires a description of what was frozen. A hash with no description is an " +
        "identifier the owner cannot check anything against.",
    );
  }
  return { hash: contentHash(body), bytes, describes, frozenAt };
}

/* ------------------------------------------------------------- the record */

/** What a job may touch. Both lists are explicit; an empty list means nothing. */
export interface AllowedReach {
  /** Repository-relative paths or globs the job may read or write. */
  readonly files: readonly string[];
  /** Named systems the job may reach. Never a URL, never a command. */
  readonly systems: readonly string[];
}

/** What came back. `says` is what the owner reads; `detail` is the agent's own text. */
export interface AgentJobResult {
  readonly says: string;
  readonly detail: string;
  /** The snapshot hash the agent echoed back, so we can prove it read what it was given. */
  readonly reviewedHash: string;
}

/** Why a job was refused, in both languages. */
export interface JobRefusal {
  readonly code: string;
  readonly says: string;
}

/**
 * ONE delegated job. Every field ADM-C8 enumerates, and nothing that would make
 * it a shell.
 *
 * This is the value appended to the control plane's `agentJobs` append-only log
 * (LANE A's `AgentJobRecord`); {@link persistJob} is the only writer.
 */
export interface DelegatedAgentJob {
  readonly formatVersion: 1;
  readonly jobId: string;
  /** Null only on a `COMPARISON` row, which no provider ran. */
  readonly provider: AgentProviderId | null;
  readonly mode: AgentMode;
  readonly role: JobRole;
  readonly context: FrozenContext;
  /** What this job is about, in one line: the PR, the decision, the module. */
  readonly scope: string;
  readonly authority: AuthorityClass;
  readonly allowed: AllowedReach;
  /** What we asked it to produce, stated before it ran. */
  readonly requestedOutput: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly state: JobState;
  readonly result: AgentJobResult | null;
  /** Set only when the job wrote code. Never a merge, never a deploy. */
  readonly producedBranch: string | null;
  readonly producedPullRequest: string | null;
  readonly refusal: JobRefusal | null;
  /** The gateway receipt this job belongs to (§3.7). */
  readonly receiptId: string;
  /** One plain sentence for the list row. */
  readonly says: string;
}

/**
 * The append-only log this module writes through: the control plane's own
 * `agentJobs`, typed as the canonical `AppendOnlyRepository` so
 * `repos.agentJobs` satisfies it directly. There is no second persistence
 * mechanism beside the repositories (RULING 220).
 */
export type AgentJobLog = AppendOnlyRepository<AgentJobRecord>;

/**
 * The `provider` a COMPARISON row carries.
 *
 * `AgentJobRecord.provider` is a non-null string, and the comparison row is the
 * one job no provider ran — the console put two finished answers side by side.
 * A literal beats an empty string, which would read as a provider whose name we
 * lost. It never reaches the face: {@link fromAgentJobRecord} maps it back to
 * null and the page renders a sentence.
 */
export const COMPARISON_PROVIDER = "CONSOLE";

/** The version of the bridge's own field bag inside `AgentJobRecord.extra`. */
export const AGENT_BRIDGE_EXTRA_VERSION = 1;

/**
 * A job's id: a pure function of what makes it that job.
 *
 * Derived rather than assigned, for the same two reasons every other control-
 * plane id is (`lib/control-plane/ids.ts`): a retried submission collides with
 * the original instead of forking it, and a replay of the same inputs computes
 * the same identity.
 */
export function agentJobId(input: {
  readonly mode: AgentMode;
  readonly role: JobRole;
  readonly provider: AgentProviderId | null;
  readonly contextHash: string;
  readonly scope: string;
  readonly startedAt: string;
}): string {
  return `aj-${fingerprint([input.mode, input.role, input.provider, input.contextHash, input.scope, input.startedAt])}`;
}

/**
 * An agent may read and it may propose. It may not ship.
 *
 * The gateway's `ALLOWED_BY_CALLER` already says so for an AGENT caller; this
 * makes it true at construction time, where it is cheap to enforce, rather than
 * at execution time, where a mistake has already happened. `CODE_CHANGE` is
 * refused here deliberately: a delegated job may WRITE a branch as its result,
 * but the authority it carries into the gateway is still `PROPOSE_ONLY`,
 * because a branch is a proposal and merging it is the Steward's job (§3.8).
 */
export function assertAgentAuthority(authority: AuthorityClass, scope: string): void {
  if (authority === "READ_ONLY" || authority === "PROPOSE_ONLY") return;
  throw new Error(
    `A delegated agent job for "${scope}" declared the authority ${authority}. An agent may only read ` +
      "and propose: anything that ships is the Integration Steward's, and an agent that could ship " +
      "would be a remote shell with a nicer name.",
  );
}

/** Everything needed to open a job, before anything has run. */
export interface OpenJobInput {
  readonly mode: AgentMode;
  readonly role: JobRole;
  readonly provider: AgentProviderId | null;
  readonly context: FrozenContext;
  readonly scope: string;
  readonly authority: AuthorityClass;
  readonly allowed: AllowedReach;
  readonly requestedOutput: string;
  readonly startedAt: string;
  readonly idempotencyKey: string;
}

/**
 * Open a job in `RUNNING`. Nothing has come back yet, so `result`, both code
 * fields and `refusal` are null and the state says so — a record that starts
 * life describing an outcome it does not have is the shape of a lie.
 */
export function openJob(input: OpenJobInput): DelegatedAgentJob {
  assertAgentAuthority(input.authority, input.scope);
  if (input.requestedOutput.trim() === "") {
    throw new Error(
      `A delegated agent job for "${input.scope}" stated no requested output. A job with no stated ` +
        "output cannot be judged complete, so it can never honestly finish.",
    );
  }
  const jobId = agentJobId({
    mode: input.mode,
    role: input.role,
    provider: input.provider,
    contextHash: input.context.hash,
    scope: input.scope,
    startedAt: input.startedAt,
  });
  return {
    formatVersion: 1,
    jobId,
    provider: input.provider,
    mode: input.mode,
    role: input.role,
    context: input.context,
    scope: input.scope,
    authority: input.authority,
    allowed: { files: [...input.allowed.files], systems: [...input.allowed.systems] },
    requestedOutput: input.requestedOutput,
    startedAt: input.startedAt,
    completedAt: null,
    state: "RUNNING",
    result: null,
    producedBranch: null,
    producedPullRequest: null,
    refusal: null,
    receiptId: receiptIdFor(`agent.${input.mode.toLowerCase()}`, input.idempotencyKey),
    says: `${MODE_WORDS[input.mode].name} — ${input.scope}. Started, nothing back yet.`,
  };
}

/** Close a job that finished, with what it produced. */
export function completeJob(
  job: DelegatedAgentJob,
  result: AgentJobResult,
  completedAt: string,
  produced?: { readonly branch?: string | null; readonly pullRequest?: string | null },
): DelegatedAgentJob {
  return {
    ...job,
    completedAt,
    state: "DONE",
    result,
    producedBranch: produced?.branch ?? null,
    producedPullRequest: produced?.pullRequest ?? null,
    says: `${MODE_WORDS[job.mode].name} — ${job.scope}. ${result.says}`,
  };
}

/**
 * Close a job that was refused before anything ran.
 *
 * A refusal is the honest ending the brief asks for when a provider is
 * unavailable: the bridge and its contract are proven, and nothing claims a
 * completion that did not happen. `result` stays null, because there is no
 * result — a refusal is not an empty answer.
 */
export function refuseJob(job: DelegatedAgentJob, refusal: JobRefusal, at: string): DelegatedAgentJob {
  return {
    ...job,
    completedAt: at,
    state: "REFUSED",
    result: null,
    refusal,
    says: `${MODE_WORDS[job.mode].name} — ${job.scope}. ${refusal.says}`,
  };
}

/** Close a job that started and did not finish. Distinct from a refusal, on purpose. */
export function failJob(job: DelegatedAgentJob, why: string, at: string): DelegatedAgentJob {
  return {
    ...job,
    completedAt: at,
    state: "FAILED",
    result: null,
    refusal: { code: "AGENT_JOB_DID_NOT_FINISH", says: why },
    says: `${MODE_WORDS[job.mode].name} — ${job.scope}. ${why}`,
  };
}

/**
 * The record id ONE append lands under.
 *
 * This is not the job id, and the difference matters. A job is opened RUNNING
 * and closed COMPLETED, REFUSED or FAILED, and the log is append-only: the
 * store checks idempotency by (log key, record id) and throws
 * `AppendOnlyViolation` when the SAME record id arrives carrying DIFFERENT
 * bytes. Appending both states under the job id would therefore throw on the
 * close — and appending only the close would lose every job that died before
 * it, which is exactly the job you most want a record of.
 *
 * So each TRANSITION is its own immutable row, the way an owner decision's
 * `#resolved` twin is: `<job>:<state>:<moment>`. A true retry of the same
 * transition is byte-identical and idempotent; a later transition is a new row
 * beside the old one; nothing is ever rewritten.
 */
export function jobRecordId(job: DelegatedAgentJob): string {
  return `${job.jobId}:${job.state}:${job.completedAt ?? job.startedAt}`;
}

/**
 * The bridge's job, as the control plane stores it.
 *
 * `AgentJobRecord` names the eleven things the whole console asks about a job —
 * what is running, who is running it, on what, since when, is it finished,
 * what came out, and where is the proof — and puts everything a particular
 * bridge needs in `extra`, an opaque bag the gateway never reads. That boundary
 * is the point: the bridge's own vocabulary lives in the bag and can never be
 * mistaken for something the gateway understands.
 *
 * `resultDigest` is a hash, never the output: the record stays auditable
 * without the control plane becoming a copy of everything an agent ever wrote.
 */
export function toAgentJobRecord(job: DelegatedAgentJob): AgentJobRecord {
  const record: AgentJobRecord = {
    formatVersion: AGENT_JOB_FORMAT_VERSION,
    jobId: job.jobId,
    provider: job.provider ?? COMPARISON_PROVIDER,
    mode: job.mode,
    status: job.state,
    subject: job.scope,
    requestedAt: job.startedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    resultDigest: job.result === null ? null : contentHash(job.result.detail),
    receiptId: job.receiptId,
    extra: {
      bridge: AGENT_BRIDGE_EXTRA_VERSION,
      role: job.role,
      context: job.context,
      authority: job.authority,
      allowed: job.allowed,
      requestedOutput: job.requestedOutput,
      result: job.result,
      producedBranch: job.producedBranch,
      producedPullRequest: job.producedPullRequest,
      refusal: job.refusal,
      says: job.says,
    },
  };
  /*
   * The owner reading his own console is a rendering like any other (RULING
   * 226), so the aggregate-only boundary is checked at write time here as it is
   * on every other admin append. It is not a formality: `result.detail` is
   * agent-written text, and a field name from the reader stores appearing
   * anywhere three objects down would be refused rather than stored.
   */
  assertAggregateOnly(record, "the delegated-agent job log");
  return record;
}

/**
 * Read one stored record back as the bridge's job, or null when it is not one.
 *
 * Null rather than a partly-filled job: a record whose bag this bridge does not
 * recognise is a job whose state we cannot read, and a caller must report that
 * as an unread row rather than let it quietly leave the population. That is the
 * same discipline `liveJobCount`'s `unreadable` counter exists for.
 */
export function fromAgentJobRecord(record: AgentJobRecord): DelegatedAgentJob | null {
  const extra = record.extra as Record<string, unknown>;
  if (extra?.bridge !== AGENT_BRIDGE_EXTRA_VERSION) return null;
  const role = extra.role;
  const context = extra.context as FrozenContext | undefined;
  if (!JOB_ROLES.includes(role as JobRole) || context === undefined || typeof context.hash !== "string") return null;
  if (!AGENT_MODES.includes(record.mode as AgentMode)) return null;
  const provider = record.provider === COMPARISON_PROVIDER ? null : record.provider;
  if (provider !== null && !isAgentProvider(provider)) return null;
  const allowed = (extra.allowed ?? { files: [], systems: [] }) as AllowedReach;
  return {
    formatVersion: 1,
    jobId: record.jobId,
    provider,
    mode: record.mode as AgentMode,
    role: role as JobRole,
    context,
    scope: record.subject,
    authority: extra.authority as AuthorityClass,
    allowed: { files: allowed.files ?? [], systems: allowed.systems ?? [] },
    requestedOutput: typeof extra.requestedOutput === "string" ? extra.requestedOutput : "",
    startedAt: record.startedAt ?? record.requestedAt,
    completedAt: record.completedAt,
    state: record.status,
    result: (extra.result ?? null) as AgentJobResult | null,
    producedBranch: (extra.producedBranch ?? null) as string | null,
    producedPullRequest: (extra.producedPullRequest ?? null) as string | null,
    refusal: (extra.refusal ?? null) as JobRefusal | null,
    receiptId: record.receiptId ?? "",
    says: typeof extra.says === "string" ? extra.says : "",
  };
}

/** Append one transition of a job to the log. */
export async function persistJob(log: AgentJobLog, job: DelegatedAgentJob, now: string): Promise<void> {
  await log.append(AGENT_JOB_LOG_KEY, jobRecordId(job), toAgentJobRecord(job), now);
}

/**
 * Jobs of one provider that started and have not ended. The capacity numerator.
 *
 * Folded through the control plane's own `latestByJob` first, because the log
 * holds every transition: an unfolded count would see a finished job's opening
 * row and report the provider busy forever.
 */
export function inFlightFor(jobs: readonly DelegatedAgentJob[], provider: AgentProviderId): number {
  return latestByJob(jobs).filter((j) => j.provider === provider && (j.state === "RUNNING" || j.state === "REQUESTED")).length;
}

/** The most recent job for a provider, by start time, at its current state. */
export function latestFor(jobs: readonly DelegatedAgentJob[], provider: AgentProviderId): DelegatedAgentJob | null {
  const mine = latestByJob(jobs).filter((j) => j.provider === provider);
  if (mine.length === 0) return null;
  return mine.reduce((best, j) => (j.startedAt > best.startedAt ? j : best));
}
