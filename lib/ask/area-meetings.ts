import { normalizeName } from "../routing/exact-name.ts";
import type { EvidenceGap, EvidenceRecord } from "./evidence.ts";
import { localDate, readableSitting, type SittingTime } from "./meeting-time.ts";

/**
 * "What meetings are happening this week?": a question about meetings in a
 * window, naming no body, answered from the sittings held for the reader's
 * divisions. The next few by time, each with its body, title and zone, and how
 * many more are held in the window.
 *
 * Windows are calendar days in each sitting's own zone, counted from today in
 * that zone. "This week" is the next seven days. An empty window is a named
 * gap of ours.
 */

export type AreaWindow = "TODAY" | "TOMORROW" | "THIS_WEEK" | "NEXT_WEEK" | "THIS_MONTH" | "SOON";

export interface AreaMeetingsAsk {
  window: AreaWindow;
}

/** The days from today, inclusive, and how the answer says the window. */
const WINDOWS: Readonly<Record<AreaWindow, { from: number; to: number; phrase: string }>> = {
  TODAY: { from: 0, to: 0, phrase: "today" },
  TOMORROW: { from: 1, to: 1, phrase: "tomorrow" },
  THIS_WEEK: { from: 0, to: 6, phrase: "in the next 7 days" },
  NEXT_WEEK: { from: 7, to: 13, phrase: "in the 7 days after that" },
  THIS_MONTH: { from: 0, to: 30, phrase: "in the next 31 days" },
  SOON: { from: 0, to: 13, phrase: "in the next 14 days" },
};

/** Written against `normalizeName`. The window word, when there is one, is the one capturing group. */
const WINDOW_WORD = "(?: (today|tomorrow|this week|next week|this month|soon|coming up|upcoming))?";
const NEAR_ME = "(?: (?:near me|nearby|in my area|around me|where i live|for me))?";
const FORMS: readonly RegExp[] = [
  new RegExp(`^what (?:government |public |local )?meetings (?:are|is) (?:happening|scheduled|going on|coming up|on|taking place)${WINDOW_WORD}${NEAR_ME}${WINDOW_WORD}$`),
  new RegExp(`^(?:are|is) there (?:any |a |an )?(?:government |public |local |city |county )?meetings?${NEAR_ME}${WINDOW_WORD}${NEAR_ME}$`),
  new RegExp(`^(?:what|which) (?:government |public |local )?meetings (?:can|could|should) i (?:go to|attend)${WINDOW_WORD}${NEAR_ME}${WINDOW_WORD}$`),
  new RegExp(`^(?:show me |list )?(?:the )?(upcoming) (?:government |public |local )?meetings${NEAR_ME}$`),
  new RegExp(`^what(?: s| is) (?:happening|going on)${WINDOW_WORD}${NEAR_ME}${WINDOW_WORD} (?:in|with) (?:local )?government$`),
  new RegExp(`^when(?: is| s) the next (?:government |public |local )?meeting${NEAR_ME}$`),
];

const WINDOW_BY_WORD: Readonly<Record<string, AreaWindow>> = {
  today: "TODAY", tomorrow: "TOMORROW", "this week": "THIS_WEEK", "next week": "NEXT_WEEK", "this month": "THIS_MONTH",
  soon: "SOON", "coming up": "SOON", upcoming: "SOON",
};

/** The meetings-near-me question this is, with its window, or null. Nothing is bound here. */
export function areaMeetingsQuestion(question: string): AreaMeetingsAsk | null {
  const normalized = normalizeName(question);
  if (!normalized || normalized.length > 100) return null;
  for (const form of FORMS) {
    const match = form.exec(normalized);
    if (!match) continue;
    const words = match.slice(1).filter(Boolean) as string[];
    return { window: WINDOW_BY_WORD[words[0] ?? ""] ?? "SOON" };
  }
  return null;
}

/** A sitting as the route holds it, narrowed to what is read here. */
export interface AreaSitting extends SittingTime {
  id: string;
  title: string;
  bodyName: string;
  bodyId: string | null;
  status: string;
  provenance?: { sourceUrl: string | null; sourceOrg: string; collectedAt: string } | null;
  agendaUrl?: string | null;
}

/** Whole days from the reader's today to the sitting's day, both read in the sitting's own zone. */
function daysFromToday(sitting: SittingTime, now: number): number {
  const today = localDate({ startsAt: new Date(now).toISOString(), timeZone: sitting.timeZone });
  return Math.round((Date.parse(`${localDate(sitting)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** How many sittings are listed by name; the rest are counted. */
export const AREA_MEETINGS_LISTED = 4;

export interface AreaMeetingsComposition {
  answer: string;
  citedUrls: string[];
  /** The sittings in the window, in time order — the records the reader is shown are the first few. */
  inWindow: AreaSitting[];
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  missingAnswer?: boolean;
}

/** Compose the answer from the sittings held for the reader's divisions. */
export function composeAreaMeetings(input: {
  ask: AreaMeetingsAsk;
  sittings: readonly AreaSitting[];
  now: number;
  /** How a sitting's body is named beside the others: its own name and, where that does not say, where it governs. */
  label?: (sitting: AreaSitting) => string;
}): AreaMeetingsComposition {
  const labelOf = input.label ?? ((sitting: AreaSitting) => sitting.bodyName);
  const window = WINDOWS[input.ask.window];
  const inWindow = input.sittings
    .filter((sitting) => sitting.status !== "CANCELED" && Date.parse(sitting.startsAt) >= input.now)
    .filter((sitting) => {
      const days = daysFromToday(sitting, input.now);
      return days >= window.from && days <= window.to;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (inWindow.length === 0) {
    const statement = `We don't have meeting information ${window.phrase} for your area yet.`;
    return { answer: statement, citedUrls: [], inWindow, records: [], gaps: [{ whose: "OURS", statement }], missingAnswer: true };
  }
  const listed = inWindow.slice(0, AREA_MEETINGS_LISTED);
  const items = listed.map((sitting) => {
    const same = sitting.title && sitting.title !== sitting.bodyName ? ` (${sitting.title})` : "";
    return `${labelOf(sitting)}${same}, ${readableSitting(sitting)}`;
  });
  const lead = `${inWindow.length === 1 ? "We hold 1 meeting" : `We hold ${inWindow.length} meetings`} ${window.phrase} for the governments in your area: `;
  const more = inWindow.length - listed.length;
  const answer = `${lead}${items.join("; ")}${more > 0 ? `; and ${more} more, listed below` : ""}.`;
  const records: EvidenceRecord[] = listed.map((sitting) => ({
    kind: "MEETING", id: sitting.id, bodyId: sitting.bodyId,
    text: `${labelOf(sitting)}: ${sitting.title}, ${readableSitting(sitting)}.`,
    occurredAt: sitting.startsAt,
    sourceUrl: sitting.provenance?.sourceUrl ?? sitting.agendaUrl ?? null,
    sourceOrg: sitting.provenance?.sourceOrg ?? null,
    retrievedAt: sitting.provenance?.collectedAt ?? null,
  }));
  return { answer, citedUrls: [...new Set(records.flatMap((record) => record.sourceUrl ? [record.sourceUrl] : []))], inWindow, records, gaps: [] };
}
