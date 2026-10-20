/**
 * What the free walk last recorded for each dispatched government, read once a
 * cycle for the run record from `cp_log_discovery_attempts` in one
 * batched read of the newest attempt's outcome, finish time and leads.
 *
 * ```
 *   FOUND             the newest walk confirmed a route
 *   WALKED_NOT_FOUND  the newest walk confirmed nothing (nothing or only leads,
 *                     a wall, or unreadable); the paid lane is the other path
 *   NOT_WALKED        no walk is recorded yet: paid admission is not held by this
 *   NO_SITE_TO_WALK   no site the walk can open is recorded: the paid lane may go
 *   UNREAD            the log or the need could not be read: the row stays held
 * ```
 *
 * Leads travel as evidence for the Scout's brief; the Scout still confirms.
 */

import type { DiscoveryOutcome } from "../../hunt/meetings-site-discovery.ts";
import type { ControlPlaneRepositories, RecordProjection } from "../repository/types.ts";
import type { FreeDiscoveryWalks, FreeWalkOutcome } from "../scheduler/provider-inputs.ts";
import { plannerMap, plannerSet, type PlannerSpool } from "../scheduler/planner-spool.ts";

/** The fields of a walk the paid lane reads; nothing else of the record travels. */
export const FREE_WALK_PROJECTION: RecordProjection = { outcome: true, finishedAt: true, leads: true };

/** What the paid lane reads of one walk. */
export interface FreeWalkRecord {
  readonly outcome: DiscoveryOutcome;
  readonly finishedAt: string;
  readonly leads: readonly { readonly vendor: string; readonly url: string }[];
}

const OUTCOMES: readonly string[] = ["FOUND", "LEAD", "NOTHING_DETECTED", "BLOCKED", "COULD_NOT_READ"];

/**
 * A narrowed walk as the paid lane reads it, or null when it is not one: a
 * record without a known outcome or a finish time is never guessed at, and its
 * government's row stays held. A lead without a vendor and a URL is dropped.
 */
export function asFreeWalkRecord(value: unknown): FreeWalkRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.outcome !== "string" || !OUTCOMES.includes(v.outcome) || typeof v.finishedAt !== "string") return null;
  const leads = v.leads === undefined ? [] : v.leads;
  if (!Array.isArray(leads)) return null;
  return {
    outcome: v.outcome as DiscoveryOutcome,
    finishedAt: v.finishedAt,
    leads: leads.flatMap((l: unknown) => {
      const lead = l !== null && typeof l === "object" ? (l as Record<string, unknown>) : {};
      return typeof lead.vendor === "string" && typeof lead.url === "string" ? [{ vendor: lead.vendor, url: lead.url }] : [];
    }),
  };
}

/** A dispatched government, and whether the free walk can walk it: null when its need could not be derived. */
export interface FreeWalkSubject {
  readonly jurisdictionId: string;
  readonly walkable: boolean | null;
}

/** The leads a brief names, at most: evidence to start from, never a list to work through. */
const BRIEF_LEADS = 6;

/** What one government's newest walk means for the paid lane. */
export function freeWalkOutcome(subject: FreeWalkSubject | undefined, latest: FreeWalkRecord | undefined): FreeWalkOutcome {
  if (subject === undefined || subject.walkable === null) return "UNREAD";
  if (!subject.walkable) return "NO_SITE_TO_WALK";
  if (latest === undefined) return "NOT_WALKED";
  return latest.outcome === "FOUND" ? "FOUND" : "WALKED_NOT_FOUND";
}

/** The Scout-brief line for one government, or null when the free walk has nothing to hand on. */
export function freeWalkBrief(subject: FreeWalkSubject | undefined, latest: FreeWalkRecord | undefined): string | null {
  const outcome = freeWalkOutcome(subject, latest);
  if (outcome === "NO_SITE_TO_WALK") {
    return "FREE WALK: no website is recorded for this government, so the unpaid walk had nothing to open; finding its own site is the first step";
  }
  if (latest === undefined || (outcome !== "FOUND" && outcome !== "WALKED_NOT_FOUND")) return null;
  const leads = latest.leads;
  const named = leads.slice(0, BRIEF_LEADS).map((l) => `${l.vendor} <${l.url}>`).join(", ");
  return (
    `FREE WALK ${latest.finishedAt}: ${latest.outcome}; ` +
    (leads.length === 0
      ? "no leads"
      : `leads it could not confirm (evidence only; confirm by content): ${named}${leads.length > BRIEF_LEADS ? `, and ${leads.length - BRIEF_LEADS} more` : ""}`)
  );
}

/**
 * The free walk's reading for the dispatched governments, in one batched read.
 * Never throws: a read that fails answers UNREAD for every government, with the
 * failure named in `source`.
 */
export async function readFreeDiscoveryWalks(
  repos: Pick<ControlPlaneRepositories, "discoveryAttempts">,
  subjects: Iterable<FreeWalkSubject>,
  planner?: PlannerSpool,
): Promise<FreeDiscoveryWalks> {
  const byId = planner ? plannerMap<FreeWalkSubject>(planner, "free-walk-subjects") : new Map<string, FreeWalkSubject>();
  const records = planner ? plannerMap<FreeWalkRecord>(planner, "free-walk-records") : new Map<string, FreeWalkRecord>();
  const unreadable = planner ? plannerSet(planner, "free-walk-unreadable") : new Set<string>();
  let toRead = 0;
  try {
    let keys: string[] = [];
    const read = async () => {
      if (!keys.length) return;
      for (const [jurisdictionId, value] of await repos.discoveryAttempts.readLatest(keys, FREE_WALK_PROJECTION)) {
        const record = asFreeWalkRecord(value);
        if (record === null) unreadable.add(jurisdictionId); else records.set(jurisdictionId, record);
      }
      keys = [];
    };
    for (const subject of subjects) {
      byId.set(subject.jurisdictionId, subject);
      if (subject.walkable !== true) continue;
      toRead++; keys.push(subject.jurisdictionId); if (keys.length === 32) await read();
    }
    await read();
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      latestFor: () => "UNREAD",
      evidenceFor: () => null,
      source: `the discovery-attempt log could not be read (${why}), so every dispatched discovery row stays held`,
    };
  }
  return {
    latestFor: (jurisdictionId) =>
      unreadable.has(jurisdictionId) ? "UNREAD" : freeWalkOutcome(byId.get(jurisdictionId), records.get(jurisdictionId)),
    evidenceFor: (jurisdictionId) =>
      unreadable.has(jurisdictionId) ? null : freeWalkBrief(byId.get(jurisdictionId), records.get(jurisdictionId)),
    source:
      `the discovery-attempt log, newest walk of ${toRead} dispatched government(s) with a site to walk` +
      (unreadable.size === 0 ? "" : `; ${unreadable.size} walk record(s) could not be read, and their rows stay held`),
  };
}
