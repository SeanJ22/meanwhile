import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { ScoreboardRow } from "../../app/(admin)/_mw/admin-v6/model.ts";

export interface FactStoreReading {
  readonly blanks: readonly { readonly stage: string; readonly reason: string; readonly n: number }[];
}

export async function readFactStore(query: ReadOnlyQuery): Promise<FactStoreReading> {
  const [blanks] = await query([{text:`SELECT stage,reason,count(*)::int AS n FROM blank GROUP BY 1,2 ORDER BY 3 DESC LIMIT 50`,params:[]}]);
  return { blanks: blanks!.map(r => ({stage:String(r.stage),reason:String(r.reason),n:Number(r.n)})) };
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
