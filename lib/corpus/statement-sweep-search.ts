/**
 * After the held-captures pass, every person is searched on the open web for
 * the same topics with the same queries. A hit is only a lead for the Scout to
 * open and save; it is never shown as a statement. Due dates come from the
 * `statements.sweepSchedule` setting (tighter nearer the election). Pure: the
 * search function (which owns the paid budget) and the clock are arguments.
 */
import { registerSetting, type SettingValue } from "../control-plane/settings.ts";
import type { ScoutSearch } from "../control-plane/scheduler/scout-contract.ts";
import { POSITION_TOPICS } from "./positions.ts";
import type { SweepPerson } from "./statement-sweep.ts";

export interface SweepScheduleRow {
  /** This row applies when the election is within this many days. */
  readonly withinDays: number;
  /** Then the sweep is due again this many days after the last one. */
  readonly everyDays: number;
}

export const SWEEP_SCHEDULE_SETTING = "statements.sweepSchedule";

/** Far out: monthly. Closing in: every two weeks, weekly, then daily in the last week. */
export const DEFAULT_SWEEP_SCHEDULE: readonly SweepScheduleRow[] = [
  { withinDays: 7, everyDays: 1 },
  { withinDays: 30, everyDays: 7 },
  { withinDays: 90, everyDays: 14 },
  { withinDays: 100000, everyDays: 30 },
];

/** Rows must tighten as the election nears: shorter windows never wait longer. */
export function validSweepSchedule(value: unknown): value is readonly SweepScheduleRow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return false;
  let prev: SweepScheduleRow | null = null;
  for (const row of value as unknown[]) {
    if (typeof row !== "object" || row === null) return false;
    const { withinDays, everyDays } = row as Record<string, unknown>;
    if (typeof withinDays !== "number" || typeof everyDays !== "number") return false;
    if (!Number.isInteger(withinDays) || !Number.isInteger(everyDays) || withinDays < 1 || everyDays < 1) return false;
    if (prev && (withinDays <= prev.withinDays || everyDays < prev.everyDays)) return false;
    prev = { withinDays, everyDays };
  }
  return true;
}

registerSetting({
  key: SWEEP_SCHEDULE_SETTING, label: "How often the statement sweep runs as the election nears",
  defaultValue: DEFAULT_SWEEP_SCHEDULE as unknown as SettingValue,
  readerFacing: false, control: "json",
  validate: (value): value is SettingValue => validSweepSchedule(value),
});

const DAY_MS = 86_400_000;

/** Whole days from `now` to the election day (negative after it). Null when the date is unreadable. */
export function daysToElection(electionDay: string, now: Date): number | null {
  const day = Date.parse(`${electionDay}T00:00:00Z`);
  if (!Number.isFinite(day)) return null;
  return Math.ceil((day - now.getTime()) / DAY_MS);
}

/** The interval that applies now. The tightest row that covers the days left wins. */
export function sweepIntervalDays(
  daysLeft: number | null,
  schedule: readonly SweepScheduleRow[] = DEFAULT_SWEEP_SCHEDULE,
): number {
  const rows = [...schedule].sort((a, b) => a.withinDays - b.withinDays);
  // An unknown or past election date keeps the loosest row: it never tightens on a guess.
  if (daysLeft === null || daysLeft < 0) return rows[rows.length - 1].everyDays;
  return (rows.find((r) => daysLeft <= r.withinDays) ?? rows[rows.length - 1]).everyDays;
}

/** When the next sweep is due. A person never swept is due now. */
export function sweepDueAt(
  lastSweptAt: string | null,
  electionDay: string,
  now: Date,
  schedule: readonly SweepScheduleRow[] = DEFAULT_SWEEP_SCHEDULE,
): Date {
  const last = lastSweptAt === null ? NaN : Date.parse(lastSweptAt);
  if (!Number.isFinite(last)) return now;
  return new Date(last + sweepIntervalDays(daysToElection(electionDay, now), schedule) * DAY_MS);
}

