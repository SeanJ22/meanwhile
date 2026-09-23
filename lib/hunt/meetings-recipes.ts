/**
 * **A METHOD THAT WORKED IS SAVED, SO THE RUNNER REPEATS IT.** (2026-09-23.)
 *
 * Owner directive, 2026-09-23: when a discovery method succeeds, save enough
 * for the runner to repeat it: what was missing, the query patterns, the
 * navigation, the publisher's traits, the extractor, what verification
 * requires, what it cost, and when it last worked. It is retrieved for another
 * body or state with the identity substituted, survives restarts and deploys,
 * and is actually consulted by the standing runner. Failed approaches are kept
 * with their limits, so the same unchanged failure is not paid for twice.
 *
 * A recipe is a record in the field manual (`cp_field_manual`, kind
 * `MEETINGS_RECIPE`), the store every worker already reads and that outlives
 * any process. The seeds below are methods this repo has already measured.
 * Their success and failure counts start at zero and grow only from the
 * runner's own walks.
 *
 * A recipe never guesses a vendor tenant. It proposes a PATH on the
 * government's own origin, and only when the homepage shows the recipe's
 * precondition. Whatever it proposes is opened robots-first and confirmed by
 * content, like every other candidate. A recipe candidate that answers a shell
 * is a failure recorded against the recipe, never a find.
 *
 * PURE: no fetch, no clock, no store.
 */

import type { FieldManualEntry } from "../control-plane/field-manual.ts";
import { fieldManualEntryId } from "../control-plane/field-manual.ts";
import type { MeetingsDiscoveryNeed } from "./meetings-discovery.ts";
import type { VerifiableVendor } from "./meetings-site-discovery.ts";

export const RECIPE_KIND = "MEETINGS_RECIPE";
export const RECIPE_SOURCE = "meetings-recipes";

/** How long a failure for one jurisdiction stands before the recipe is tried there again. */
export const RECIPE_FAILURE_HOLD_DAYS = 30;
/** Failures remembered per recipe, newest kept. The counts are exact; the list is bounded. */
const FAILED_FOR_BOUND = 200;

/** One navigation step. A path is resolved against the government's own origin, after substitution. */
export type RecipeStep = { readonly kind: "path"; readonly template: string };

export interface RecipeOutcome {
  readonly at: string;
  readonly jurisdictionId: string;
  readonly url: string;
  /** What held when it happened, in plain words. */
  readonly conditions: string;
}

export interface RecipeFailure extends RecipeOutcome {
  /** Why the method stopped here: the rung, the verdict, the wall. */
  readonly limit: string;
}

export interface MeetingsRecipe {
  readonly formatVersion: 1;
  /** Stable, kebab-case. The field-manual entry id derives from it. */
  readonly recipeId: string;
  readonly title: string;
  /** What was missing that this method finds. */
  readonly missing: string;
  readonly recordClass: "meetings";
  /** The government class it applies to (a registry govClass); null for any. */
  readonly bodyClass: string | null;
  /** The publisher platform it reads; null for a government's own pages. */
  readonly platform: string | null;
  /** Lowercase state it was proven in, or null when portable. */
  readonly state: string | null;
  /** Homepage markup that must be present before the recipe proposes anything; null for none. */
  readonly precondition: string | null;
  /** Search query templates with identity slots, used by the search rung. */
  readonly queryTemplates: readonly string[];
  readonly navigation: readonly RecipeStep[];
  /** The content check that confirms a route (`verifyEndpointBody`'s vendor). */
  readonly extractorId: VerifiableVendor;
  /** What the content must show, in plain words. */
  readonly verification: string;
  readonly publisherTraits: readonly string[];
  /** Requests one application costs, and search queries; usd is null until search is metered. */
  readonly cost: { readonly requests: number; readonly searchQueries: number; readonly usd: number | null };
  readonly successes: number;
  readonly failures: number;
  readonly lastSuccess: RecipeOutcome | null;
  readonly lastFailure: RecipeFailure | null;
  /** The newest failures, by jurisdiction. A standing one is not paid for again. */
  readonly failedFor: readonly RecipeFailure[];
  /** Where the method was first measured. Provenance, never scheduling authority. */
  readonly provenance: string;
}

function seed(r: Omit<MeetingsRecipe, "formatVersion" | "recordClass" | "successes" | "failures" | "lastSuccess" | "lastFailure" | "failedFor">): MeetingsRecipe {
  return { formatVersion: 1, recordClass: "meetings", successes: 0, failures: 0, lastSuccess: null, lastFailure: null, failedFor: [], ...r };
}

