/**
 * @freshness-reads-here — `observedAt` on a result is the instant this module's own read of the store returned, set after the data loaded.
 *
 * The one read: any recipe, any slice, one door.
 *
 * `readRecipe({ recipe, slice, audience }, deps)` is the only way a number leaves the data business. In order it:
 *  1. refuses an audience that is not Admin, the dashboard or one named customer;
 *  2. finds the recipe, and refuses the audience when its switch for that recipe is off (`switches.ts`);
 *  3. reads the slice (a place, topics, a day range at day or week grain, residents or outsiders, a card), and, for the dashboard
 *     and customers, confines it to the buyer slice they hold (`buyer.ts`);
 *  4. loads only what the recipe runs over (the store's totals, its new-vs-returning counts, or the events), cut to the slice;
 *  5. runs the recipe, requires the shape it promised, and rebuilds the result from that shape's fields alone (`leavable`).
 *
 * Nothing leaving carries the anonymous reader hash, an exact time or one person's trail: the inputs hold the day, not the time,
 * and `leavable` rebuilds every row field by field, so an extra field a recipe put on a row is dropped, and a field that looks
 * like a reader hash or a timestamp makes the whole read refuse rather than pass on.
 *
 * Where the data comes from is `Sources` (`live.ts` binds the real store; tests bind an in-memory one), so a recipe never knows.
 */
import type { Audience, BuyerSlice, CapturedEvent, CohortRow, PlaceFilter, ResultBody, Slice, TotalsRow } from "./types.ts";
import { audienceWords, isAudience } from "./types.ts";
import { parseSlice, sliceEvents, type ZipPlaces } from "./slice.ts";
import { recipeById, RECIPES, type Recipe } from "./recipes.ts";
import type { PlaceIndex } from "./places.ts";
import { confineToBuyer } from "./buyer.ts";
import { populationKeys, type PopulationDenominator } from "./population.ts";

/** Which rows of the store's totals to load. Families are the store's own: all (no place), by ZIP, by district. */
export interface TotalsQuery {
  readonly grain: Slice["grain"];
  readonly from: string;
  readonly to: string;
  readonly family: "all" | "zip" | "district";
  /** Only these ZIPs (family zip). */
  readonly zips?: readonly string[] | null;
  /** Only these districts (family district). */
  readonly districts?: readonly string[] | null;
  /** Only districts in this state, two lowercase letters (family district). */
  readonly districtState?: string | null;
  /** Only these topics, plus the all-topics row. */
  readonly topics?: readonly string[] | null;
}
export interface CohortQuery {
  readonly grain: Slice["grain"];
  readonly from: string;
  readonly to: string;
  readonly family: "all" | "zip" | "district";
  readonly key?: string | null;
}
export type Loaded<T> = { readonly kind: "ROWS"; readonly rows: readonly T[]; readonly truncated?: boolean } | { readonly kind: "NOT_INSTALLED"; readonly detail: string };

export interface Sources {
  readonly populations?: (keys: readonly string[]) => Promise<readonly PopulationDenominator[]>;
  readonly totals: (query: TotalsQuery) => Promise<Loaded<TotalsRow>>;
  readonly cohorts: (query: CohortQuery) => Promise<Loaded<CohortRow>>;
  /** The captured events for the days from..to, the day only, never the time. */
  readonly events: (window: { readonly from: string; readonly to: string }) => Promise<Loaded<CapturedEvent>>;
  readonly places: PlaceIndex;
}

export interface ReadDeps {
  readonly sources: Sources;
  /** Is this recipe switched on for this audience? (`switches.ts` answers it from the owner's config.) */
  readonly switchOn: (recipe: string, audience: Audience) => boolean | Promise<boolean>;
  /** The slice a dashboard account or customer holds, or null when none is stored. Admin never has one. */
  readonly heldSlice?: (audience: Audience) => BuyerSlice | null | Promise<BuyerSlice | null>;
  readonly book?: readonly Recipe[];
  readonly now?: () => Date;
}

export type Refusal =
  | "BAD_AUDIENCE" | "UNKNOWN_RECIPE" | "BAD_SLICE" | "SWITCH_OFF" | "OUTSIDE_HELD_SLICE" | "SLICE_UNSUPPORTED" | "TOO_WIDE" | "PLACE_UNKNOWN";

export type ReadResult =
  | { readonly kind: "READ"; readonly recipe: { readonly id: string; readonly label: string; readonly says: string; readonly shape: ResultBody["shape"] }; readonly slice: Slice; readonly observedAt: string; readonly body: ResultBody; readonly population?: readonly PopulationDenominator[] }
  | { readonly kind: "REFUSED"; readonly why: Refusal; readonly says: string }
  | { readonly kind: "NOT_INSTALLED"; readonly says: string };

