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

export function updatesView(records: readonly UpdateRecord[], observedAt: string): UpdatesView {
  return {
    observedAt,
    updates: [...records].sort((a, b) => b.at.localeCompare(a.at)).map((u) => ({
      id: u.id, what: u.what, when: formatEastern(u.at), label: UPDATE_LABEL_WORDS[u.label], isWin: u.label !== "EXPECTED",
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

const OWED_KIND_WORDS: Readonly<Record<string, string>> = {
  body: "government bodies", seat: "seats", contest: "elections", funding: "funding records", deadline: "filing deadlines", rollcall: "roll calls", calendar: "meeting calendars",
};

/**
 * One update for each new kind of thing a place started owing after its mission started (SC-10). It is added work, not a win, so it is
 * labeled Expected. Stable per place and kind, so a repeated read adds it once. PURE.
 */
export function owedKindUpdates(input: {
  readonly placeKey: string;
  readonly placeLabel: string;
  readonly rows: readonly { readonly subject: { readonly kind: string }; readonly owedSince?: string | null }[];
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