/** Methods this repo has already measured. Counts start at zero: only the runner's walks move them. */
export const SEED_RECIPES: readonly MeetingsRecipe[] = [
  seed({
    recipeId: "wordpress-events-calendar-list-ical",
    title: "WordPress Events Calendar: the list view's iCal export",
    missing: "the government's public meetings calendar",
    bodyClass: null,
    platform: "wordpress-events-calendar",
    state: null,
    precondition: "tribe-events|/wp-content/plugins/the-events-calendar",
    queryTemplates: ["{bodyName} meetings calendar site:{domain}"],
    navigation: [{ kind: "path", template: "/events/list/?ical=1" }],
    extractorId: "ical",
    verification: "a VCALENDAR with at least one VEVENT",
    publisherTraits: [
      "the month view's ?ical=1 exports only the displayed month; the list view exports every upcoming event",
    ],
    cost: { requests: 1, searchQueries: 0, usd: null },
    provenance: "lib/sources/ical/index.ts header: /events/?ical=1 returned 4 events where /events/list/?ical=1 returned 23",
  }),
  seed({
    recipeId: "civicplus-agendacenter",
    title: "CivicPlus AgendaCenter on the government's own domain",
    missing: "the government's agendas and minutes",
    bodyClass: null,
    platform: "civicplus",
    state: null,
    precondition: "CivicPlus|/Common/Modules/|CivicAlerts\\.aspx",
    queryTemplates: ["{bodyName} agenda center site:{domain}"],
    navigation: [{ kind: "path", template: "/AgendaCenter" }],
    extractorId: "civicplus-agendacenter",
    verification: "an AgendaCenter page with at least one agenda or minutes document link",
    publisherTraits: ["CivicPlus serves AgendaCenter at the same path on every customer domain"],
    cost: { requests: 1, searchQueries: 0, usd: null },
    provenance: "lib/sources/civicplus/index.ts header: both AgendaCenter and iCalendar paths are CivicPlus-wide",
  }),
  seed({
    recipeId: "civicplus-icalendar-module",
    title: "CivicPlus calendar module's iCalendar feed",
    missing: "the government's public meetings calendar",
    bodyClass: null,
    platform: "civicplus",
    state: null,
    precondition: "CivicPlus|/Common/Modules/|CivicAlerts\\.aspx",
    queryTemplates: [],
    navigation: [{ kind: "path", template: "/common/modules/iCalendar/iCalendar.aspx?feed=calendar" }],
    extractorId: "ical",
    verification: "a VCALENDAR with at least one VEVENT",
    publisherTraits: ["the feed without catID covers every calendar category; a category filter is the body filter"],
    cost: { requests: 1, searchQueries: 0, usd: null },
    provenance: "lib/sources/civicplus/index.ts header: /common/modules/iCalendar/iCalendar.aspx?catID=<n>&feed=calendar",
  }),
];

/** The identity a recipe's templates are filled from. */
export interface RecipeIdentity {
  readonly bodyName: string;
  readonly city: string;
  readonly state: string;
  readonly domain: string;
  readonly year: string;
}

/** A need's identity, with its site's registrable host as {domain}. */
export function identityFor(need: MeetingsDiscoveryNeed, origin: string, year: number): RecipeIdentity {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const plain = need.name.replace(/\s+/g, " ").trim();
  const city = plain.replace(/^(city|town|village|township|borough|county)\s+of\s+/i, "");
  return { bodyName: plain, city, state: need.stateCode.toUpperCase(), domain: host, year: String(year) };
}

/** Fill a template's slots. Null when it names a slot the identity lacks: a half-filled query is never sent. */
export function substitute(template: string, identity: RecipeIdentity): string | null {
  let missing = false;
  const filled = template.replace(/\{([a-zA-Z]+)\}/g, (_, slot: string) => {
    const value = (identity as unknown as Record<string, string | undefined>)[slot];
    if (value === undefined || value === "") {
      missing = true;
      return "";
    }
    return value;
  });
  return missing ? null : filled;
}

/** The field-manual entry id a recipe lives at. */
export function recipeEntryId(recipeId: string): string {
  return fieldManualEntryId(RECIPE_SOURCE, recipeId);
}

function isRecipe(value: unknown): value is MeetingsRecipe {
  const r = value as Partial<MeetingsRecipe> | null;
  return (
    typeof r === "object" && r !== null && r.formatVersion === 1 && typeof r.recipeId === "string" &&
    r.recordClass === "meetings" && Array.isArray(r.navigation) && typeof r.extractorId === "string" &&
    Array.isArray(r.failedFor) && typeof r.successes === "number" && typeof r.failures === "number"
  );
}

/**
 * The recipes the runner knows: every MEETINGS_RECIPE in the field manual,
 * then any seed the manual does not hold yet. A stored recipe wins over its
 * seed, because it carries the runner's own counts.
 */
export function knownRecipes(entries: readonly FieldManualEntry[]): readonly MeetingsRecipe[] {
  const stored = new Map<string, MeetingsRecipe>();
  for (const e of entries) {
    if (e.kind === RECIPE_KIND && isRecipe(e.payload)) stored.set(e.payload.recipeId, e.payload);
  }
  for (const s of SEED_RECIPES) if (!stored.has(s.recipeId)) stored.set(s.recipeId, s);
  return [...stored.values()];
}

/**
 * The recipes that apply to one government, best first: a state-specific
 * recipe for this state before a portable one, then by successes, then by the
 * latest success. A recipe proven in another state does not apply here until it
 * is portable or proven here too.
 */