export function sweepIsDue(
  lastSweptAt: string | null,
  electionDay: string,
  now: Date,
  schedule: readonly SweepScheduleRow[] = DEFAULT_SWEEP_SCHEDULE,
): boolean {
  return sweepDueAt(lastSweptAt, electionDay, now, schedule).getTime() <= now.getTime();
}

/**
 * The same query kinds for every person and every topic. The second one is how
 * a candidate with no campaign site is found in a county voter guide.
 */
export const SWEEP_QUERY_KINDS = ["own words", "voter guide"] as const;
export type SweepQueryKind = (typeof SWEEP_QUERY_KINDS)[number];

export interface SweepSearchTopic {
  readonly id: string;
  readonly label: string;
}

export function sweepQuery(person: SweepPerson, topic: SweepSearchTopic, kind: SweepQueryKind): string {
  const name = `"${person.name.trim()}"`;
  return kind === "own words"
    ? `${name} ${topic.label} statement OR position OR plan`
    : `${name} ${topic.label} voter guide candidate questionnaire`;
}

export interface SweepSearchRun {
  readonly topic: string;
  readonly kind: SweepQueryKind;
  readonly query: string;
  readonly hits: number;
  /** Named when the provider or its budget refused; the query then does not count as searched. */
  readonly error: string | null;
}

export interface SweepLead {
  readonly topic: string;
  readonly url: string;
  readonly title: string;
  readonly provider: string;
}

export interface SweepSearchRecord {
  readonly subjectId: string;
  readonly searched: readonly SweepSearchRun[];
  /** Pointers for the Scout to open and save. Never shown to a reader. */
  readonly leads: readonly SweepLead[];
  /** Every topic got every query kind, and none was refused. */
  readonly complete: boolean;
}

const DEFAULT_TOPICS: readonly SweepSearchTopic[] = POSITION_TOPICS.map((t) => ({ id: t, label: t }));

/** Search one person: every topic, every query kind, in a fixed order. */
export async function searchSweepPerson(
  person: SweepPerson,
  search: ScoutSearch,
  topics: readonly SweepSearchTopic[] = DEFAULT_TOPICS,
): Promise<SweepSearchRecord> {
  const searched: SweepSearchRun[] = [];
  const leads = new Map<string, SweepLead>();
  for (const topic of topics) {
    for (const kind of SWEEP_QUERY_KINDS) {
      const query = sweepQuery(person, topic, kind);
      try {
        const result = await search({ query });
        // A provider erroring with no answer from any other is a refused query.
        const refused = result.providersUsed.length === 0 && result.errors.length > 0;
        searched.push({ topic: topic.id, kind, query, hits: result.hits.length, error: refused ? result.errors.join("; ") : null });
        if (!refused) {
          for (const hit of result.hits) {
            const key = `${topic.id}\u0000${hit.url}`;
            if (!leads.has(key)) leads.set(key, { topic: topic.id, url: hit.url, title: hit.title, provider: hit.provider });
          }
        }
      } catch (error) {
        searched.push({ topic: topic.id, kind, query, hits: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return {
    subjectId: person.subjectId,
    searched,
    leads: [...leads.values()],
    complete: searched.length === topics.length * SWEEP_QUERY_KINDS.length && searched.every((s) => s.error === null),
  };
}

/** The same search for every person, one after another (the paid budget meters each query). */
export async function searchSweepPeople(
  people: readonly SweepPerson[],
  search: ScoutSearch,
  topics: readonly SweepSearchTopic[] = DEFAULT_TOPICS,
): Promise<SweepSearchRecord[]> {
  const out: SweepSearchRecord[] = [];
  for (const p of people) out.push(await searchSweepPerson(p, search, topics));
  return out;
}

/**
 * "Not found in the sources checked" needs the held pass and the search to have
 * run in full for the topic. A refused query leaves the topic open.
 */
export function searchCoversTopic(record: SweepSearchRecord, topic: string): boolean {
  return SWEEP_QUERY_KINDS.every((kind) => record.searched.some((s) => s.topic === topic && s.kind === kind && s.error === null));
}
