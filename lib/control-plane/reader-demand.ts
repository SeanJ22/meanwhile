/** Aggregate counts only, organic traffic only. A count larger than its denominator refuses the panel. */
import { displayNameOf } from "./display-name.ts";
import { controlPlaneQuery } from "../core/work.ts";
import type { Query } from "../facts/publish.ts";
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

/** Where the presses of "get this sooner" stand in the one work list: one hunt per subject, in the reader tier. */
export interface DemandInLine {
  readonly waiting: number;
  readonly working: number;
  readonly rows: readonly { readonly key: string; readonly label: string; readonly presses: number; readonly working: boolean; readonly since: string }[];
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
      /** Null when the work list could not be read just now. */
      readonly inLine: DemandInLine | null;
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

/** Small by construction: a count per status and the few busiest subjects. Nothing else of any job is read. */
export async function readDemandInLine(query: Query): Promise<DemandInLine> {
  const [counts, top] = await Promise.all([
    query(`SELECT status,count(*)::int AS n FROM work WHERE tier='reader' AND kind='hunt' AND status IN ('waiting','taken') GROUP BY status`),
    query(`SELECT subject_id,status,coalesce((origin->>'presses')::int,0) AS presses,received_at FROM work
      WHERE tier='reader' AND kind='hunt' AND status IN ('waiting','taken') ORDER BY priority DESC,received_at LIMIT ${SHOWN * 4}`),
  ]);
  const count = (status: string) => Number(counts.find(row => row.status === status)?.n ?? 0);
  return {
    waiting: count("waiting"), working: count("taken"),
    rows: top.flatMap(row => {
      const name = displayNameOf(String(row.subject_id));
      return name.recognised ? [{ key: String(row.subject_id), label: name.name, presses: Number(row.presses), working: row.status === "taken",
        since: new Date(row.received_at as string | Date).toISOString() }] : [];
    }).slice(0, SHOWN),
  };
}

export async function readReaderDemand(observedAt: string, inLine: () => Promise<DemandInLine> = () => readDemandInLine(controlPlaneQuery())): Promise<ReaderDemandReading> {
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
  const waiting = await inLine().catch(() => null);
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
    inLine: waiting,
  };
}
