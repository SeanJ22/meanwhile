/**
 * Canonical multi-session work state: a frontier is persisted as edges, not as
 * counts to be recreated from seeds. It keeps three separations:
 *
 * 1. **Session status is not workstream status is not graph status.**
 * 2. **Permission state is not transport state.**
 * 3. **A candidate is not a body.**
 */

/** ---------------------------------------------------------------- statuses */

/**
 * Session status — FIVE states, because "was the state preserved?" and "was
 * there a legitimate reason to stop?" are independent questions. There is no
 * capacity threshold: a session stops when the authorized work is done, when
 * the author stops or redirects it, or when something outside it actually
 * prevents continuing.
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
 * Stated reasons that are NOT reasons for a clean stop:
 *
 * 1. **Self-estimated capacity** — context used or remaining, a percentage, a
 *    token budget, an imminent compaction, or any other arbitrary proxy
 *    (elapsed minutes, message/command/commit counts, a quota, fatigue).
 * 2. **Merge cadence** — a planned merge having happened is not a reason to
 *    stop while executable work remains.
 *
 * This only disqualifies a stated reason from making a stop CLEAN; it never
 * blocks a close and never touches `COMPLETE` or `FAILED_CLOSEOUT`.
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

/** What every non-`COMPLETE` close must record: derived facts, never estimates. */
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
 * Derives the session status from the accounting; a claimed clean stop on a
 * non-reason is refused, naming both. A session that ends with authorized
 * executable work still owed is `EARLY_HANDOFF`, however good its handoff.
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

  // A stop reason is checked only where it is offered as justification for a
  // clean stop.
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
 * Work and source dispositions. A CAPTCHA, missing tooling, a pending records
 * request, a third-party pointer or a presently prohibited route is not
 * absence.
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
 * `BLOCKED_CURRENTLY`, `REQUIRES_NEW_ADAPTER` and `RECORDS_REQUEST_PENDING` are
 * open obligations, not done.
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
 * What a host's robots.txt said about a route, as RECORDED evidence.
 * `CANNOT_TELL` (the document could not be read) is NOT `DISALLOWED` (read and
 * names the route); a transport failure may never become a verdict. Neither
 * refuses a public page; what stops a walk is an access control (a challenge,
 * a 401/403/429).
 */
export const PERMISSION_STATES = ["ALLOWED", "DISALLOWED", "CANNOT_TELL", "NOT_APPLICABLE"] as const;
export type PermissionState = (typeof PERMISSION_STATES)[number];

/**
 * What happened when we tried to RETRIEVE something — including the permission
 * document itself. Never a permission verdict.
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
  /** What the wall is AROUND: a refusal is one road closed, never a fact about the thing behind it. */
  around?: string;
}

/**
 * May we fetch from this host right now? A robots.txt verdict never refuses;
 * it is recorded and travels with the answer. The one refusal is an access
 * control: a permission read answered by a bot challenge (`CHALLENGED`), which
 * is investigated by another public route, never pushed past.
 */
export function mayWalk(p: PermissionRecord): { allowed: boolean; reason: string; recheck: boolean } {
  if (p.transport === "CHALLENGED") {
    return {
      allowed: false,
      reason:
        `the robots.txt read was answered by an access control (${p.failure ?? "a challenge or a 401/403/429"}); ` +
        "a wall is never bypassed, and this refuses the ROUTE while asserting nothing about the fact",
      recheck: true,
    };
  }
  switch (p.permission) {
    case "ALLOWED":
      return { allowed: true, reason: "robots.txt read and allows this route", recheck: true };
    case "NOT_APPLICABLE":
      return { allowed: true, reason: "no robots document governs this route", recheck: false };
    case "DISALLOWED":
      return {
        allowed: true,
        reason: "robots.txt names this route; recorded, and not blocking (owner decision 2026-09-25)",
        recheck: true,
      };
    case "CANNOT_TELL":
    default:
      return {
        allowed: true,
        reason:
          `robots.txt is unread (${p.transport}${p.failure ? `: ${p.failure}` : ""}); recorded as unread, ` +
          "and not blocking (owner decision 2026-09-25)",
        recheck: true,
      };
  }
}

/** Records a permission-document retrieval. A transport failure may never produce `DISALLOWED`. */
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

/** The lifecycle a link detector's output travels. A large candidate count is not coverage. */
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
 * The three-way split every coverage report states. The promoted count is the
 * numerator; nothing else may stand in for it.
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
 * A persisted frontier edge: stable id, explicit parent, explicit disposition.
 * `passes` and `budget` choose how many to process; they do not decide which
 * exist.
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
   * Whether this edge plausibly advances an owed question. An ineligible edge
   * is recorded as evidence and does NOT enlarge the completion graph.
   */
  eligible: boolean;
}

/** ------------------------------------------------------- eligible edges */

/**
 * The owed questions. A discovered route enlarges the active graph only when it
 * plausibly advances one of these: a bound on subject, not on effort.
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
 * whose COUNT survived but whose IDENTITIES did not. Kept apart from the
 * persisted, resumable edges and never added to them; it is never resumable
 * or complete, and keeps the workstream OPEN until a recovery walk
 * re-materializes it into real edges.
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
 * The aggregate tail — the total obligation a repository is carrying. It may
 * never shrink without a discharge record.
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
 * A convergence record. `CONVERGED_AS_OF` means: under current project
 * knowledge, for this defined universe, every currently eligible avenue has a
 * disposition as of this date. All four versions are required, because each
 * can independently reopen it.
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
