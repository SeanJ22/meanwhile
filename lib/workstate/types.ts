/**
 * Canonical multi-session work state.
 *
 * ## What this replaces
 *
 * A prose report at the end of a session, plus a command that rebuilds a
 * frontier from seeds. The descent session of 2026-08-26 persisted
 * `states/<state>/descent.json` carrying per-level COUNTS — `found`, `followed`,
 * `yielded`, `candidatesNew`, and `finalPassNewLinks: 1986` — and nothing else.
 * Measured at that HEAD: no `edges` array, no cursor, no queue. **The number of
 * outstanding edges was persisted. The edges were not.**
 *
 * So resuming meant re-walking seeds to rediscover work the previous session had
 * already found, and "exact resume cursor" meant a command line. RULING 181:
 * a frontier is state, not a recipe for recreating state.
 *
 * ## The three separations this file exists to enforce
 *
 * 1. **Session status is not workstream status is not graph status.**
 * 2. **Permission state is not transport state.**
 * 3. **A candidate is not a body.**
 *
 * Each was a real conflation with a measured cost, and none of them can be
 * fixed by a rule that asks a session to be careful.
 */

/** ---------------------------------------------------------------- statuses */

/**
 * Session status — FIVE states, because "was the state preserved?" and "was
 * there a legitimate reason to stop?" are two independent questions.
 *
 * **The context-percentage model this replaces was fiction** (RULING 189,
 * 2026-08-27). It asked the model for `context_used_percent` and
 * `context_remaining_percent` and then classified from them. The model does not
 * possess that measurement: a session reported ~4% used while the interface it
 * was running inside displayed roughly 47%, and the classifier believed the
 * number because a number was all it was given.
 *
 * A guessed quantity dressed as a measurement is worse than no quantity at all.
 * It made a status that reads as success purchasable with an estimate, and it
 * gave a session a reason to think about its own capacity instead of about the
 * work.
 *
 * So there is no threshold here, and no proxy for one. **A session stops when
 * the authorized work is done, when the author stops or redirects it, or when
 * something outside it actually prevents continuing.** Nothing else is a
 * reason, and the fourth state is the one that says so out loud.
 */
