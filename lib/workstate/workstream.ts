/**
 * The workstream — canonical state for long-running, multi-session work.
 *
 * ## The rule this file makes structural
 *
 * **A model may not type "done" while unresolved required children exist.**
 * Completion is COMPUTED here, from child dispositions, against a declared
 * denominator. It is not a sentence a session writes at the end of a report.
 *
 * ## And the one it makes impossible to fake
 *
 * The exact remainder and the exact resume cursor are DERIVED from persisted
 * state. There is no path by which a session narrates them. That is RULING 180:
 * the repository generates the handoff; the model may explain it.
 */

import {
  type Convergence,
  type Disposition,
  type EntityCandidate,
  type GraphStatus,
  type PermissionRecord,
  type SessionStatus,
  type WorkEdge,
  type UnmaterializedObligation,
  type WorkstreamStatus,
  OPEN_DISPOSITIONS,
  aggregateTail,
  TERMINAL_DISPOSITIONS,
  accountCandidates,
  convergenceHolds,
  mayWalk,
} from "./types.ts";

/**
 * The BOUNDED subject universe.
 *
 * RULING 177: the universe of owed subjects may be bounded; the universe of
 * methods is not. This is the bounded half — a named, versioned denominator
 * against which every member gets exactly one accounting disposition.
 */
export interface SubjectUniverse {
  /** What authority defines this universe. Never our own records (RULING 147). */
  authority: string;
  version: string;
  members: string[];
}

export interface WorkItem {
  id: string;
  /** The universe member this item is accounting for. */
  subject: string;
  disposition: Disposition;
  /** Required children. An item cannot be complete while one is open. */
  children: string[];
  updatedOn: string;
  /** Required on BLOCKED_CURRENTLY and friends: what the blocker is. */
  blockerReason?: string;
  /** Required on RECHECK_DUE: when. */
  recheckOn?: string;
}

export interface Workstream {
  id: string;
  title: string;
  openedOn: string;
  universe: SubjectUniverse;
  items: WorkItem[];
  edges: WorkEdge[];
  candidates: EntityCandidate[];
  permissions: PermissionRecord[];
  /** The exact cursor. Persisted, never reconstructed. */
  cursor: string | null;
  convergence: Convergence | null;
  /**
   * Work a previous run discovered whose identities were never persisted.
   * Counted, never resumable, and it keeps this workstream OPEN until a
   * recovery walk discharges it. See `UnmaterializedObligation`.
   */
  unmaterialized: UnmaterializedObligation[];
  /** Route ids inherited at open, and learned during the run. */
  routesInherited: string[];
  routesLearned: string[];
  methodVersion: number;
}

export interface Accounting {
  /** Every universe member gets exactly one disposition, or this is a defect. */
  denominator: number;
  accounted: number;
  unaccounted: string[];
  doubleAccounted: string[];
  byDisposition: Record<string, number>;
}

/**
 * Every member of the denominator gets EXACTLY ONE current disposition.
 *
 * An unaccounted member is a subject nobody decided about, and folding it into
 * a completed denominator would report confidence the sweep never measured —
 * RULING 100's partial, one floor up.
 */
export function account(w: Workstream): Accounting {
  const byDisposition: Record<string, number> = {};
  const seen = new Map<string, number>();
  for (const it of w.items) {
    byDisposition[it.disposition] = (byDisposition[it.disposition] ?? 0) + 1;
    seen.set(it.subject, (seen.get(it.subject) ?? 0) + 1);
  }
  const unaccounted = w.universe.members.filter((m) => !seen.has(m));
  const doubleAccounted = [...seen].filter(([, n]) => n > 1).map(([m]) => m);
  return {
    denominator: w.universe.members.length,
    accounted: seen.size,
    unaccounted,
    doubleAccounted,
    byDisposition,
  };
}

export interface CompletionVerdict {
  workstream: WorkstreamStatus;
  graph: GraphStatus;
  /** Set only when workstream is COMPLETE_AS_OF. */
  completeAsOf?: string;
  /** Set only when complete: the method version it was earned under. */
  methodVersion?: number;
  /** Every reason it is NOT complete, named. Never "the rest". */
  blockedBy: string[];
}

/**
 * Is this workstream complete?
 *
 * Every condition in RULING 179, each checked and each named on failure. A
 * verdict that says OPEN without saying why is a verdict a session has to
 * interpret, which is the reasoning this architecture removes.
 */
