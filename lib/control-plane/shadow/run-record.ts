/**
 * THE SHADOW RUN RECORD — what a run of the control plane leaves behind, in a
 * form a later session can REPLAY rather than believe.
 *
 * ## Why a record and not a log
 *
 * A log is what a session says happened. A record is what can be checked. The
 * difference is the whole reason this file exists as a typed artifact with a
 * writer and a renderer instead of a stream of `console.log` calls:
 *
 *   - A log is read once, by whoever was awake. This is read by the NEXT
 *     session, which was not.
 *   - A log's numbers cannot be re-derived. Every count here is accompanied by
 *     the identities it counted, so a disagreement is a diff rather than an
 *     argument.
 *   - A log is written in the order things happened. A record is written in the
 *     order a reader needs to CHECK them: what was owed, what was inherited,
 *     what was attempted, what was concluded, and — last, because it is the
 *     only line that may not be taken on trust — whether the control plane was
 *     permitted to close the obligation.
 *
 * ## SHADOW IS A PROPERTY OF THE RUN, AND IT IS RECORDED, NOT ASSUMED
 *
 * `mode` is on the record because "we ran this in shadow" is a claim, and a
 * claim about our own restraint is exactly the kind that decays. `readerImpact`
 * carries the evidence for it: the serving artifacts the run was measured
 * against, before and after, by digest. A shadow run that changed a reader
 * surface is a FINDING, and the record is shaped so that finding cannot be
 * omitted — the field is required and its `unchanged` verdict is derived from
 * the two digests rather than typed.
 *
 * ## TIME IS A PARAMETER, HERE TOO
 *
 * Nothing in this module reads a clock. `startedAt` and `endedAt` are supplied
 * by the caller, for the same reason every other library in this directory
 * refuses the clock: a record that stamps itself cannot be replayed, and a
 * replay that fails for a reason unrelated to truth teaches everyone to ignore
 * the gate (the reproducibility attack mode in the threat model).
 *
 * ## NOTHING HERE MAY CARRY A CREDENTIAL VALUE
 *
 * RULING 127. Artifacts are referenced by id, hash, tier and byte length. The
 * record never carries a body, and it never carries a header. A run record is
 * read by more eyes than an evidence vault and has no business holding either.
 */

import type { AttemptOutcome, WorkerRole } from "../attempt.ts";
import type { RefusalCode } from "../completion.ts";
import type { ArtifactTier } from "../evidence/artifact.ts";
import type { FloorOrigin } from "../preflight.ts";
import type { WorkItemState } from "../work-item.ts";
import type { Disposition, PermissionState, TransportState } from "../../workstate/types.ts";

/** The schema version of this record. A reader may refuse a shape it predates. */
export const SHADOW_RUN_RECORD_VERSION = 1;

/**
 * What the run was ALLOWED to affect.
 *
 * There are deliberately only two, and `LIVE` does not exist yet. A third mode
 * is a governance change, not a constant — the moment a run may move reader
 * truth, every clause in the completion contract stops being an exercise.
 */
export const SHADOW_RUN_MODES = [
  /** Reads real state, writes only control-plane state. No reader surface may move. */
  "SHADOW",
  /**
   * Reads real state, writes nothing at all — not even control-plane state.
   * What a `--dry-run` produces, so a run can be inspected before it persists.
   */
  "OBSERVE_ONLY",
] as const;
export type ShadowRunMode = (typeof SHADOW_RUN_MODES)[number];

/** One route on the inherited floor, as the run received it. */
export interface RecordedFloorRoute {
  readonly routeId: string;
  readonly label: string;
  readonly target: string;
  readonly origins: readonly FloorOrigin[];
  /** Offered on UNKNOWN portability rather than on evidence that it fits here. */
  readonly speculative: boolean;
}

/**
 * The floor, with the numbers that stop it being misread.
 *
 * `legacyUnclassifiedCount` is carried for the reason `describeFloor` already
 * prints it: a floor of 8 drawn from a store of 116 must not read as a store of
 * 8. A count with no denominator beside it is the coverage attack mode.
 */