export function recipesFor(
  recipes: readonly MeetingsRecipe[],
  query: { readonly bodyClass: string; readonly state: string },
): readonly MeetingsRecipe[] {
  const state = query.state.toLowerCase();
  return recipes
    .filter((r) => (r.bodyClass === null || r.bodyClass === query.bodyClass) && (r.state === null || r.state === state))
    .sort((a, b) => {
      const specific = Number(b.state === state) - Number(a.state === state);
      if (specific !== 0) return specific;
      if (b.successes !== a.successes) return b.successes - a.successes;
      return (b.lastSuccess?.at ?? "").localeCompare(a.lastSuccess?.at ?? "");
    });
}

/** Is a failure of this recipe for this jurisdiction still standing? Then it is not tried again yet. */
export function failureStands(recipe: MeetingsRecipe, jurisdictionId: string, nowIso: string): RecipeFailure | null {
  const holdMs = RECIPE_FAILURE_HOLD_DAYS * 86_400_000;
  const standing = recipe.failedFor.find((f) => f.jurisdictionId === jurisdictionId && Date.parse(nowIso) - Date.parse(f.at) < holdMs);
  return standing ?? null;
}

export interface RecipeCandidate {
  readonly recipeId: string;
  readonly extractorId: VerifiableVendor;
  readonly url: string;
}

/**
 * The URLs the applicable recipes propose for one government, given its
 * homepage. A recipe proposes only when its precondition shows on the page and
 * no failure of it stands here.
 */
export function recipeCandidates(input: {
  readonly recipes: readonly MeetingsRecipe[];
  readonly need: MeetingsDiscoveryNeed;
  readonly origin: string;
  readonly homepageHtml: string;
  readonly nowIso: string;
}): { readonly candidates: readonly RecipeCandidate[]; readonly skipped: readonly { readonly recipeId: string; readonly why: string }[] } {
  const identity = identityFor(input.need, input.origin, new Date(input.nowIso).getUTCFullYear());
  const candidates: RecipeCandidate[] = [];
  const skipped: { recipeId: string; why: string }[] = [];
  for (const recipe of recipesFor(input.recipes, { bodyClass: input.need.govClass, state: input.need.stateCode })) {
    if (recipe.precondition !== null && !new RegExp(recipe.precondition, "i").test(input.homepageHtml)) continue;
    const standing = failureStands(recipe, input.need.jurisdictionId, input.nowIso);
    if (standing !== null) {
      skipped.push({ recipeId: recipe.recipeId, why: `failed here at ${standing.at} (${standing.limit}); not paid for again until ${RECIPE_FAILURE_HOLD_DAYS} days pass` });
      continue;
    }
    for (const step of recipe.navigation) {
      const path = substitute(step.template, identity);
      if (path === null) {
        skipped.push({ recipeId: recipe.recipeId, why: `a navigation template names a slot this government's identity lacks: ${step.template}` });
        continue;
      }
      candidates.push({ recipeId: recipe.recipeId, extractorId: recipe.extractorId, url: new URL(path, `${input.origin}/`).toString() });
    }
  }
  return { candidates, skipped };
}

/** A recipe after one application: counts, the latest outcome, and the bounded failure memory. */
export function recordRecipeOutcome(
  recipe: MeetingsRecipe,
  outcome: { readonly succeeded: true; readonly note: RecipeOutcome } | { readonly succeeded: false; readonly note: RecipeFailure },
): MeetingsRecipe {
  if (outcome.succeeded) {
    return {
      ...recipe,
      successes: recipe.successes + 1,
      lastSuccess: outcome.note,
      failedFor: recipe.failedFor.filter((f) => f.jurisdictionId !== outcome.note.jurisdictionId),
    };
  }
  return {
    ...recipe,
    failures: recipe.failures + 1,
    lastFailure: outcome.note,
    failedFor: [outcome.note, ...recipe.failedFor.filter((f) => f.jurisdictionId !== outcome.note.jurisdictionId)].slice(0, FAILED_FOR_BOUND),
  };
}

/** The field-manual entry a recipe is saved as. The newest observation replaces it whole. */
export function recipeEntry(recipe: MeetingsRecipe, observedAt: string): FieldManualEntry {
  const latest = recipe.lastSuccess ?? recipe.lastFailure;
  return {
    id: recipeEntryId(recipe.recipeId),
    role: "SHARED",
    kind: RECIPE_KIND,
    title: recipe.title,
    summary:
      `${recipe.title}: ${recipe.successes} success(es), ${recipe.failures} failure(s)` +
      (recipe.lastSuccess ? `; last worked ${recipe.lastSuccess.at.slice(0, 10)} at ${recipe.lastSuccess.url}` : "") +
      `. Confirms by: ${recipe.verification}.`,
    states: recipe.state === null ? [] : [recipe.state],
    recordClasses: ["meetings"],
    platforms: recipe.platform === null ? [] : [recipe.platform],
    outcome: recipe.successes > 0 ? "YIELDED" : latest === null ? "REFERENCE" : "FAILED",
    url: recipe.lastSuccess?.url ?? null,
    source: RECIPE_SOURCE,
    observedAt,
    tier: "B",
    payload: recipe,
  };
}