export function completion(
  w: Workstream,
  now: { today: string; methodVersion: number; eligibleEdgeVersion: string },
): CompletionVerdict {
  const blockedBy: string[] = [];
  const acc = account(w);

  if (acc.unaccounted.length > 0) {
    blockedBy.push(
      `${acc.unaccounted.length} of ${acc.denominator} universe members have no disposition: ` +
        acc.unaccounted.slice(0, 8).join(", ") +
        (acc.unaccounted.length > 8 ? ` (+${acc.unaccounted.length - 8} more)` : ""),
    );
  }
  if (acc.doubleAccounted.length > 0) {
    blockedBy.push(`${acc.doubleAccounted.length} members carry more than one disposition`);
  }

  const openItems = w.items.filter((i) => !TERMINAL_DISPOSITIONS.includes(i.disposition));
  if (openItems.length > 0) {
    const byKind = new Map<string, number>();
    for (const i of openItems) byKind.set(i.disposition, (byKind.get(i.disposition) ?? 0) + 1);
    blockedBy.push(
      `${openItems.length} item(s) not terminal: ` +
        [...byKind].map(([d, n]) => `${d}×${n}`).join(", "),
    );
  }

  // An owed item may never be represented as absent because of a blocker. A
  // blocked item keeps the workstream OPEN — that is the whole of RULING 184.
  const blocked = w.items.filter(
    (i) =>
      i.disposition === "BLOCKED_CURRENTLY" ||
      i.disposition === "REQUIRES_NEW_ADAPTER" ||
      i.disposition === "RECORDS_REQUEST_PENDING",
  );
  if (blocked.length > 0) {
    blockedBy.push(`${blocked.length} open blocker(s); a blocked route is never a factual absence`);
  }

  const queued = w.edges.filter((e) => e.eligible && OPEN_DISPOSITIONS.includes(e.disposition));
  if (queued.length > 0) {
    blockedBy.push(`${queued.length} eligible edge(s) still queued`);
  }

  const unclassified = w.candidates.filter(
    (c) => c.state === "ENTITY_CANDIDATE" || c.state === "NEEDS_CLASSIFICATION",
  );
  if (unclassified.length > 0) {
    blockedBy.push(`${unclassified.length} discovery candidate(s) unclassified`);
  }

  const unresolvedPermission = w.permissions.filter((p) => p.permission === "CANNOT_TELL");
  if (unresolvedPermission.length > 0) {
    blockedBy.push(
      `${unresolvedPermission.length} host(s) with permission unread — CANNOT_TELL is neither allowed nor disallowed`,
    );
  }

  // An unmaterialized obligation is work the project OWES and cannot currently
  // address. It is not resumable, so it never joins the queued count — and it
  // is not finished, so it can never let a workstream close. Discharging it
  // means re-materializing the edges, not deciding they no longer matter.
  const tail = aggregateTail(w.unmaterialized ?? []);
  if (tail.outstandingCount > 0) {
    blockedBy.push(
      `${tail.outstandingCount} unmaterialized obligation(s) carried: work a previous run discovered ` +
        "whose identities were never persisted — counted, not resumable, and not discharged",
    );
  }

  let graph: GraphStatus = "EXPANDING";
  if (w.convergence) {
    const v = convergenceHolds(w.convergence, {
      methodVersion: now.methodVersion,
      universeVersion: w.universe.version,
      eligibleEdgeVersion: now.eligibleEdgeVersion,
      today: now.today,
    });
    graph = v.status;
    for (const r of v.reopenedBy) blockedBy.push(`convergence reopened: ${r}`);
  } else {
    blockedBy.push("no convergence record — the eligible graph has never been declared converged");
  }

  if (blockedBy.length > 0) return { workstream: "OPEN", graph, blockedBy };
  return {
    workstream: "COMPLETE_AS_OF",
    graph,
    completeAsOf: now.today,
    methodVersion: now.methodVersion,
    blockedBy: [],
  };
}

/** ------------------------------------------------------------- the handoff */

