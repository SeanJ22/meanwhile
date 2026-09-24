/**
 * **WHAT THE FREE WALK LAST RECORDED, READ ONCE A CYCLE FOR THE PAID LANE.**
 * (2026-09-24. MW-028's free-walk-first hold.)
 *
 * `paidDiscoveryHold` lets a paid Scout take an owner-dispatched meetings-
 * discovery row only after the unpaid walk has had its turn. This is the
 * reading the hold asks for (`FreeDiscoveryWalks`), taken from the walk's own
 * attempt log (`cp_log_discovery_attempts`) in ONE batched read a cycle. It
 * reads the newest attempt of each dispatched government, cut down to its
 * outcome, when it finished and its leads (`readLatest`). A cycle therefore
 * never downloads whole walks to learn three fields.
 *
 * ```
 *   FOUND             the newest walk confirmed a route
 *   WALKED_NOT_FOUND  the newest walk confirmed nothing: the site showed
 *                     nothing or only leads, was a wall, or could not be read.
 *                     The free lane had its turn. For a wall or an unreadable
 *                     site the paid lane is the other path (RULING 248)
 *   NOT_WALKED        no walk is recorded yet: the free walk goes first
 *   NO_SITE_TO_WALK   no site the walk can open is recorded (find-own-site):
 *                     the free lane has nothing to try, so the paid lane may go
 *   UNREAD            the log could not be read, or the government's need
 *                     could not be derived: the row stays held, so a failed
 *                     read never opens the paid lane
 * ```
 *
 * The leads travel with the reading as evidence for the Scout's brief. They
 * show where the free walk saw a meetings page or a publisher it could not
 * confirm, so paid work starts from them rather than from nothing. They are
 * evidence only, and the Scout still confirms.
 */

import type { DiscoveryOutcome } from "../../hunt/meetings-site-discovery.ts";
import type { ControlPlaneRepositories, RecordProjection } from "../repository/types.ts";
import type { FreeDiscoveryWalks, FreeWalkOutcome } from "../scheduler/provider-inputs.ts";

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
  subjects: readonly FreeWalkSubject[],
): Promise<FreeDiscoveryWalks> {
  const byId = new Map(subjects.map((s) => [s.jurisdictionId, s]));
  const toRead = subjects.filter((s) => s.walkable === true).map((s) => s.jurisdictionId);
  let latest: ReadonlyMap<string, unknown>;
  try {
    latest = toRead.length === 0 ? new Map() : await repos.discoveryAttempts.readLatest(toRead, FREE_WALK_PROJECTION);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      latestFor: () => "UNREAD",
      evidenceFor: () => null,
      source: `the discovery-attempt log could not be read (${why}), so every dispatched discovery row stays held`,
    };
  }
  const records = new Map<string, FreeWalkRecord>();
  const unreadable = new Set<string>();
  for (const [jurisdictionId, value] of latest) {
    const record = asFreeWalkRecord(value);
    if (record === null) unreadable.add(jurisdictionId);
    else records.set(jurisdictionId, record);
  }
  return {
    latestFor: (jurisdictionId) =>
      unreadable.has(jurisdictionId) ? "UNREAD" : freeWalkOutcome(byId.get(jurisdictionId), records.get(jurisdictionId)),
    evidenceFor: (jurisdictionId) =>
      unreadable.has(jurisdictionId) ? null : freeWalkBrief(byId.get(jurisdictionId), records.get(jurisdictionId)),
    source:
      `the discovery-attempt log, newest walk of ${toRead.length} dispatched government(s) with a site to walk` +
      (unreadable.size === 0 ? "" : `; ${unreadable.size} walk record(s) could not be read, and their rows stay held`),
  };
}
