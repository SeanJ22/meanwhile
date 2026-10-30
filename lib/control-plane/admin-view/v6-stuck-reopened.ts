import type { Query } from "../../facts/publish.ts";
import type { AdminV6StuckItem } from "./v6-stuck-read.ts";
import { formatEastern } from "../eastern-time.ts";

export const REOPENED_ITEM_LIMIT = 20;
const REOPENED_DAYS = 7;

const NEW_ROW_WORDS: Readonly<Record<string, string>> = {
  waiting: "Back on the work list, waiting its turn.",
  taken: "Back on the list and being worked now.",
  done: "Worked again and finished.",
  refused: "Worked again and is a dead end again.",
};

const needWords = (unlock: Record<string, unknown>): string => {
  const what = String(unlock.name ?? unlock.platform ?? unlock.state ?? "this");
  return unlock.kind === "parser" ? `a reader for ${what}` : unlock.kind === "key" ? `the key ${what}` : unlock.kind === "tool" ? `the tool ${what}`
    : unlock.kind === "source" ? `the source ${what}` : `a method that worked for ${what}`;
};

/** The dead ends that went back on the work list in the last week, newest first, each with the state of its row now. Small by construction. */
export async function readReopenedItems(query: Query, nowIso: string, limit = REOPENED_ITEM_LIMIT): Promise<readonly AdminV6StuckItem[]> {
  const rows = await query(`SELECT id, reopened, status FROM work
    WHERE reopened IS NOT NULL AND (reopened->>'at')::timestamptz > $1::timestamptz - make_interval(days => ${REOPENED_DAYS})
    ORDER BY reopened->>'at' DESC LIMIT $2`, [nowIso, limit]);
  return rows.map((row): AdminV6StuckItem => {
    const reopened = row.reopened as { at: string; because: string; waitedFor: Record<string, unknown> | null }, unlock = reopened.waitedFor ?? {};
    const hours = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(reopened.at)) / 3_600_000));
    return {
      id: `reopened:${row.id}`, title: `A dead end came back: ${String(unlock.text ?? "").split(/(?<=[.!?])\s/)[0] || "waiting for something new"}`.slice(0, 160), applies: [], lane: "auto",
      cause: `Reopened — ${reopened.because}`, age: hours < 1 ? "reopened just now" : hours < 24 ? `reopened ${hours} hours ago` : `reopened ${Math.floor(hours / 24)} days ago`, ageRank: 0,
      tried: `It was waiting for ${needWords(unlock)}.`, helped: `Reopened ${formatEastern(reopened.at)}.`,
      next: NEW_ROW_WORDS[String(row.status)] ?? "",
      technical: [String(row.id), String(unlock.kind)], owner: "The factory (automatic)", group: "reopened", actions: [],
    };
  });
}