export interface Handoff {
  session: SessionStatus;
  workstream: WorkstreamStatus;
  graph: GraphStatus;
  methodVersion: number;
  routesInherited: number;
  routesLearned: number;
  resumeCursor: string | null;
  open: string[];
  blocked: Array<{ id: string; reason: string }>;
  discoveredNotProcessed: string[];
  recheckDue: string[];
  permissionUnresolved: string[];
  candidates: ReturnType<typeof accountCandidates>;
  /**
   * The obligation this handoff is carrying but cannot address: counted,
   * never resumable. Reported SEPARATELY from the resumable edges, because
   * adding them would claim addresses the repository does not have and
   * omitting them would discard work the project still owes.
   */
  unmaterialized: { outstanding: number; discharged: number; detail: string[] };
  /** Everything the completion verdict is waiting on. */
  blockedBy: string[];
}

/**
 * Generate the handoff FROM STATE.
 *
 * Nothing here is a summary, a sample or a top-N. **No "the rest", no omitted
 * tail.** If this list is long, that is the truth about the work, and a shorter
 * list would be a lie that reads better.
 */
export function generateHandoff(
  w: Workstream,
  now: { today: string; methodVersion: number; eligibleEdgeVersion: string },
  session: SessionStatus,
): Handoff {
  const verdict = completion(w, now);
  const queued = w.edges.filter((e) => e.eligible && OPEN_DISPOSITIONS.includes(e.disposition));
  return {
    session,
    workstream: verdict.workstream,
    graph: verdict.graph,
    methodVersion: now.methodVersion,
    routesInherited: w.routesInherited.length,
    routesLearned: w.routesLearned.length,
    resumeCursor: w.cursor,
    open: w.items
      .filter((i) => !TERMINAL_DISPOSITIONS.includes(i.disposition))
      .map((i) => `${i.id} (${i.disposition})`),
    blocked: w.items
      .filter((i) => i.blockerReason)
      .map((i) => ({ id: i.id, reason: i.blockerReason as string })),
    discoveredNotProcessed: queued.map((e) => e.id),
    recheckDue: w.items
      .filter((i) => i.disposition === "RECHECK_DUE")
      .map((i) => `${i.id} (due ${i.recheckOn ?? "date unrecorded"})`),
    permissionUnresolved: w.permissions
      .filter((p) => !mayWalk(p).allowed && p.permission === "CANNOT_TELL")
      .map((p) => `${p.host} (${p.transport}${p.failure ? `: ${p.failure}` : ""})`),
    candidates: accountCandidates(w.candidates),
    unmaterialized: {
      outstanding: aggregateTail(w.unmaterialized ?? []).outstandingCount,
      discharged: aggregateTail(w.unmaterialized ?? []).dischargedCount,
      detail: (w.unmaterialized ?? []).map(
        (o) =>
          `${o.id}: ${o.count} from ${o.source}` +
          (o.dischargedOn ? ` — DISCHARGED ${o.dischargedOn} (${o.dischargedCount ?? 0} edges)` : ` — OPEN; discharge by: ${o.discharge}`),
      ),
    },
    blockedBy: verdict.blockedBy,
  };
}

/** ----------------------------------------------------------- the validator */

export interface WorkStateIssue {
  id: string;
  rule: string;
  detail: string;
}

/**
 * What must be IMPOSSIBLE, per the remediation brief, checked rather than
 * promised.
 */
