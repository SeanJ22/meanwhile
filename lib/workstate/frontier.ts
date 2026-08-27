/**
 * The canonical frontier — read and written by the descent itself.
 *
 * ## What this closes
 *
 * `scripts/descent.mts` built its frontier IN MEMORY from `descent-seeds.ts`
 * and persisted only per-level counts. Measured at the migration HEAD:
 * `finalPassNewLinks` was 1986 / 1143 / 771 for NJ / AZ / NH — **the number of
 * outstanding edges was persisted; the edges were not.** So resuming meant
 * re-walking seeds to rediscover work a previous session had already found,
 * which is exactly what RULING 181 forbids.
 *
 * This module is the other half. Seeds INITIALIZE a workstream that does not
 * exist yet; from then on the canonical store is where outstanding work lives,
 * and `passes` and `budget` choose how much of it to process rather than
 * deciding what it is.
 *
 * ## The one invariant
 *
 * **An edge discovered is an edge PERSISTED, in the same pass that found it.**
 * Not summarized, not counted, not left for a later crawl to find again. If the
 * process dies mid-run, everything it had discovered is on disk.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

import { classifyEdge, ELIGIBLE_EDGE_VERSION } from "./eligibility.ts";
import { type Disposition, type WorkEdge, OPEN_DISPOSITIONS } from "./types.ts";
import type { Workstream } from "./workstream.ts";

/** Stable edge id. The separator is a space, never a raw NUL byte. */
export function edgeId(state: string, tier: string, url: string, text = ""): string {
  const h = createHash("sha256").update([state, tier, url, text].join(" "), "utf8").digest("hex");
  return `edge-${h.slice(0, 12)}`;
}

/**
 * Stable candidate id.
 *
 * **Hashes (state, url, text) and NOT the tier**, which is not an oversight:
 * `workstream-migrate.mts` minted every candidate on disk with exactly these
 * parts on 2026-08-26, and a live walk that re-finds a migrated lead has to
 * land on the same id or it re-records it as new — inflating the denominator
 * with a row that is the same lead, and silently resetting any classification
 * the lead had already earned.
 *
 * The tier IS in `edgeId` because the same URL is legitimately declined at
 * more than one tier and hashing the URL alone collided 7 times in AZ. A
 * candidate does not have that problem: it is a named entity, and the same
 * entity named at two tiers is one entity.
 */
export function candidateId(state: string, tier: string, url: string, text = ""): string {
  void tier;
  const h = createHash("sha256").update([state, url, text].join(" "), "utf8").digest("hex");
  return `cand-${h.slice(0, 12)}`;
}

export function frontierPath(root: string, state: string): string {
  return join(root, "data", "workstate", `${state}.json`);
}

export function loadWorkstream(root: string, state: string): Workstream | null {
  const p = frontierPath(root, state);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Workstream;
}

export function saveWorkstream(root: string, w: Workstream): void {
  const p = frontierPath(root, w.id.replace(/^descent:/, ""));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(w, null, 2) + "\n", "utf8");
}

export interface QueuedEdge {
  id: string;
  url: string;
  text: string;
  tier: string;
}

export interface ResumeState {
  workstream: Workstream;
  /** Outstanding eligible work, by tier. Read from disk, never from seeds. */
  queuedByTier: Map<string, QueuedEdge[]>;
  /** Every URL already accounted for — so a resume never re-walks it. */
  visited: Set<string>;
  totalQueued: number;
  /** True when this came from canonical state rather than from seeds. */
  fromCanonicalState: boolean;
}

/**
 * The resume read.
 *
 * **This is the function the resume proof exercises.** It touches no seed file
 * and makes no network call: outstanding work is whatever the canonical store
 * says is outstanding.
 */
export function resumeFrom(root: string, state: string): ResumeState | null {
  const w = loadWorkstream(root, state);
  if (!w) return null;

  const queuedByTier = new Map<string, QueuedEdge[]>();
  const visited = new Set<string>();
  let totalQueued = 0;

  for (const e of w.edges) {
    // Every edge the store holds is accounted for. A processed edge is never
    // re-walked; an outstanding one is queued rather than rediscovered.
    visited.add(e.url);
    if (!e.eligible) continue;
    if (!OPEN_DISPOSITIONS.includes(e.disposition)) continue;
    const list = queuedByTier.get(e.tier) ?? [];
    list.push({ id: e.id, url: e.url, text: e.text, tier: e.tier });
    queuedByTier.set(e.tier, list);
    totalQueued += 1;
  }

  return { workstream: w, queuedByTier, visited, totalQueued, fromCanonicalState: true };
}