export interface RecordedFloor {
  readonly routes: readonly RecordedFloorRoute[];
  readonly methodVersion: number;
  readonly legacyUnclassifiedCount: number;
  readonly jurisdiction: Readonly<Record<string, string | undefined>>;
}

/** One physical execution, as the control plane observed it from OUTSIDE. */
export interface RecordedAttempt {
  readonly attemptId: string;
  readonly routeTaskId: string;
  readonly routeId: string;
  readonly role: WorkerRole;
  /** Provider and version. Never a person, never a nickname. */
  readonly worker: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** `null` means the Attempt never closed — which is itself the observation. */
  readonly outcome: AttemptOutcome | null;
  readonly abortReason: string | null;
  readonly artifactIds: readonly string[];
  /** Measured, never estimated. `null` is unmeasured and is not zero. */
  readonly usd: number | null;
  readonly requestCount: number | null;
  /** Whether this Attempt was permitted to write a route disposition. */
  readonly mayWriteDisposition: boolean;
}

/** One artifact the run put into the evidence path. Identity only, never bytes. */
export interface RecordedArtifact {
  readonly artifactId: string;
  readonly tier: ArtifactTier;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly contentType: string;
  /** The Attempt that recorded it. This is the attribution a crash must preserve. */
  readonly attemptId: string;
  readonly methodRouteId: string;
  readonly canonicalUrl: string;
  /** Whether the durable store actually holds it, checked rather than assumed. */
  readonly durablyStored: boolean;
  /** Set when the vault refused durable storage — the tier, named. */
  readonly durabilityRefusal: string | null;
}

/** What one route task ended up saying, and whose fact it is. */
export interface RecordedRouteTask {
  readonly routeTaskId: string;
  readonly routeId: string;
  readonly routeLabel: string;
  readonly target: string;
  readonly inherited: boolean;
  readonly state: string;
  readonly disposition: Disposition | null;
  /** The Attempt that earned the disposition. Null when there is none. */
  readonly dispositionAttemptId: string | null;
  readonly permission: PermissionState | null;
  readonly transport: TransportState | null;
  readonly rawCount: number | null;
  readonly normalizedCount: number | null;
  readonly note: string | null;
  /** True while this route still owes work — including a disposed OPEN state. */
  readonly outstanding: boolean;
}

/** A validator or adversarial auditor's finding, as the contract requires it. */
export interface RecordedCheck {
  readonly kind: "VALIDATION" | "AUDIT";
  readonly id: string;
  readonly passed: boolean;
  /** For audits: whether it started outside our own summary. */
  readonly independent: boolean | null;
  readonly detail: string;
}

/**
 * WHETHER ANY READER-FACING TRUTH MOVED, evidenced by digest.
 *
 * `unchanged` is DERIVED from `before` and `after` by `assessReaderImpact`
 * below and is never typed by a caller, because "we did not change anything" is
 * precisely the claim a caller is least able to make about itself.
 */
export interface ReaderImpact {
  /** Repo-relative paths of the serving artifacts measured. */
  readonly surfaces: readonly string[];
  /** path -> sha256 hex, before the run. */
  readonly before: Readonly<Record<string, string>>;
  /** path -> sha256 hex, after the run. */
  readonly after: Readonly<Record<string, string>>;
  /** Derived. True only when every measured surface hashes identically. */
  readonly unchanged: boolean;
  /** The paths that moved. Empty when `unchanged`. */
  readonly moved: readonly string[];
}

/** The completion verdict, in the record's own vocabulary. */
export interface RecordedVerdict {
  readonly proposedState: WorkItemState;
  readonly mayComplete: boolean;
  readonly refusals: readonly { code: RefusalCode; subject: string; detail: string }[];
  readonly satisfied: readonly string[];
}

/**
 * A route the run DISCOVERED, and where it went.
 *
 * RULING 178 and the candidate lifecycle: a route found mid-walk is a
 * CANDIDATE. It is submitted, validated and admitted or rejected — it never
 * reaches canonical method knowledge by being written down. The record carries
 * the candidate id and its lifecycle so a reader can check that the route did
 * not take a shortcut.
 */