export function validateWorkstream(
  w: Workstream,
  now: { today: string; methodVersion: number; eligibleEdgeVersion: string },
): WorkStateIssue[] {
  const out: WorkStateIssue[] = [];
  const bad = (id: string, rule: string, detail: string) => out.push({ id, rule, detail });

  // A required child may not disappear.
  const itemIds = new Set(w.items.map((i) => i.id));
  for (const i of w.items) {
    for (const c of i.children) {
      if (!itemIds.has(c)) bad(i.id, "missing-child", `required child ${c} is not in the workstream`);
    }
  }

  // An item may not be terminal while a required child is open.
  const byId = new Map(w.items.map((i) => [i.id, i]));
  for (const i of w.items) {
    if (!TERMINAL_DISPOSITIONS.includes(i.disposition)) continue;
    for (const c of i.children) {
      const child = byId.get(c);
      if (child && !TERMINAL_DISPOSITIONS.includes(child.disposition)) {
        bad(i.id, "complete-with-open-child", `terminal while child ${c} is ${child.disposition}`);
      }
    }
  }

  // A blocker must name itself, or "blocked" is indistinguishable from absent.
  for (const i of w.items) {
    if (
      (i.disposition === "BLOCKED_CURRENTLY" ||
        i.disposition === "REQUIRES_NEW_ADAPTER" ||
        i.disposition === "RECORDS_REQUEST_PENDING") &&
      !i.blockerReason
    ) {
      bad(i.id, "unnamed-blocker", `${i.disposition} with no blockerReason`);
    }
    if (i.disposition === "RECHECK_DUE" && !i.recheckOn) {
      bad(i.id, "recheck-undated", "RECHECK_DUE with no date — a stale record cannot read as fresh");
    }
  }

  // Every edge carries a stable id, provenance and a disposition.
  const edgeIds = new Set<string>();
  for (const e of w.edges) {
    if (!e.id) bad("<edge>", "edge-without-id", `edge for ${e.url} has no stable id`);
    if (edgeIds.has(e.id)) bad(e.id, "duplicate-edge-id", "edge id appears more than once");
    edgeIds.add(e.id);
    if (e.parent === undefined) bad(e.id, "edge-without-provenance", "edge has no parent/source");
    if (!e.disposition) bad(e.id, "edge-without-disposition", "a discovered source has no disposition");
    if (!e.eligible && !e.declinedReason) {
      bad(e.id, "ineligible-without-reason", "an ineligible edge must say why it does not enlarge the graph");
    }
  }

  // An in-progress workstream may not lose its cursor.
  const verdict = completion(w, now);
  if (verdict.workstream === "OPEN" && !w.cursor) {
    bad(w.id, "lost-cursor", "an OPEN workstream with no resume cursor cannot be resumed exactly");
  }

  // A candidate may not be counted as a body.
  for (const c of w.candidates) {
    if (c.state === "BODY_PROMOTED" && !c.bodyId) {
      bad(c.id, "promoted-without-registry-id", "BODY_PROMOTED with no registry id is a lead, not a body");
    }
    if (c.state === "REJECTED_FALSE_POSITIVE" && !c.rejectedReason) {
      bad(c.id, "rejected-without-reason", "a rejection must name why");
    }
    if (
      (c.state === "ENTITY_VERIFIED" || c.state === "BODY_PROMOTED") &&
      !c.evidence
    ) {
      bad(c.id, "promoted-without-evidence", `${c.state} with no evidence recorded`);
    }
  }

  // A transport failure may never have produced a permission verdict.
  for (const p of w.permissions) {
    if (p.transport !== "REACHABLE" && p.permission !== "CANNOT_TELL") {
      bad(
        p.host,
        "transport-became-permission",
        `transport ${p.transport} yet permission is ${p.permission} — a document not retrieved was not read`,
      );
    }
    if (p.transport !== "REACHABLE" && !p.failure) {
      bad(p.host, "unnamed-transport-failure", `${p.transport} with no named failure`);
    }
  }

  // THE AGGREGATE-TAIL GUARD.
  //
  // An unmaterialized obligation is the one kind of work that cannot defend
  // itself: it has a count and no addresses, so nothing downstream would notice
  // it vanishing. Every field is therefore required, and a discharge has to say
  // what discharged it.
  for (const o of w.unmaterialized ?? []) {
    if (!o.id) bad(w.id, "obligation-without-id", "an unmaterialized obligation must be addressable");
    if (!Number.isFinite(o.count) || o.count <= 0) {
      bad(o.id, "obligation-without-count", `count is ${o.count}; an obligation of zero is not an obligation`);
    }
    if (!o.source) bad(o.id, "obligation-without-source", "where the count came from must be stated");
    if (!o.why) bad(o.id, "obligation-without-cause", "why the identities are gone must be stated");
    if (!o.discharge) {
      bad(o.id, "obligation-without-discharge", "an obligation with no path to discharge it is a wish");
    }
    if (o.dischargedOn && (o.dischargedCount === undefined || o.dischargedCount < 0)) {
      bad(
        o.id,
        "discharge-without-count",
        "a discharge must say how many real edges it produced — otherwise the tail was decided away rather than recovered",
      );
    }
    // An obligation may not be counted twice: once as a tail and again as a
    // real edge. That would inflate the outstanding work by 3,900.
    if (w.edges.some((e) => e.id === o.id)) {
      bad(o.id, "obligation-is-also-an-edge", "an obligation id collides with a persisted edge id");
    }
  }

  // A convergence with no method version cannot be reopened by new knowledge.
  if (w.convergence && typeof w.convergence.methodVersion !== "number") {
    bad(w.id, "convergence-without-method-version", "convergence carries no method version");
  }

  return out;
}
