/** An EXPECTED item is listed as expected and never counted as a win. PURE. */
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
            // A proven fix that broke reads "Proven, broke since", never a plain Testing or Proven.
      id: u.id, what: u.what, when: formatEastern(u.at), label: u.setback === true ? `Proven, broke since ${easternDay(u.at)}` : UPDATE_LABEL_WORDS[u.label],
      isWin: u.label !== "EXPECTED" && u.setback !== true,
      before: u.before, after: u.after, evidenceHref: u.evidenceHref,
    })),
  };
}

const CHANGES_RECENT_MS = 2 * 24 * 60 * 60 * 1000;
const CHANGES_MOST = 10;

export function updatesFromChanges(rows: readonly ChangeRow[], nowMs: number): readonly NewUpdate[] {
  return rows
    .filter((r) => (r.status === "live" || r.status === "on-test" || r.status === "deploying") && nowMs - Date.parse(r.at) <= CHANGES_RECENT_MS)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, CHANGES_MOST)
    .map((r) => ({ id: `change:${r.number}:${r.status === "live" ? "live" : "soon"}`, what: r.line, at: r.at,
      label: r.status === "live" ? "TESTING" as const : "EXPECTED" as const, evidenceHref: r.url }));
}

const OWED_KIND_WORDS: Readonly<Record<string, string>> = {
  body: "government bodies", seat: "seats", contest: "elections", funding: "funding records", deadline: "filing deadlines", rollcall: "roll calls", calendar: "meeting calendars",
};

/** Added work, not a win, so labeled Expected; stable per place and kind, so a repeated read adds it once. */
export function owedKindUpdates(input: {
  readonly placeKey: string;
  readonly placeLabel: string;
  readonly rows: readonly { readonly id?: string; readonly requirement?: string; readonly subject: { readonly kind: string; readonly label?: string }; readonly owedSince?: string | null }[];
  readonly missionStart: string | null;
}): readonly NewUpdate[] {
  if (input.missionStart === null) return [];
  const start = Date.parse(input.missionStart);
  const byKind = new Map<string, { n: number; first: string }>();
  for (const row of input.rows) {
    const since = row.owedSince ?? null;
    if (since === null || !(Date.parse(since) > start)) continue;
    const seen = byKind.get(row.subject.kind);
    byKind.set(row.subject.kind, { n: (seen?.n ?? 0) + 1, first: seen === undefined || Date.parse(since) < Date.parse(seen.first) ? since : seen.first });
  }
  return [...byKind].sort(([a], [b]) => a.localeCompare(b)).map(([kind, { n, first }]) => ({
    id: `owed-kind:${input.placeKey}:${kind}`,
    what: `${input.placeLabel}: found new ${OWED_KIND_WORDS[kind] ?? kind}, so ${n} more ${n === 1 ? "item is" : "items are"} now owed.`,
    at: first,
    label: "EXPECTED" as const,
  }));
}