export interface RecordedDiscovery {
  readonly candidateId: string;
  readonly proposedRouteId: string;
  readonly submittingAttemptId: string;
  readonly lifecycle: string;
  /** The admitted route id, or the retained rejection reason. Never both null. */
  readonly admittedAs: string | null;
  readonly rejectedBecause: string | null;
}

export interface ShadowRunRecord {
  readonly formatVersion: typeof SHADOW_RUN_RECORD_VERSION;
  readonly runId: string;
  readonly mode: ShadowRunMode;
  readonly startedAt: string;
  readonly endedAt: string;
  /** The durable root the run's state was persisted under, so a replay finds it. */
  readonly stateRoot: string;
  readonly workItemId: string;
  readonly subject: string;
  readonly obligation: string;
  readonly floor: RecordedFloor;
  readonly routeTasks: readonly RecordedRouteTask[];
  readonly attempts: readonly RecordedAttempt[];
  readonly artifacts: readonly RecordedArtifact[];
  readonly checks: readonly RecordedCheck[];
  readonly discoveries: readonly RecordedDiscovery[];
  readonly readerImpact: ReaderImpact;
  readonly verdict: RecordedVerdict;
  /**
   * The independently-established right answer this run is measured against,
   * and where that answer comes from.
   *
   * A proving run whose only authority is itself proves nothing. Pima's
   * fourteen sittings are established by `tests/legistar-insite-union.test.ts`
   * and the InSite adapter, both of which predate the control plane and neither
   * of which the control plane may move.
   */
  readonly independentAcceptance: {
    readonly expected: number | null;
    readonly authority: string;
    readonly agrees: boolean | null;
  };
}

/**
 * Derive the reader-impact verdict from the two digest maps.
 *
 * Every surface measured before must be measured after. A surface that appears
 * in one map and not the other is a FAILED measurement, not an unchanged one —
 * a file we stopped being able to hash is exactly where a silent change would
 * hide, and "we could not check it" must never render as "it did not move".
 */
export function assessReaderImpact(input: {
  surfaces: readonly string[];
  before: Readonly<Record<string, string>>;
  after: Readonly<Record<string, string>>;
}): ReaderImpact {
  const moved: string[] = [];
  for (const surface of input.surfaces) {
    const b = input.before[surface];
    const a = input.after[surface];
    if (b === undefined || a === undefined || b !== a) moved.push(surface);
  }
  return {
    surfaces: [...input.surfaces],
    before: { ...input.before },
    after: { ...input.after },
    unchanged: moved.length === 0,
    moved,
  };
}

/**
 * What the record says out loud, for a person.
 *
 * It prints the REFUSALS in full and the satisfied clauses in full, because a
 * completion verdict that shows only its conclusion is the shape this whole
 * architecture exists to replace. It also prints the floor's denominator beside
 * the floor, and the unmeasured cost fields as `unmeasured` rather than as `0`.
 */
