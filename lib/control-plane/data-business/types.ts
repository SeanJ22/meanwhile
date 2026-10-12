/**
 * The data business: what goes in, what may come out. Capture and the event store (`lib/db/reader-events.ts`) hold what readers did. This folder turns it into
 * numbers. A number is a **recipe** (`recipes.ts`), one small named function over the captured events; **one read**
 * (`read.ts`) takes any recipe and any slice; **a switch** per recipe per audience (`switches.ts`) decides who may see it.
 *
 * Two kinds of type live here, and the line between them is the privacy rule:
 *
 *  - `CapturedEvent` / `TotalsRow` / `CohortRow` go IN to a recipe. They may carry the anonymous reader hash (`reader`)
 *    because a recipe needs it to count distinct people. They carry the day, never the exact time.
 *  - `ResultBody` comes OUT. Its three shapes have no field for the anonymous id, an exact time, or one person's trail, and
 *    `leavable()` (in `read.ts`) rebuilds every result from those fields only, so a recipe that tried to return more would
 *    have the extra thrown away, not passed on.
 */

/** The capture event types. The store (`ReaderEventType`) is the authority; `tests/data-business.test.ts` pins this list to it. */
export const EVENT_TYPES = ["ASK", "ZIP_VIEW", "CARD_OPEN", "CARD_VISIBLE", "ACTIVE_SCROLL", "AGENDA_VIEW", "REACTION", "BALLOT_PICK"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The residency stamp capture puts on an event: how the reader relates to the ZIP they looked at. */
export type Residency = "HOME" | "BROWSING" | "MOVING" | "UNKNOWN";

/**
 * One captured event, as a recipe sees it. INPUT ONLY: never returned, never serialised out of this folder.
 * There is deliberately no exact time: the source reduces it to the UTC day before a recipe runs.
 */
export interface CapturedEvent {
  readonly type: EventType;
  /** UTC day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The anonymous reader hash. Counting distinct people is the only thing it is for. */
  readonly reader: string;
  readonly zip: string | null;
  /** The district's own stable id (an OCD division id), or null. */
  readonly district: string | null;
  readonly residency: Residency;
  readonly cardId: string | null;
  readonly cardKind: string | null;
  readonly durationMs: number | null;
  /** The scrubbed question text, or null. */
  readonly text: string | null;
  /** A taxonomy id, or "free-form". */
  readonly topic: string;
  readonly reaction: string | null;
  readonly ballotPick: { readonly contestId: string; readonly candidateIds: readonly string[]; readonly choice: "PICKED" | "UNSURE" | "BLANK" } | null;
  /** Collected by a tester or bot: kept out of anything sold unless asked for. */
  readonly tester: boolean;
}

/** One cheap aggregate row from the store's totals: exact, with no reader in it. `"*"` means "all" in topic and type. */
export interface TotalsRow {
  readonly grain: Grain;
  /** The day, or the Monday of the week. */
  readonly period: string;
  readonly zip: string | null;
  readonly district: string | null;
  readonly topic: string;
  readonly type: string;
  readonly events: number;
  readonly users: number;
}

/** Distinct readers in a period, and how many of them had never been seen in an earlier period. Exact, computed in the database. */
export interface CohortRow {
  readonly grain: Grain;
  readonly period: string;
  readonly readers: number;
  readonly newReaders: number;
}

export type Grain = "day" | "week";
export const GRAINS: readonly Grain[] = ["day", "week"];

export interface PlaceFilter {
  readonly kind: "zip" | "district" | "county" | "state";
  /** zip: five digits. district, county: the OCD division id. state: two lowercase letters. */
  readonly id: string;
}

/** A slice: where, which topics, when, who. There is no field for a side, a sentiment or a person, on purpose. */
export interface Slice {
  /** First and last day, inclusive, `YYYY-MM-DD` (UTC). */
  readonly from: string;
  readonly to: string;
  readonly grain: Grain;
  readonly place?: PlaceFilter | null;
  readonly topics?: readonly string[] | null;
  /** Residents are readers whose stamp is HOME; outsiders are BROWSING or MOVING. Unknown is in neither. */
  readonly residency?: "resident" | "outsider" | null;
  readonly card?: string | null;
}

/** Who is asking. */
export type Audience = "admin" | "dashboard" | `customer:${string}`;
export const AUDIENCE_PATTERN = /^(?:admin|dashboard|customer:[a-z0-9][a-z0-9_-]{0,63})$/;
/** An audience in words: "Admin", "the dashboard", "customer acme". */
export const audienceWords = (audience: string): string =>
  audience === "admin" ? "Admin" : audience === "dashboard" ? "the dashboard" : audience.startsWith("customer:") ? `customer ${audience.slice("customer:".length)}` : audience;
export const isAudience = (value: unknown): value is Audience => typeof value === "string" && AUDIENCE_PATTERN.test(value);

/** What a buyer account holds: a place, topics and a time window. Never a side, a sentiment or a person. */
export interface BuyerSlice {
  readonly place?: PlaceFilter | null;
  readonly topics?: readonly string[] | null;
  readonly from?: string | null;
  readonly to?: string | null;
}

/* ---------------------------------------------------------------------------------------------------------- results */

/** A number with a name: `{ label, value }`, optionally in a period, a series and a share. Nothing about any one person. */
export interface TotalsEntry {
  /** The day or the Monday of the week; null when the number is for the whole window. */
  readonly period: string | null;
  readonly label: string;
  /** A second name for the same label (for example Support / Oppose under one name); null when there is none. */
  readonly series: string | null;
  readonly value: number;
  /** A share, 0 to 100, rounded to a tenth; null when it has no whole to be a share of. */
  readonly percent: number | null;
  /** Distinct readers behind the value, when the recipe can say; null when it cannot. */
  readonly readers: number | null;
}
export interface WordEntry {
  readonly word: string;
  /** Distinct readers who used it, so one person repeating a word cannot make it large. */
  readonly readers: number;
}
export interface VerbatimEntry {
  /** The day, never the time. */
  readonly day: string;
  readonly topic: string;
  /** A ZIP or a district id, or null. */
  readonly place: string | null;
  readonly text: string;
}

export type ResultBody =
  | { readonly shape: "totals"; readonly rows: readonly TotalsEntry[] }
  | { readonly shape: "words"; readonly rows: readonly WordEntry[] }
  | { readonly shape: "verbatim"; readonly rows: readonly VerbatimEntry[] };
export type Shape = ResultBody["shape"];

/** What the recipe is asked to run over, by where its numbers come from. */
export type RecipeSource = "totals" | "cohorts" | "events";
