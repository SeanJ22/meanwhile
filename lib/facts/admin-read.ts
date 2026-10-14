import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { ScoreboardRow } from "../../app/(admin)/_mw/admin-v6/model.ts";

export interface FactStoreReading {
  /** Oldest first, one entry per hour that had a fact go live. */
  readonly hours: readonly { readonly hour: string; readonly live: number }[];
  readonly lastHour: number;
  readonly last24: number;
  readonly liveNow: number;
  readonly blanks: readonly { readonly stage: string; readonly reason: string; readonly n: number }[];
}

const FACT_STORE_SQL = [
  `SELECT date_trunc('hour', live_at) AS hour, count(*)::int AS live FROM fact
     WHERE live_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 1`,
  `SELECT count(*)::int AS n FROM fact WHERE status = 'live'`,
  `SELECT stage, split_part(reason, ':', 1) AS family, reason, count(*)::int AS n FROM blank GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 50`,
] as const;

export async function readFactStore(query: ReadOnlyQuery, nowIso: string): Promise<FactStoreReading> {
  const [hours, live, blanks] = await query(FACT_STORE_SQL.map(text => ({ text, params: [] })));
  const rows = hours!.map(r => ({ hour: new Date(r.hour as string).toISOString(), live: Number(r.live) }));
  const lastHourStart = Math.floor(Date.parse(nowIso) / 3_600_000) * 3_600_000 - 3_600_000;
  return {
    hours: rows,
    lastHour: rows.find(r => Date.parse(r.hour) === lastHourStart)?.live ?? 0,
    last24: rows.reduce((k, r) => k + r.live, 0),
    liveNow: Number(live![0]?.n ?? 0),
    blanks: blanks!.map(r => ({ stage: String(r.stage), reason: String(r.reason), n: Number(r.n) })),
  };
}

const STAGE_WORDS: Readonly<Record<string, string>> = {
  ACQUIRE: "not found yet", READ: "found but not read yet", CHECK: "failed the source check", DECIDE: "lost to a better source", PUBLISH: "could not be written",
};
const REASON_WORDS: Readonly<Record<string, string>> = {
  QUOTE_NOT_ON_SAVED_COPY: "the quoted words are not on the saved page",
  VALUE_NOT_IN_QUOTE: "the value is not in the quoted words",
  PAGE_NOT_ABOUT_ENTITY: "the saved page is about someone or somewhere else",
  COPY_OUTSIDE_FRESHNESS_WINDOW: "the saved page is too old for this kind of fact",
  ARCHIVE_NEVER_PROVES_PRESENT: "an archived page cannot show what is true today",
  SECOND_SOURCE_REQUIRED: "this is a judgment call and needs a second source",
  NO_SAVED_COPY: "no saved copy of the source page is held",
};

function blankWords(stage: string, reason: string): string {
  const code = reason.replace(/^CHECK_FAILED:/, "").replace(/^SECOND_/, "");
  const why = REASON_WORDS[code] ?? null;
  const prefix = reason.includes("SECOND_") && code !== "SECOND_SOURCE_REQUIRED" ? "the second source: " : "";
  return `${STAGE_WORDS[stage] ?? "stuck"}${why ? `: ${prefix}${why}` : ""}`;
}

const n = (k: number) => k.toLocaleString("en-US");
const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric" });

/** The fact store's own numbers, shown beside the older record counts while classes move over. */
export function factStoreRows(reading: FactStoreReading | null): readonly [string, ScoreboardRow][] {
  const live = "Facts live per hour (fact store)", stuck = "Stuck facts by reason";
  if (reading === null) {
    const why = "The fact store could not be read just now.";
    return [[live, { id: live, name: live, value: null, counts: null, says: "Not measured yet.", notMeasured: why }],
      [stuck, { id: stuck, name: stuck, value: null, counts: null, says: "Not measured yet.", notMeasured: why }]];
  }
  const blanks = reading.blanks.reduce((k, b) => k + b.n, 0);
  return [
    [live, { id: live, name: live, notMeasured: null, value: n(reading.lastHour),
      counts: `${n(reading.last24)} facts went live in the last 24 hours · ${n(reading.liveNow)} live now`,
      says: "Facts that went live in the last full hour, each on its own with its saved source. The older count above counts whole records.",
      trend: reading.hours.map(h => ({ label: hourLabel(h.hour), value: h.live })) }],
    [stuck, { id: stuck, name: stuck, notMeasured: null, value: n(blanks),
      counts: blanks === 0 ? "No open blanks" : `${n(blanks)} open blanks`,
      says: blanks === 0 ? "Nothing is stuck." : "Facts still owed, by where each stopped and why.",
      items: reading.blanks.slice(0, 10).map(b => `${n(b.n)} ${blankWords(b.stage, b.reason)}`),
      technical: reading.blanks.map(b => `${b.stage} · ${b.reason} · ${b.n}`) }],
  ];
}