export function renderShadowRun(record: ShadowRunRecord): string {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("========================================================================");
  push(`SHADOW RUN ${record.runId}   mode ${record.mode}`);
  push("========================================================================");
  push(`work item        ${record.workItemId}`);
  push(`subject          ${record.subject}`);
  push(`obligation       ${record.obligation}`);
  push(`ran              ${record.startedAt} -> ${record.endedAt}`);
  push(`durable state    ${record.stateRoot}`);
  push();

  push(
    `INHERITED ROUTE FLOOR — ${record.floor.routes.length} route(s), ` +
      `method version ${record.floor.methodVersion}`,
  );
  for (const r of record.floor.routes) {
    const spec = r.speculative ? "  [SPECULATIVE — offered on UNKNOWN portability]" : "";
    push(`  ${r.routeId.padEnd(30)} ${r.origins.join("+")}${spec}`);
    push(`      ${r.label} -> ${r.target}`);
  }
  push(
    `  legacy entries whose prose is unclassified and therefore NOT inherited: ` +
      `${record.floor.legacyUnclassifiedCount}`,
  );
  push();

  const disposed = record.routeTasks.filter((t) => t.disposition !== null).length;
  const outstanding = record.routeTasks.filter((t) => t.outstanding).length;
  push(`ROUTE TASKS — ${record.routeTasks.length} total, ${disposed} disposed, ${outstanding} still owed`);
  for (const t of record.routeTasks) {
    const d = t.disposition ?? "(none)";
    const flag = t.outstanding ? "  OUTSTANDING" : "";
    push(`  ${t.routeId.padEnd(30)} ${String(d).padEnd(22)} ${t.state}${flag}`);
    if (t.note) push(`      ${t.note}`);
    if (t.permission || t.transport) {
      push(`      permission ${t.permission ?? "—"}   transport ${t.transport ?? "—"}`);
    }
    if (t.rawCount !== null || t.normalizedCount !== null) {
      push(`      raw ${t.rawCount ?? "unmeasured"}   normalized ${t.normalizedCount ?? "unmeasured"}`);
    }
  }
  push();

  push(`ATTEMPTS — ${record.attempts.length}`);
  for (const a of record.attempts) {
    const outcome = a.outcome ?? "STILL OPEN (never closed itself — observed from outside)";
    push(`  ${a.attemptId.padEnd(28)} ${a.routeId.padEnd(30)} ${outcome}`);
    if (a.abortReason) push(`      reason: ${a.abortReason}`);
    push(
      `      artifacts ${a.artifactIds.length}   ` +
        `usd ${a.usd === null ? "unmeasured" : a.usd}   ` +
        `requests ${a.requestCount === null ? "unmeasured" : a.requestCount}   ` +
        `may write disposition: ${a.mayWriteDisposition}`,
    );
  }
  push();

  push(`ARTIFACTS — ${record.artifacts.length}`);
  for (const f of record.artifacts) {
    const durable = f.durablyStored ? "durable" : `NOT DURABLE — ${f.durabilityRefusal ?? "reason unrecorded"}`;
    push(`  ${f.artifactId.padEnd(28)} ${f.tier.padEnd(18)} ${f.byteLength}B   ${durable}`);
    push(`      ${f.contentHash}  attempt ${f.attemptId}`);
  }
  push();

  if (record.discoveries.length > 0) {
    push(`ROUTES DISCOVERED MID-WALK — ${record.discoveries.length}, each through the candidate path`);
    for (const d of record.discoveries) {
      push(`  ${d.candidateId}  ${d.proposedRouteId}  ${d.lifecycle}`);
      push(`      ${d.admittedAs ? `admitted as ${d.admittedAs}` : `rejected: ${d.rejectedBecause}`}`);
    }
    push();
  }

  push(`CHECKS — ${record.checks.length}`);
  for (const c of record.checks) {
    const ind = c.independent === null ? "" : `  independent: ${c.independent}`;
    push(`  ${c.kind.padEnd(11)} ${c.id.padEnd(24)} ${c.passed ? "PASSED" : "FAILED"}${ind}`);
    push(`      ${c.detail}`);
  }
  push();

  push("READER IMPACT");
  push(`  surfaces measured: ${record.readerImpact.surfaces.length}`);
  push(
    record.readerImpact.unchanged
      ? "  UNCHANGED — every measured serving surface hashes identically before and after."
      : `  MOVED: ${record.readerImpact.moved.join(", ")}   <- a shadow run that moved reader truth is a FINDING`,
  );
  push();

  push("INDEPENDENT ACCEPTANCE");
  push(`  expected   ${record.independentAcceptance.expected ?? "not established"}`);
  push(`  authority  ${record.independentAcceptance.authority}`);
  push(
    `  agrees     ${
      record.independentAcceptance.agrees === null ? "not compared" : record.independentAcceptance.agrees
    }`,
  );
  push();

  push(`COMPLETION VERDICT — proposed ${record.verdict.proposedState}`);
  if (record.verdict.mayComplete) {
    push("  MAY COMPLETE");
  } else {
    push(`  COMPLETION REFUSED — ${record.verdict.refusals.length} reason(s):`);
    for (const r of record.verdict.refusals) {
      push(`    [${r.code}] ${r.subject}`);
      push(`        ${r.detail}`);
    }
  }
  for (const s of record.verdict.satisfied) push(`  satisfied: ${s}`);

  return lines.join("\n");
}
