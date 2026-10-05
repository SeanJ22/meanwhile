import type { BallotSet } from "../../ballot/types.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import { FINANCE_DOOR_KINDS } from "../../funding/finance-door-reader.ts";
import type { ProvidedObligation, ProviderYield, RouteDescriptor } from "../scheduler/registry.ts";
import { createHash } from "node:crypto";

export interface BallotFinanceInputs {
  /** Only ballots already held by this admitted place pass, never a country payload. */
  readonly ballots: readonly BallotSet[];
  readonly admittedDivisions: readonly string[];
  readonly doors: readonly DoorRecord[];
}
function sourceRoutes(door: DoorRecord): readonly RouteDescriptor[] {
  if (typeof door.config.routeDescriptors !== "string") return [];
  let rows: unknown;
  try { rows = JSON.parse(door.config.routeDescriptors); } catch { throw new Error("The campaign finance door's route descriptions are unreadable."); }
  if (!Array.isArray(rows)) throw new Error("The campaign finance door's route descriptions are unreadable.");
  return rows.map((value: unknown) => {
    const row = value as RouteDescriptor;
    if (!row?.routeId || !row.label || !row.citation || !row.executorReason ||
      !["DETERMINISTIC", "BOUNDED_MODEL_WORKER"].includes(row.executorClass) ||
      !row.open || !["HTTP_GET", "HTTP_POST", "NOT_MACHINE_EXECUTABLE", "ROUTINE_READ"].includes(row.open.kind)) throw new Error("A campaign finance source route lacks its recorded method or evidence.");
    if (row.open.kind === "HTTP_GET" || row.open.kind === "HTTP_POST") {
      const url = new URL(row.open.url);
      if (url.protocol !== "https:" || url.username || url.password || !door.hosts.includes(url.hostname.toLowerCase()) ||
        row.open.kind === "HTTP_POST" && (typeof row.open.body !== "string" || !row.open.contentType)) throw new Error("A finance route is outside its registered source hosts or lacks its recorded request.");
    }
    if (row.open.kind === "ROUTINE_READ" && !row.open.contractIds.length) throw new Error("A finance routine route lacks its existing carrying contract.");
    return row;
  });
}
/** Every held candidacy remains work. Missing doors and method descriptions are
 * discovery needs, never statements that a candidate has no campaign money. */
export function ballotFinanceObligations(input: BallotFinanceInputs): ProviderYield {
  const admitted = new Set(input.admittedDivisions), obligations: ProvidedObligation[] = [], failures: string[] = [];
  const seen = new Map<string, string>();
  for (const ballot of input.ballots) for (const candidate of ballot.candidacies) {
    const contest = ballot.contests.find(row => row.id === candidate.contestId && row.type === "CANDIDACY");
    if (!contest || !admitted.has(contest.ocdId)) continue;
    const identity = JSON.stringify([ballot.election.id, contest.id, contest.ocdId, candidate.givenName, candidate.familyName]);
    if (seen.has(candidate.id)) {
      if (seen.get(candidate.id) !== identity) failures.push("A held candidate has conflicting ballot identities.");
      continue;
    }
    seen.set(candidate.id, identity);
    const matching = input.doors.filter(door => (FINANCE_DOOR_KINDS as readonly string[]).includes(door.kind) &&
      (door.ocdId === contest.ocdId || Array.isArray(door.config.scopeDivisions) && door.config.scopeDivisions.includes(contest.ocdId)));
    const routes: RouteDescriptor[] = [];
    for (const door of matching) {
      try {
        const recorded = sourceRoutes(door);
        if (!recorded.length) failures.push(`Campaign finance door ${door.doorId} has no recorded acquisition method.`);
        routes.push(...recorded.map(route => ({ ...route, routeId: `${door.doorId}:${route.routeId}` })));
      } catch (error) { failures.push(error instanceof Error ? error.message : "A finance source door could not be read."); }
    }
    if (!routes.length) routes.push({ routeId: "finance-source-discovery", label: "Find the candidate's filing source",
      executorClass: "BOUNDED_MODEL_WORKER", executorReason: "The held ballot establishes the candidate; its campaign filing source or recorded acquisition method is still owed.",
      open: { kind: "NOT_MACHINE_EXECUTABLE", target: contest.provenance.sourceUrl ?? contest.ocdId,
        reason: "The existing admitted place worker must discover and register this candidate's finance source; no source address or filing authority is guessed." },
      citation: contest.provenance.sourceUrl ?? "held promoted ballot" });
    const routeIds = routes.map(row => row.routeId);
    if (new Set(routeIds).size !== routeIds.length) { failures.push("A finance door repeats a source route identity."); continue; }
    obligations.push({ recordClass: "campaign-finance", subjectId: candidate.id, scopeDivisions: [contest.ocdId],
      readerImpactAt: /^\d{4}-\d{2}-\d{2}$/.test(ballot.election.date) && Number.isFinite(Date.parse(ballot.election.date)) ? `${ballot.election.date}T00:00:00Z` : null,
      observedChangeRateHours: null, lastWorkedAt: matching.map(door => door.lastSuccessAt).filter((at): at is string => Boolean(at)).sort().at(-1) ?? null, routes });
  }
  // A conflicting candidate is held, rather than the first ballot silently winning.
  if (failures.includes("A held candidate has conflicting ballot identities.")) {
    const conflicts = new Set(input.ballots.flatMap(ballot => ballot.candidacies.filter(candidate => {
      const contest = ballot.contests.find(row => row.id === candidate.contestId);
      return contest && admitted.has(contest.ocdId) && seen.get(candidate.id) !== JSON.stringify([ballot.election.id, contest.id, contest.ocdId, candidate.givenName, candidate.familyName]);
    }).map(candidate => candidate.id)));
    for (let at = obligations.length - 1; at >= 0; at--) if (conflicts.has(obligations[at].subjectId)) obligations.splice(at, 1);
  }
  return { obligations, readFailure: failures.length ? [...new Set(failures)].join("; ") : null,
    emptyReason: obligations.length ? null : "No admitted held ballot candidates are available yet; ballot acquisition remains work." };
}
/** Stable technical key, independent of a candidate's changing display name. */
export function ballotFinanceScheduledId(record: ProvidedObligation, route: RouteDescriptor): string {
  return `freshness:ballot-finance:${createHash("sha256").update(JSON.stringify([record.subjectId, route.routeId])).digest("hex")}`;
}