/**
 * Record a newly discovered link as a persisted edge.
 *
 * Returns the edge whether it is new or already known, so a caller can never
 * "discover" something twice and inflate a count.
 */
export function recordDiscovery(
  w: Workstream,
  input: {
    state: string;
    tier: string;
    url: string;
    text: string;
    parent: string | null;
    discoveredOn: string;
  },
): { edge: WorkEdge; isNew: boolean } {
  const id = edgeId(input.state, input.tier, input.url, input.text);
  const existing = w.edges.find((e) => e.id === id);
  if (existing) return { edge: existing, isNew: false };

  const verdict = classifyEdge({ text: input.text, url: input.url });
  const edge: WorkEdge = {
    id,
    url: input.url,
    text: input.text,
    parent: input.parent,
    state: input.state,
    tier: input.tier,
    level: input.tier,
    // DISCOVERED and NOT processed. `processedOn` stays unset until something
    // actually walks it — a discovery stamped as processed is the frontier
    // silently shrinking, which is the defect this module exists to end.
    disposition: "DISCOVERED",
    discoveredOn: input.discoveredOn,
    declinedReason: verdict.eligible ? undefined : verdict.reason,
    eligible: verdict.eligible,
  };
  w.edges.push(edge);
  return { edge, isNew: true };
}

/** Mark an edge processed, with the disposition the walk actually produced. */
export function recordProcessed(
  w: Workstream,
  id: string,
  disposition: Disposition,
  on: string,
  declinedReason?: string,
): boolean {
  const e = w.edges.find((x) => x.id === id);
  if (!e) return false;
  e.disposition = disposition;
  e.processedOn = on;
  if (declinedReason) e.declinedReason = declinedReason;
  return true;
}

/**
 * The cursor, DERIVED from state rather than narrated.
 *
 * RULING 180: the repository generates the handoff. A cursor a session composes
 * is a cursor that can be wrong; this one cannot disagree with the store it is
 * computed from.
 */
export function deriveCursor(w: Workstream, state: string): string {
  const queued = w.edges.filter((e) => e.eligible && OPEN_DISPOSITIONS.includes(e.disposition));
  const byTier = new Map<string, number>();
  for (const e of queued) byTier.set(e.tier, (byTier.get(e.tier) ?? 0) + 1);
  const next = queued[0];
  const parts = [
    `${state}`,
    `${w.edges.length} edge(s) persisted`,
    `${queued.length} eligible edge(s) outstanding`,
    byTier.size ? `by tier: ${[...byTier].map(([t, n]) => `${t}=${n}`).join(", ")}` : "no tier has outstanding work",
    next ? `next: ${next.id} ${next.url}` : "no next edge",
    `eligibility ${ELIGIBLE_EDGE_VERSION}`,
  ];
  /*
   * THE HISTORICAL OBLIGATION IS PART OF THE CURSOR, AND IT IS DERIVED.
   *
   * It was not, until 2026-08-26. `workstream-migrate.mts` WROTE the clause
   * "unmaterialized obligation 1986 (legacy final pass, identities never
   * persisted)" into the cursor string once, and this function never produced
   * it — so the first command to regenerate a cursor silently dropped it, and
   * the next session's handoff would have stopped mentioning 3,900 edges the
   * project still owes. `descent.mts` had the same latent bug and would have
   * hit it on its next pass.
   *
   * A cursor is GENERATED FROM CANONICAL STATE (RULING 181). An obligation
   * that lives in `w.unmaterialized` and only reaches the cursor because one
   * migration typed it there is not generated, it is remembered — and the
   * thing about remembered strings is that they are lost exactly once.
   */
  const owed = w.unmaterialized ?? [];
  const total = owed.reduce((n, u) => n + (u.count ?? 0), 0);
  if (total > 0) {
    parts.push(`unmaterialized obligation ${total} (legacy final pass, identities never persisted)`);
  }
  return parts.join(" / ");
}

