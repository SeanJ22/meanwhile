import { ONLINE_MARK_WORD } from "./online.ts";

/** Each status carries its own mark, so the statuses stay distinct with colour stripped. Markup lives in `components/map/meeting-status-pill.tsx`. */
export type MeetingPillStatus = "concluded" | "canceled" | "online";

/** One mark per state, and no two alike. If a font lacks one, only decoration degrades: the word beside it is the answer. */
export const STATUS_MARK: Readonly<Record<MeetingPillStatus, string>> = {
  concluded: "✓",
  canceled: "×",
  online: "□",
};

/** The visible word. Distinct in length and in shape, colour or no colour. */
export const STATUS_WORD: Readonly<Record<MeetingPillStatus, string>> = {
  concluded: "Concluded",
  canceled: "Cancelled",
  // Not "Online". The extra word is the whole fact — see ONLINE_MARK_WORD.
  online: ONLINE_MARK_WORD,
};

/** What a screen reader hears after the word: a fact about the sitting, never about our research. */
export const STATUS_QUALIFIER: Readonly<Record<MeetingPillStatus, string>> = {
  concluded: " — this sitting has already happened",
  canceled: " — this sitting was called off",
  online: " — there is no room to attend in person",
};