export const SESSION_STATUSES = [
  /** The authorized work actually satisfies its completion rules. */
  "COMPLETE",
  /** The author explicitly stopped, redirected or narrowed the session. */
  "CLEAN_HANDOFF_AUTHOR_STOP",
  /** An actual external condition prevented continued authorized work. */
  "CLEAN_HANDOFF_EXTERNAL_STOP",
  /** Stopped voluntarily with authorized executable work still owed. */
  "EARLY_HANDOFF",
  /** Canonical state, remainder, shipping state or accounting is missing. */
  "FAILED_CLOSEOUT",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * Stated reasons that are NOT reasons, and the mechanical refusal of each.
 *
 * Both entries name a specific way this repository has already stopped a
 * session early while believing it had a justification.
 *
 * 1. **Self-estimated capacity.** The removed model's whole content. A session
 *    cannot measure its own context, so a stop reason that appeals to context
 *    used, context remaining, a percentage, a token budget or an imminent
 *    compaction is appealing to a guess. It never qualifies a clean stop, and
 *    naming a different arbitrary proxy — elapsed minutes, message counts,
 *    command counts, commit counts, a work quota, fatigue — is the same defect
 *    with a new unit.
 *
 * 2. **Merge cadence.** The preceding descent session stopped because "one
 *    planned merge per session (RULING 1), now taken" — while executable work
 *    remained. RULING 1 governs SHIPPING cadence: verify locally, accumulate,
 *    ship once. It says nothing about how long a session runs. **The planned
 *    merge having happened is not a reason to stop; the answer is to delay the
 *    merge until the session is actually ready to end.**
 *
 * This is deliberately narrow. It disqualifies a stated reason from making a
 * stop CLEAN; it never blocks a close, and it never touches `COMPLETE` or
 * `FAILED_CLOSEOUT`, which are derived from state rather than from prose.
 */
export const NON_REASONS: ReadonlyArray<{ name: string; pattern: RegExp; why: string }> = [
  {
    name: "self-estimated capacity",
    pattern:
      /context (?:used|remaining|left|budget|window|limit|capacity|pressure)|\d+\s*%[^.]{0,24}context|(?:running |getting )?low on context|token budget|compact(?:ion|ing)|out of (?:context|tokens)|elapsed (?:time|minutes)|message count|command count|commit count|work quota|fatigue/i,
    why: "a session cannot measure its own capacity, and an arbitrary proxy for it is the same guess in another unit",
  },
  {
    name: "merge cadence",
    pattern:
      /planned merge|one merge per session|merge cadence|merge (?:is )?(?:taken|done|landed|complete)|already (?:merged|shipped)|shipped for the session|RULING 1\b/i,
    why: "RULING 1 governs shipping cadence, not session duration — delay the merge instead of ending the session",
  },
];

/** The non-reason a stated stop reason appeals to, or `null` if it is real. */
export function disqualifyingNonReason(stopReason: string): { name: string; why: string } | null {
  for (const n of NON_REASONS) {
    if (n.pattern.test(stopReason)) return { name: n.name, why: n.why };
  }
  return null;
}

/**
 * What every non-`COMPLETE` close must record.
 *
 * Every field is either DERIVED from canonical state or a plain fact about what
 * happened. **None of them is an estimate**, and that is the point: the removed
 * `contextUsedPercent` / `contextRemainingPercent` pair asked a session to
 * report a number it had no way to know.
 */
export interface StopAccounting {
  /** Specific. "ran low" is not a stop reason, and neither is "the merge is taken". */
  stopReason: string;
  /** Derived across every workstream, never asserted. */
  executableOwedWorkRemaining: number;
  /** The author explicitly stopped, redirected or narrowed this session. */
  authorStop: boolean;
  /** An actual external condition prevented continuing. Never inferred. */
  externalStop: boolean;
  /** Canonical state fully persisted, cursor and remainder generated. */
  statePersisted: boolean;
}

export interface StopVerdict {
  status: SessionStatus;
  /** Why this status and not another. Always stated. */
  reason: string;
  /** Set when a claimed status was refused, naming what was claimed. */
  refused?: string;
}

/**
 * Derive the session status from the accounting.
 *
 * **The model does not award itself a status; the state does.** A session that
 * claims a clean stop on a reason that is not a reason is refused here, and the
 * refusal names both the claim and the non-reason it appealed to — which is the
 * whole point of moving this out of prose.
 *
 * **Persisted resumability is not permission to stop voluntarily.** Canonical
 * state exists so that an interrupted session can be resumed; a session that
 * ends while it still has authorized executable work is `EARLY_HANDOFF` however
 * perfect its handoff is.
 */
export function classifySessionStop(
  a: StopAccounting,
  claimed?: SessionStatus,
): StopVerdict {
  const refuse = (status: SessionStatus, reason: string): StopVerdict =>
    claimed && claimed !== status
      ? { status, reason, refused: claimed }
      : { status, reason };

  if (!a.statePersisted) {
    return refuse(
      "FAILED_CLOSEOUT",
      "canonical state, exact remainder or accounting is missing — nothing else can be claimed",
    );
  }

  if (a.executableOwedWorkRemaining === 0) {
    return refuse("COMPLETE", "no executable owed work remains");
  }

  // A stop reason is checked ONLY where it is doing work — that is, only where
  // it is being offered as justification for a clean stop. An early handoff
  // states whatever reason it states; it is already reported as early.
  const nonReason =
    a.authorStop || a.externalStop ? disqualifyingNonReason(a.stopReason) : null;

  if (nonReason) {
    return refuse(
      "EARLY_HANDOFF",
      `the stated reason appeals to ${nonReason.name} — ${nonReason.why}. ` +
        `${a.executableOwedWorkRemaining} executable item(s) were owed, so the stop was early.`,
    );
  }

  if (a.authorStop) {
    return refuse(
      "CLEAN_HANDOFF_AUTHOR_STOP",
      "the author explicitly stopped, redirected or narrowed the session",
    );
  }

  if (a.externalStop) {
    return refuse(
      "CLEAN_HANDOFF_EXTERNAL_STOP",
      "an actual external condition prevented continued authorized work",
    );
  }

  return refuse(
    "EARLY_HANDOFF",
    `${a.executableOwedWorkRemaining} executable item(s) were owed, the author did not stop the session, ` +
      "and no external condition prevented continuing. The handoff may be excellent; the stop was still early.",
  );
}

export const WORKSTREAM_STATUSES = ["OPEN", "COMPLETE_AS_OF"] as const;
export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];