/**
 * The start plan — WHAT a descent run is about to do, before it does any of it.
 *
 * ## Why this is a separate, callable function
 *
 * The resume proof used to exercise `resumeFrom` and conclude that the descent
 * resumes without seeds. That proved the HELPER. The actual command still ran
 * `seedsFor(state)` first and THREW when the list was empty, so recovering
 * 1,614 already-persisted edges depended on the seed initializer being present
 * — a dependency the proof could not see because it never called that path.
 *
 * So the decision moves here, where the command and the proof both call it.
 *
 * ## The distinction it keeps
 *
 * **Seeds INITIALIZE a workstream that does not exist.** Without canonical
 * state and without seeds there is nothing to descend, and that still refuses.
 *
 * **Seeds are ALSO tier roots**, deliberately re-read on a cadence because a
 * moved directory is only noticed by going back (RULING 93). That is real work
 * and it is not deleted here — it is reported as its own line, so a run that
 * skips it says so instead of quietly folding it into recovery.
 *
 * **Neither of those is a prerequisite for recovering persisted work.** That is
 * the whole of RULING 181.
 */
export interface DescentStartPlan {
  state: string;
  /** RESUME when canonical outstanding work exists; INITIALIZE otherwise. */
  mode: "RESUME" | "INITIALIZE" | "REFUSED";
  /** Outstanding eligible edges read from canonical state. */
  outstanding: number;
  edgesPersisted: number;
  /** The first edge a resume will process. Derived, never narrated. */
  firstEdge: QueuedEdge | null;
  cursor: string | null;
  /** Tier roots available to re-read as fresh discovery input. */
  seedsAvailable: number;
  /**
   * Whether a top-of-tier recheck can run this pass. SEPARATE from recovery:
   * false here means fresh root expansion is unavailable, never that persisted
   * work cannot be resumed.
   */
  rootRecheckAvailable: boolean;
  /** Why this mode, in words. A refusal that does not say why is unauditable. */
  reason: string;
}

export function planDescentStart(
  root: string,
  state: string,
  seedCount: number,
): DescentStartPlan {
  const r = resumeFrom(root, state);
  const outstanding = r?.totalQueued ?? 0;
  const firstEdge = r ? ([...r.queuedByTier.values()].flat()[0] ?? null) : null;

  if (r && outstanding > 0) {
    return {
      state,
      mode: "RESUME",
      outstanding,
      edgesPersisted: r.workstream.edges.length,
      firstEdge,
      cursor: r.workstream.cursor,
      seedsAvailable: seedCount,
      rootRecheckAvailable: seedCount > 0,
      reason:
        `${outstanding} eligible edge(s) are persisted and outstanding; they resume from canonical state. ` +
        (seedCount > 0
          ? "Tier roots are also available and may be re-read as separate fresh-discovery work."
          : "No tier roots are available this run, so top-of-tier recheck is SKIPPED — recovery is unaffected."),
    };
  }

  if (seedCount > 0) {
    return {
      state,
      mode: "INITIALIZE",
      outstanding,
      edgesPersisted: r?.workstream.edges.length ?? 0,
      firstEdge: null,
      cursor: r?.workstream.cursor ?? null,
      seedsAvailable: seedCount,
      rootRecheckAvailable: true,
      reason:
        r
          ? "canonical state exists but holds no outstanding eligible work; the tier roots are walked as fresh discovery"
          : "no canonical state for this jurisdiction yet; the tier roots initialize it",
    };
  }

  return {
    state,
    mode: "REFUSED",
    outstanding: 0,
    edgesPersisted: r?.workstream.edges.length ?? 0,
    firstEdge: null,
    cursor: r?.workstream.cursor ?? null,
    seedsAvailable: 0,
    rootRecheckAvailable: false,
    reason:
      `DESCENT REFUSED — "${state}" has neither outstanding canonical work nor tier roots. RULING 93: before ` +
      "hunting any tier, walk the directory the tier above publishes about it. Add that state's seeds to " +
      "lib/hunt/descent-seeds.ts first.",
  };
}

/** Everything a Stage 1 resume proof needs to assert, in one shape. */
export interface ResumeProof {
  state: string;
  loadedFromCanonicalState: boolean;
  edgesPersisted: number;
  outstandingEligible: number;
  visitedUrls: number;
  cursor: string;
  /** Seeds were NOT consulted. Asserted by construction: this module cannot. */
  seedsConsulted: false;
  tiersWithWork: string[];
}

export function proveResume(root: string, state: string): ResumeProof | null {
  const r = resumeFrom(root, state);
  if (!r) return null;
  return {
    state,
    loadedFromCanonicalState: r.fromCanonicalState,
    edgesPersisted: r.workstream.edges.length,
    outstandingEligible: r.totalQueued,
    visitedUrls: r.visited.size,
    cursor: deriveCursor(r.workstream, state),
    seedsConsulted: false,
    tiersWithWork: [...r.queuedByTier.keys()].sort(),
  };
}