const refused = (why: Refusal, says: string): ReadResult => ({ kind: "REFUSED", why, says });

/** The most totals rows one read will take. A wider slice is refused with words, never cut short and passed off as whole. */
export const TOTALS_ROW_LIMIT = 50_000;

/* ------------------------------------------------------------------------------------------- what may leave */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HEX64 = /\b[0-9a-f]{64}\b/i;
const CLOCK = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const wholeNumber = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const text = (value: unknown, max: number): string => {
  if (typeof value !== "string" || value.length > max) throw new RecipeShapeError("a label is not text of a reasonable length");
  if (HEX64.test(value) || CLOCK.test(value)) throw new RecipeShapeError("a result field carries something that looks like a reader id or an exact time");
  return value;
};
const orNull = <T>(value: unknown, make: (v: unknown) => T): T | null => (value === null || value === undefined ? null : make(value));

export class RecipeShapeError extends Error {}

/**
 * Rebuild a result from its shape's own fields. Anything else on a row is dropped; a wrong shape or a malformed field throws.
 * This is the privacy boundary: no reader id, exact time or per-person trail has a field here to ride out on.
 */
export function leavable(body: ResultBody, promised: ResultBody["shape"]): ResultBody {
  if (body.shape !== promised) throw new RecipeShapeError(`the recipe promised ${promised} and returned ${body.shape}`);
  const day = (v: unknown): string => { if (typeof v !== "string" || !DAY.test(v)) throw new RecipeShapeError("a day is not YYYY-MM-DD"); return v; };
  if (body.shape === "totals") {
    return { shape: "totals", rows: body.rows.map((r) => {
      const percent = orNull(r.percent, (v) => { if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) throw new RecipeShapeError("a percent is not 0 to 100"); return v; });
      if (!wholeNumber(r.value)) throw new RecipeShapeError("a value is not a whole number");
      return { period: orNull(r.period, day), label: text(r.label, 200), series: orNull(r.series, (v) => text(v, 200)), value: r.value, percent,
        readers: orNull(r.readers, (v) => { if (!wholeNumber(v)) throw new RecipeShapeError("readers is not a whole number"); return v; }) };
    }) };
  }
  if (body.shape === "words") {
    return { shape: "words", rows: body.rows.map((r) => {
      if (typeof r.word !== "string" || !/^[a-z']{3,30}$/.test(r.word) || !wholeNumber(r.readers)) throw new RecipeShapeError("a word row is malformed");
      return { word: r.word, readers: r.readers };
    }) };
  }
  return { shape: "verbatim", rows: body.rows.map((r) => {
    if (typeof r.text !== "string" || r.text.length > 4000) throw new RecipeShapeError("a message is not text");
    return { day: day(r.day), topic: text(r.topic, 64), place: orNull(r.place, (v) => text(v, 200)), text: r.text.replace(new RegExp(HEX64.source, "gi"), "[removed]").replace(new RegExp(CLOCK.source, "g"), "[removed]") };
  }) };
}

/* ------------------------------------------------------------------------------------------------ the read */

export async function readRecipe(request: { readonly recipe: string; readonly slice: unknown; readonly audience: unknown }, deps: ReadDeps): Promise<ReadResult> {
  if (!isAudience(request.audience)) return refused("BAD_AUDIENCE", "Say who is asking: Admin, the dashboard, or one named customer.");
  const audience = request.audience;
  const recipe = recipeById(request.recipe, deps.book ?? RECIPES);
  if (recipe === null) return refused("UNKNOWN_RECIPE", "There is no number by that name.");
  if (!(await deps.switchOn(recipe.id, audience))) return refused("SWITCH_OFF", `“${recipe.label}” is switched off for ${audienceWords(audience)}.`);
  const parsed = parseSlice(request.slice);
  if (!parsed.ok) return refused("BAD_SLICE", parsed.says);

  let slice = parsed.slice;
  if (audience !== "admin") {
    const held = deps.heldSlice === undefined ? null : await deps.heldSlice(audience);
    if (held !== null) {
      const confined = await confineToBuyer(slice, held, deps.sources.places);
      if (!confined.ok) return refused("OUTSIDE_HELD_SLICE", confined.says);
      slice = confined.slice;
    }
  }

  const loaded = await load(recipe, slice, deps);
  if ("stopped" in loaded) return loaded.stopped;
  const body = leavable(loaded.run(), recipe.shape);
  const keys = populationKeys(slice, body, recipe.id);
  const population = deps.sources.populations ? await deps.sources.populations(keys).catch(() => keys.map(place => ({ place, fact: null }))) : undefined;
  return { kind: "READ", recipe: { id: recipe.id, label: recipe.label, says: recipe.says, shape: recipe.shape }, slice, observedAt: (deps.now?.() ?? new Date()).toISOString(), body, ...(population ? { population } : {}) };
}

type Prepared = { readonly run: () => ResultBody } | { readonly stopped: ReadResult };
const stop = (stopped: ReadResult): Prepared => ({ stopped });

async function load(recipe: Recipe, slice: Slice, deps: ReadDeps): Promise<Prepared> {
  const { sources } = deps;
  const unsupported = (what: string) => stop(refused("SLICE_UNSUPPORTED", `“${recipe.label}” is counted from ${recipe.source === "totals" ? "the store's totals" : "new-reader counts"}, which do not record ${what}. Ask for a number that is counted from the events, or drop ${what}.`));

  if (recipe.source === "events") {
    const loaded = await sources.events({ from: slice.from, to: slice.to });
    if (loaded.kind === "NOT_INSTALLED") return stop({ kind: "NOT_INSTALLED", says: loaded.detail });
    if (loaded.truncated === true) return stop(refused("TOO_WIDE", "That slice is too wide to read event by event. Narrow the days, or ask for a number counted from the totals."));
    const needsZips = slice.place?.kind === "state" || slice.place?.kind === "county";
    const zipPlaces: ReadonlyMap<string, ZipPlaces> = needsZips ? await sources.places.of([...new Set(loaded.rows.flatMap((e) => (e.zip === null ? [] : [e.zip])))]) : new Map();
    const inSlice = sliceEvents(loaded.rows, slice, zipPlaces);
    return { run: () => recipe.run(inSlice, slice) };
  }

  if (slice.residency != null) return unsupported("whether a reader was at home");
  if (slice.card != null) return unsupported("which card was open");

  const place = slice.place ?? null;
  const by = recipe.source === "totals" ? recipe.by ?? null : null;
  const q = await placeQuery(place, by, sources.places);
  if ("refusal" in q) return stop(q.refusal === "PLACE_UNKNOWN" ? refused("PLACE_UNKNOWN", q.says) : refused("SLICE_UNSUPPORTED", q.says));

  if (recipe.source === "cohorts") {
    if (slice.topics != null) return unsupported("topics");
    if (place !== null && place.kind !== "zip" && place.kind !== "district") return unsupported("a county or a state");
    const loaded = await sources.cohorts({ grain: slice.grain, from: slice.from, to: slice.to, family: place === null ? "all" : place.kind === "zip" ? "zip" : "district", key: place === null ? null : place.id });
    if (loaded.kind === "NOT_INSTALLED") return stop({ kind: "NOT_INSTALLED", says: loaded.detail });
    return { run: () => recipe.run(loaded.rows, slice) };
  }

  const loaded = await sources.totals({ grain: slice.grain, from: slice.from, to: slice.to, ...q.query, topics: slice.topics ?? null });
  if (loaded.kind === "NOT_INSTALLED") return stop({ kind: "NOT_INSTALLED", says: loaded.detail });
  if (loaded.truncated === true || loaded.rows.length > TOTALS_ROW_LIMIT) return stop(refused("TOO_WIDE", "That slice is too wide to count in one read. Narrow the place or the days."));
  return { run: () => recipe.run(loaded.rows, slice) };
}

type PlaceQuery = { readonly query: Pick<TotalsQuery, "family" | "zips" | "districts" | "districtState"> } | { readonly refusal: "SLICE_UNSUPPORTED" | "PLACE_UNKNOWN"; readonly says: string };

/** Which family of the store's totals answers a place, for a recipe that groups by ZIP, by district or by neither. */
async function placeQuery(place: PlaceFilter | null, by: "zip" | "district" | null, places: PlaceIndex): Promise<PlaceQuery> {
  const no = (says: string): PlaceQuery => ({ refusal: "SLICE_UNSUPPORTED", says });
  if (place === null) return { query: { family: by ?? "all" } };
  switch (place.kind) {
    case "zip":
      return by === "district" ? no("A count by district cannot be cut to one ZIP.") : { query: { family: "zip", zips: [place.id] } };
    case "district":
      return by === "zip" ? no("A count by ZIP cannot be cut to one district.") : { query: { family: "district", districts: [place.id] } };
    case "state": {
      if (by === "district") return { query: { family: "district", districtState: place.id } };
      const zips = await places.zipsIn(place);
      return zips === null ? { refusal: "PLACE_UNKNOWN", says: "The ZIPs of that state could not be listed just now, so the count is unknown, not zero." } : { query: { family: "zip", zips } };
    }
    case "county": {
      if (by === "district") return no("A count by district cannot be cut to one county.");
      const zips = await places.zipsIn(place);
      return zips === null ? { refusal: "PLACE_UNKNOWN", says: "The ZIPs of that county could not be listed just now, so the count is unknown, not zero." } : { query: { family: "zip", zips } };
    }
  }
}
