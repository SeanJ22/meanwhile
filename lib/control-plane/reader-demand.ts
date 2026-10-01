/**
 * **WHAT READERS ARE ASKING FOR, FOR THE NOW VIEW'S DEMAND PANEL.** Aggregate
 * only: counts of events by place, government, meeting, official, question topic
 * and "get this sooner" subject, never a person, session or device (there is none
 * in the store). Organic traffic only, so a walk of ours is never read as demand.
 *
 * Built on `readReaderIntel`, which refuses any record carrying a field that could
 * key back to one reader. The figures are also checked against their own
 * denominators; a count larger than what it was counted from refuses the panel
 * instead of showing a wrong number.
 */
import { displayNameOf } from "./display-name.ts";
import {
  impossibleNumbersIn,
  openReaderStore,
  readReaderIntel,
  readerWindow,
  renderedNumbersOf,
  type CountedKey,
  type TopList,
} from "./reader-intel.ts";

export const READER_DEMAND_DAYS = 30;
const SHOWN = 5;

export interface DemandList {
  readonly rows: readonly CountedKey[];
  /** Most-opened keys that could not be turned into a name yet, and so are not listed. Never hidden: the panel says so. */
  readonly unnamed?: number;
  /** Distinct keys that exist in the window, of which the rows are the top few. */
  readonly distinct: number;
}

export type ReaderDemandReading =
  | {
      readonly kind: "READ";
      readonly observedAt: string;
      readonly days: number;
      readonly organicEvents: number;
      readonly otherEvents: number;
      readonly zips: DemandList;
      readonly districts: DemandList;
      readonly meetings: DemandList;
      readonly officials: DemandList;
      readonly askTopics: DemandList;
      readonly wantedSooner: DemandList;
      readonly wantedSoonerTotal: number;
    }
  | { readonly kind: "NOT_READ"; readonly observedAt: string; readonly says: string };

const top = (list: TopList): DemandList => ({ rows: list.rows.slice(0, SHOWN), distinct: list.distinct });

/**
 * The same list with each stored key read as the name a person would say, never
 * the id. A key the name projection cannot place is not listed (an id is not a
 * name); how many of the most-opened were left out is counted beside it.
 */
const named = (list: TopList): DemandList => {
  const read = list.rows.map((row) => ({ row, name: displayNameOf(row.key) }));
  return {
    rows: read.filter((r) => r.name.recognised).slice(0, SHOWN).map((r) => ({ ...r.row, label: r.name.name })),
    unnamed: read.filter((r) => !r.name.recognised).length,
    distinct: list.distinct,
  };
};

export async function readReaderDemand(observedAt: string): Promise<ReaderDemandReading> {
  const store = openReaderStore();
  if (!store.ok) return { kind: "NOT_READ", observedAt, says: store.detail };
  const intel = await readReaderIntel(store.sql, readerWindow(observedAt, READER_DEMAND_DAYS), "ORGANIC");
  if (intel.activity.kind !== "HELD") return { kind: "NOT_READ", observedAt, says: intel.activity.detail };
  const impossible = impossibleNumbersIn(renderedNumbersOf(intel));
  if (impossible.length > 0) {
    return { kind: "NOT_READ", observedAt, says: `The figures did not pass their own check, so none are shown (${impossible.join("; ")}).` };
  }
  const a = intel.activity.value;
  const demand = intel.demand.kind === "HELD" ? intel.demand.value : null;
  return {
    kind: "READ",
    observedAt,
    days: READER_DEMAND_DAYS,
    organicEvents: a.census.organic,
    otherEvents: a.census.total - a.census.organic,
    zips: top(a.topZips),
    districts: named(a.topDivisions),
    meetings: named(a.topMeetings),
    officials: named(a.topOfficials),
    askTopics: top(a.topAskTopics),
    wantedSooner: demand ? named(demand.topSubjects) : { rows: [], distinct: 0 },
    wantedSoonerTotal: demand ? demand.total : 0,
  };
}
