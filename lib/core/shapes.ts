/** Kinds held by the reader's existing entity table. */
export type EntityKind = "place" | "government" | "body" | "seat" | "person" | "meeting" | "agenda_item" | "bill" | "vote_event"
  | "election" | "contest" | "candidacy" | "measure" | "measure_provision" | "committee" | "statement" | "law_question" | "news_item";

/** @public Shared reader entity used by the rebuild lanes. */
export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly state: string | null;
  readonly parentId: string | null;
}

/** @public Zero preserves an association whose source did not record a boundary year. */
export interface EntityPlace { readonly entityId: string; readonly placeId: string; readonly boundaryYear: number }
/** @public Postal delivery areas, separately from Census statistical areas. */
export interface ZipPlace { readonly zip: string; readonly placeId: string; readonly share: number | null; readonly boundaryYear: number }
/** @public Census statistical ZIP areas. */
export interface ZctaPlace { readonly zcta: string; readonly placeId: string; readonly share: number | null; readonly boundaryYear: number }
/** @public Current prebuilt reader page for one place. */
export interface PlacePage { readonly placeId: string; readonly version: bigint; readonly builtAt: string; readonly body: unknown }

export type WorkKind = "read" | "check" | "load" | "hunt" | "detect" | "audit";
/** @public Shared work-list contract for the rebuild lanes. */
export interface WorkRow {
  readonly id: string;
  readonly kind: WorkKind;
  /** Postal state; national work uses US. */
  readonly state: string;
  readonly placeId: string | null;
  readonly subjectId: string | null;
  readonly url: string | null;
  readonly sources: readonly string[];
  readonly priority: number;
  readonly notBefore: string;
  readonly leaseUntil: string | null;
  readonly leaseOwner: string | null;
  readonly attempts: number;
  readonly refusal: string | null;
}
/** @public Hourly counts of each step in each state. */
export interface CountHour { readonly state: string; readonly hour: string; readonly step: string; readonly n: bigint }
