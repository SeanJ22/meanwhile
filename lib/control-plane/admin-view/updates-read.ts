/**
 * **`admin-view/updates` — the updates Now shows once.** Plain words, Eastern time, labels honest: an EXPECTED
 * item is listed as expected and is never counted as a win. PURE: records in, view out.
 */
import { formatEastern } from "../eastern-time.ts";
import type { ChangeRow } from "../changes/model.ts";
import type { NewUpdate, UpdateLabel, UpdateRecord } from "../updates.ts";

export const UPDATE_LABEL_WORDS: Readonly<Record<UpdateLabel, string>> = {
  PROVEN: "Proven",
  TESTING: "Testing",
  EXPECTED: "Expected, not confirmed yet",
};

export interface UpdateLine {
  readonly id: string;
  readonly what: string;
  readonly when: string;
  readonly label: string;
  readonly isWin: boolean;
  readonly before: string | null;
  readonly after: string | null;
  readonly evidenceHref: string | null;
}

export interface UpdatesView {
  readonly updates: readonly UpdateLine[];
  readonly observedAt: string;
}

const easternDay = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

export function updatesView(records: readonly UpdateRecord[], observedAt: string): UpdatesView {
  return {
    observedAt,
    updates: [...records].sort((a, b) => b.at.localeCompare(a.at)).map((u) => ({
      // DP-34: a proven fix that broke reads "Proven, broke since", never a plain Testing or Proven.
      id: u.id, what: u.what, when: formatEastern(u.at), label: u.setback === true ? `Proven, broke since ${easternDay(u.at)}` : UPDATE_LABEL_WORDS[u.label],
      isWin: u.label !== "EXPECTED" && u.setback !== true,
      before: u.before, after: u.after, evidenceHref: u.evidenceHref,
    })),
  };
}

const CHANGES_RECENT_MS = 2 * 24 * 60 * 60 * 1000;
const CHANGES_MOST = 10;

/** Merged-and-live changes are updates labeled Testing; changes passing checks but not yet live are Expected. */
export function updatesFromChanges(rows: readonly ChangeRow[], nowMs: number): readonly NewUpdate[] {
  return rows
    .filter((r) => (r.status === "live" || r.status === "on-test" || r.status === "deploying") && nowMs - Date.parse(r.at) <= CHANGES_RECENT_MS)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, CHANGES_MOST)
    .map((r) => ({ id: `change:${r.number}:${r.status === "live" ? "live" : "soon"}`, what: r.line, at: r.at,
      label: r.status === "live" ? "TESTING" as const : "EXPECTED" as const, evidenceHref: r.url }));
}