export const GRAPH_STATUSES = ["EXPANDING", "CONVERGED_AS_OF"] as const;
export type GraphStatus = (typeof GRAPH_STATUSES)[number];

/** ----------------------------------------------------------- dispositions */

/**
 * Work and source dispositions.
 *
 * **The false binary `taken OR absent` is deleted** (RULING 184). A CAPTCHA is
 * not absence. Missing tooling is not absence. A pending records request is not
 * absence. A third-party pointer is not necessarily something to ingest. A
 * presently prohibited route is not absence.
 */
export const DISPOSITIONS = [
  "UNWALKED",
  "DISCOVERED",
  "IN_PROGRESS",
  "INGESTED",
  "POINTER_ONLY",
  "WALKED_NO_YIELD",
  "BLOCKED_CURRENTLY",
  "REQUIRES_NEW_ADAPTER",
  "RECORDS_REQUEST_PENDING",
  "NOT_APPLICABLE",
  "RECHECK_DUE",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * The dispositions that TERMINATE a child for completion purposes.
 *
 * Deliberately short. `BLOCKED_CURRENTLY`, `REQUIRES_NEW_ADAPTER` and
 * `RECORDS_REQUEST_PENDING` are NOT here: each is an open obligation wearing a
 * finished face, and counting them as done is precisely how a blocker becomes a
 * reported absence.
 */
export const TERMINAL_DISPOSITIONS: readonly Disposition[] = [
  "INGESTED",
  "WALKED_NO_YIELD",
  "NOT_APPLICABLE",
];

/** Dispositions that leave a workstream OPEN and are reported by name. */
export const OPEN_DISPOSITIONS: readonly Disposition[] = [
  "UNWALKED",
  "DISCOVERED",
  "IN_PROGRESS",
  "POINTER_ONLY",
  "BLOCKED_CURRENTLY",
  "REQUIRES_NEW_ADAPTER",
  "RECORDS_REQUEST_PENDING",
  "RECHECK_DUE",
];

/** --------------------------------------- permission and transport, apart */

/**
 * What we know about whether we MAY walk a host.
 *
 * `CANNOT_TELL` fails safe for the route (RULING 148) and is NOT `DISALLOWED`.
 * The distinction is the whole of RULING 182: one is a host telling us not to
 * ask, the other is us being unable to hear the answer. A `DISALLOWED` host is
 * never re-walked on a clock, because re-walking it is asking again after being
 * told no. A `CANNOT_TELL` host is re-walked with a different client.
 */
export const PERMISSION_STATES = ["ALLOWED", "DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE"] as const;
export type PermissionState = (typeof PERMISSION_STATES)[number];

/**
 * What happened when we tried to RETRIEVE something — including the permission
 * document itself.
 *
 * A value here is never a permission verdict. That collapse cost the descent
 * session multiple hosts, including the tops of two state descents, and
 * escalating the retrieval client recovered them.
 */
export const TRANSPORT_STATES = [
  "REACHABLE",
  "FAILED_AT_RUNG",
  "CHALLENGED",
  "TIMEOUT",
  "TLS_CLIENT_MISMATCH",
  "OTHER_NAMED_FAILURE",
] as const;
export type TransportState = (typeof TRANSPORT_STATES)[number];

export interface PermissionRecord {
  host: string;
  permission: PermissionState;
  /** How the permission document read went. Independent of the verdict. */
  transport: TransportState;
  /** The rung the permission document was read at, when it was read. */
  rung: number | null;
  /** The client that produced this reading. */
  client: string;
  checkedOn: string;
  /** Required when transport is not REACHABLE: what failed, in words. */
  failure?: string;
  /**
   * What the wall is AROUND (RULING 90 item 4). A refusal is one road closed,
   * never a fact about the thing on the other side.
   */
  around?: string;
}

/**
 * May we fetch from this host right now?
 *
 * Fails safe on `CANNOT_TELL` and on `DISALLOWED` alike — but for different
 * reasons, and the reason travels with the answer, because the two lead to
 * completely different next moves.
 */
export function mayWalk(p: PermissionRecord): { allowed: boolean; reason: string; recheck: boolean } {
  switch (p.permission) {
    case "ALLOWED":
      return { allowed: true, reason: "permission read and allows this route", recheck: true };
    case "NOT_APPLICABLE":
      return { allowed: true, reason: "no permission document governs this route", recheck: false };
    case "DISALLOWED":
      return {
        allowed: false,
        reason: "the host's own rules refuse this route; a disallow is not a wall and is not re-walked on a clock",
        recheck: false,
      };
    case "CANNOT_TELL":
    default:
      return {
        allowed: false,
        reason:
          `permission is unread (${p.transport}${p.failure ? `: ${p.failure}` : ""}); ` +
          "this refuses the ROUTE and asserts nothing about the host or the fact",
        recheck: true,
      };
  }
}

/**
 * Record a permission-document retrieval.
 *
 * **A transport failure may never produce `DISALLOWED`.** That is enforced here
 * rather than remembered, because the collapse is one line of plausible code
 * and it reads as caution.
 */
export function recordPermissionRead(input: {
  host: string;
  transport: TransportState;
  client: string;
  checkedOn: string;
  /** Only supplied when the document was actually READ. */
  verdictFromDocument?: "ALLOWED" | "DISALLOWED" | "NOT_APPLICABLE";
  rung?: number;
  failure?: string;
  around?: string;
}): PermissionRecord {
  const read = input.transport === "REACHABLE";
  if (!read && input.verdictFromDocument) {
    throw new Error(
      `permission verdict supplied for ${input.host} with transport ${input.transport}: ` +
        "a document that was not retrieved cannot have been read (RULING 182)",
    );
  }
  return {
    host: input.host,
    permission: read ? (input.verdictFromDocument ?? "CANNOT_TELL") : "CANNOT_TELL",
    transport: input.transport,
    rung: input.rung ?? null,
    client: input.client,
    checkedOn: input.checkedOn,
    failure: input.failure,
    around: input.around,
  };
}

/** ------------------------------------------- candidates, entities, bodies */

/**
 * The lifecycle a link detector's output travels.
 *
 * **A large candidate count is not coverage** (RULING 183). The descent
 * produced 1,392 named candidates and promoted ZERO bodies; a job board
 * produced 154 false candidates and a calendar view 214.
 */
export const CANDIDATE_STATES = [
  "EDGE_DISCOVERED",
  "ENTITY_CANDIDATE",
  "ENTITY_VERIFIED",
  "BODY_PROMOTED",
  "DUPLICATE",
  "REJECTED_FALSE_POSITIVE",
  "NEEDS_CLASSIFICATION",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/** The only state that increases coverage. */
export const COVERAGE_STATES: readonly CandidateState[] = ["BODY_PROMOTED"];

export interface EntityCandidate {
  id: string;
  state: CandidateState;
  /** The link text that named it. */
  text: string;
  url: string;
  /** The edge this came from — provenance, never reconstructed. */
  fromEdge: string;
  jurisdiction: string;
  tier: string;
  discoveredOn: string;
  /** Required to leave ENTITY_CANDIDATE: what evidence moved it. */
  evidence?: string;
  /** Required on REJECTED_FALSE_POSITIVE: why. */
  rejectedReason?: string;
  /** Set on BODY_PROMOTED: the registry id it became. */
  bodyId?: string;
}

/**
 * The three-way split every coverage report states (RULING 105, RULING 183).
 *
 * A bare candidate count sounds like coverage and is not. The promoted count is
 * the numerator; nothing else may stand in for it.
 */
export interface CandidateAccounting {
  candidates: number;
  verified: number;
  promoted: number;
  duplicates: number;
  rejected: number;
  needsClassification: number;
  /** promoted, and only promoted. */
  coverageNumerator: number;
}

export function accountCandidates(cs: readonly EntityCandidate[]): CandidateAccounting {
  const n = (s: CandidateState) => cs.filter((c) => c.state === s).length;
  const promoted = n("BODY_PROMOTED");
  return {
    candidates: cs.length,
    verified: n("ENTITY_VERIFIED"),
    promoted,
    duplicates: n("DUPLICATE"),
    rejected: n("REJECTED_FALSE_POSITIVE"),
    needsClassification: n("NEEDS_CLASSIFICATION"),
    coverageNumerator: promoted,
  };
}

/** ------------------------------------------------------------------ edges */

/**
 * A persisted frontier edge.
 *
 * Stable id, explicit parent, explicit disposition. **This is what
 * `descent.json` never held.** `passes` and `budget` choose how many of these
 * to process; they do not decide which exist (RULING 181).
 */
export interface WorkEdge {
  id: string;
  url: string;
  text: string;
  /** The edge or seed this was found from. Provenance is never reconstructed. */
  parent: string | null;
  state: string;
  tier: string;
  level: string;
  disposition: Disposition;
  discoveredOn: string;
  processedOn?: string;
  /** Required on a declined edge: why it does not enlarge the graph. */
  declinedReason?: string;
  /**
   * Whether this edge is ELIGIBLE — whether it plausibly advances an owed
   * question. An ineligible edge is recorded as evidence and does NOT enlarge
   * the completion graph, which is what stops discovery becoming an infinite
   * crawl (RULING 177).
   */
  eligible: boolean;
}

/** ------------------------------------------------------- eligible edges */

/**
 * The owed questions. A discovered route enlarges the active graph only when it
 * plausibly advances one of these.
 *
 * **This is the bound, and it is the only bound.** It is not a cap on effort —
 * effort is uncapped by RULING 177. It is a statement about SUBJECT: a
 * government page does not recursively make every hyperlink on the internet
 * owed.
 */
export const OWED_QUESTIONS = [
  "identifies-a-governmental-body",
  "identifies-an-official-or-candidate",
  "provides-meetings-or-hearings",
  "provides-elections-ballots-or-measures",
  "provides-filings-or-campaign-finance",
  "identifies-another-authoritative-publisher",
  "provides-an-official-governing-or-legal-record",
  "provides-evidence-verifying-an-owed-fact",
  "reveals-a-new-governmental-layer-or-entity-class",
  "reveals-a-new-source-or-route-class",
] as const;
export type OwedQuestion = (typeof OWED_QUESTIONS)[number];

export interface EligibilityVerdict {
  eligible: boolean;
  /** Which owed questions it advances. Empty when ineligible. */
  advances: OwedQuestion[];
  reason: string;
}

/** ------------------------------------ obligations we know of but cannot name */

/**
 * An UNMATERIALIZED OBLIGATION — work a previous run demonstrably discovered,
 * whose COUNT survived but whose IDENTITIES did not.
 *
 * ## The accounting question this exists to answer honestly
 *
 * The legacy descent left two different numbers, and collapsing them either way
 * would be a lie:
 *
 *   **1,614** eligible edges are persisted and resumable. Real, addressable,
 *   individually named on disk.
 *
 *   **3,900** edges the final pass queued — 1,986 NJ, 1,143 AZ, 771 NH — of
 *   which `descent.json` recorded only `finalPassNewLinks`. **The number was
 *   persisted. The edges were not.**
 *
 * Adding them gives 5,514 "outstanding edges", which claims 3,900 addresses the
 * repository does not have. Reporting only 1,614 silently discards work a
 * previous session did and the project still owes. Neither is acceptable, so
 * the two populations are kept APART, both counted, and the second is carried
 * as an obligation with a named discharge path.
 *
 * **It is never resumable and never complete.** It keeps the workstream OPEN
 * until a recovery walk re-materializes it into real edges, at which point it
 * is discharged with the count that discharged it.
 */
export interface UnmaterializedObligation {
  id: string;
  /** How many items the historical record says existed. */
  count: number;
  /** Where that number came from, exactly. */
  source: string;
  /** Why the identities are gone — stated, never implied. */
  why: string;
  /** What would re-materialize them. An obligation with no path is a wish. */
  discharge: string;
  recordedOn: string;
  /** Set when a later run actually recovered them. */
  dischargedOn?: string;
  /** How many real edges the discharge produced. May differ from `count`. */
  dischargedCount?: number;
}

/**
 * The aggregate tail — the total obligation a repository is carrying.
 *
 * **This is the number that must never quietly shrink.** A per-state count can
 * legitimately move as one state is recovered; the aggregate moving without a
 * discharge record is work disappearing, which is the failure mode the whole
 * migration was built to prevent.
 */
export interface AggregateTail {
  outstandingCount: number;
  dischargedCount: number;
  byId: Array<{ id: string; count: number; discharged: boolean }>;
}

export function aggregateTail(
  obligations: readonly UnmaterializedObligation[],
): AggregateTail {
  let outstanding = 0;
  let discharged = 0;
  const byId: AggregateTail["byId"] = [];
  for (const o of obligations) {
    const done = Boolean(o.dischargedOn);
    if (done) discharged += o.count;
    else outstanding += o.count;
    byId.push({ id: o.id, count: o.count, discharged: done });
  }
  return { outstandingCount: outstanding, dischargedCount: discharged, byId };
}

/** ------------------------------------------------------------ convergence */

/**
 * A convergence record.
 *
 * **`CONVERGED_AS_OF` never means "we know every possible way to find this."**
 * It means: under the current project knowledge, for this defined universe,
 * every currently eligible avenue has a disposition as of this date.
 *
 * All four versions are REQUIRED, because each can independently reopen it.
 */
export interface Convergence {
  convergedAsOf: string;
  methodVersion: number;
  universeVersion: string;
  eligibleEdgeVersion: string;
  /** The freshness window, in days, this convergence holds for. */
  freshnessDays: number;
}

export interface ConvergenceVerdict {
  status: GraphStatus;
  /** Named reasons the convergence no longer holds. */
  reopenedBy: string[];
}

/**
 * Does a recorded convergence still hold?
 *
 * A newly applicable route, a changed universe, a changed eligibility
 * definition, or expired freshness each reopen it — independently.
 */
export function convergenceHolds(
  c: Convergence,
  now: {
    methodVersion: number;
    universeVersion: string;
    eligibleEdgeVersion: string;
    today: string;
  },
): ConvergenceVerdict {
  const reopenedBy: string[] = [];
  if (now.methodVersion > c.methodVersion) {
    reopenedBy.push(
      `method version moved ${c.methodVersion} -> ${now.methodVersion}; routes learned since were never walked here`,
    );
  }
  if (now.universeVersion !== c.universeVersion) {
    reopenedBy.push(`subject universe changed (${c.universeVersion} -> ${now.universeVersion})`);
  }
  if (now.eligibleEdgeVersion !== c.eligibleEdgeVersion) {
    reopenedBy.push(
      `eligible-edge definition changed (${c.eligibleEdgeVersion} -> ${now.eligibleEdgeVersion})`,
    );
  }
  const age = daysBetween(c.convergedAsOf, now.today);
  if (age > c.freshnessDays) {
    reopenedBy.push(`freshness expired: ${age} days since convergence, window is ${c.freshnessDays}`);
  }
  return {
    status: reopenedBy.length === 0 ? "CONVERGED_AS_OF" : "EXPANDING",
    reopenedBy,
  };
}

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
