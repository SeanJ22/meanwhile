import type { DoorDraft, DoorRecord } from "../doors/registry.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** These are source-door settings, editable with the other source clocks in Admin. */
export const ELECTION_RESULT_CLOCK_DEFAULTS = {
  countingMinutes: 360,
  calledMinutes: 1_440,
  calledDays: 7,
  weeklyMinutes: 10_080,
} as const;

export interface ElectionResultClockState {
  readonly status: string;
  readonly lastCheckedAt?: string | null;
  readonly statusChangedAt?: string | null;
  readonly calledAt?: string | null;
}

type SourceClock = Pick<DoorRecord, "config" | "checkEveryMinutes" | "status">;

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** A race's source clock; no database lookup or source body is needed to decide. */
export function nextElectionResultCheck(race: ElectionResultClockState, door: SourceClock | undefined,
  now: string | Date): string | null {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("Election result clock requires a valid time");
  if (race.status === "certified" || door?.status === "SUSPENDED") return null;
  const checkedMs = Date.parse(race.lastCheckedAt ?? "");
  if (!Number.isFinite(checkedMs) || checkedMs > nowMs) return new Date(nowMs).toISOString();
  const settings = door?.config ?? {};
  const calledMs = Date.parse(race.calledAt ?? race.statusChangedAt ?? "");
  const calledDays = positive(settings.calledDays, ELECTION_RESULT_CLOCK_DEFAULTS.calledDays);
  const called = race.status === "called" || race.status === "unopposed";
  const firstWeek = !Number.isFinite(calledMs) || nowMs < calledMs + calledDays * DAY;
  const interval = called
    ? firstWeek ? positive(settings.calledMinutes, ELECTION_RESULT_CLOCK_DEFAULTS.calledMinutes)
      : positive(settings.weeklyMinutes, ELECTION_RESULT_CLOCK_DEFAULTS.weeklyMinutes)
    : positive(settings.countingMinutes, ELECTION_RESULT_CLOCK_DEFAULTS.countingMinutes);
  return new Date(checkedMs + positive(door?.checkEveryMinutes, interval) * MINUTE).toISOString();
}

/** The two readers use the existing source registry and its edit/history/undo path. */
export function electionResultsDoorDrafts(): DoorDraft[] {
  return ([
    ["multistate", "multistate.us", "State races and ballot measures"],
    ["ballotpedia", "ballotpedia.org", "U.S. Senate and U.S. House races"],
  ] as const).map(([source, host, scope]) => ({
    doorId: `feed:election-results:${source}`,
    kind: "source-feed",
    hosts: [host],
    holds: ["election-results"],
    checkEveryMinutes: null,
    config: { sourceId: source, scope, contractId: `election-results:${source}`,
      ...ELECTION_RESULT_CLOCK_DEFAULTS },
    notes: "Every six hours while counting; daily for seven days after a call, then weekly until certified.",
    status: "OPEN",
  }));
}
