/** Aggregate counts only, organic traffic only. A count larger than its denominator refuses the panel. */
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

/** A key the name projection cannot place is not listed, only counted. */
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
