import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { ScoreboardRow } from "../../app/(admin)/_mw/admin-v6/model.ts";
import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";

export interface FactDoorHour {
  readonly state: string;
  readonly hour: string;
  readonly official: number | null;
  readonly checked: number | null;
}

export interface FactStoreReading {
  readonly blanks: readonly { readonly stage: string; readonly reason: string; readonly n: number }[];
  readonly hours?: readonly FactDoorHour[];
}

export async function readFactStore(query: ReadOnlyQuery, now = new Date()): Promise<FactStoreReading> {
  const [blanks, hours] = await query([
    {text:`SELECT stage,reason,count(*)::int AS n FROM blank GROUP BY 1,2 ORDER BY 3 DESC LIMIT 50`,params:[]},
    {text:`WITH started AS (SELECT min(hour) AS hour FROM count_hour WHERE step IN ('door_official','door_checked'))
      SELECT regions.state,hours.hour,
        CASE WHEN hours.hour >= (SELECT hour FROM started) THEN coalesce(sum(c.n) FILTER(WHERE c.step='door_official'),0)::text END AS official,
        CASE WHEN hours.hour >= (SELECT hour FROM started) THEN coalesce(sum(c.n) FILTER(WHERE c.step='door_checked'),0)::text END AS checked
      FROM unnest($1::text[]) AS regions(state)
      CROSS JOIN generate_series(date_trunc('hour',$2::timestamptz)-interval '23 hours',date_trunc('hour',$2::timestamptz),interval '1 hour') AS hours(hour)
      LEFT JOIN count_hour c ON c.state=regions.state AND c.hour=hours.hour AND c.step IN ('door_official','door_checked')
      GROUP BY regions.state,hours.hour ORDER BY hours.hour DESC,regions.state`,
      params:[[...REGISTRY_STATES.map(state => state.toLowerCase()), "system"],now.toISOString()]},
  ]);
  return { blanks: blanks!.map(r => ({stage:String(r.stage),reason:String(r.reason),n:Number(r.n)})),
    hours: (hours ?? []).map(row => ({ state:String(row.state), hour:new Date(row.hour as string | Date).toISOString(),
      official:row.official === null ? null : Number(row.official), checked:row.checked === null ? null : Number(row.checked) })) };
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

/** Existing blank reasons, independent of reader delivery. */
export function factStoreRows(reading: FactStoreReading | null): readonly [string, ScoreboardRow][] {
  const stuck = "Stuck facts by reason";
  if (reading === null) return [[stuck,{id:stuck,name:stuck,value:null,counts:null,says:"Not measured yet.",notMeasured:"The fact store could not be read just now."}]];
  const blanks=reading.blanks.reduce((k,b)=>k+b.n,0);
  return [[stuck,{id:stuck,name:stuck,notMeasured:null,value:n(blanks),counts:blanks===0?"No open blanks":`${n(blanks)} open blanks`,
    says:blanks===0?"Nothing is stuck.":"Facts still owed, by where each stopped and why.",
    items:reading.blanks.slice(0,10).map(b=>`${n(b.n)} ${blankWords(b.stage,b.reason)}`),
    technical:reading.blanks.map(b=>`${b.stage} · ${b.reason} · ${b.n}`)}]];
}
