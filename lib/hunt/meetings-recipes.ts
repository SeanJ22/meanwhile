

import type { FieldManualEntry } from "../control-plane/field-manual.ts";
import { fieldManualEntryId } from "../control-plane/field-manual.ts";
import type { MeetingsDiscoveryNeed } from "./meetings-discovery.ts";
import { anchorLinks, OFFICIAL_PAGE_EVENTS_VERSION, type VerifiableVendor } from "./meetings-site-discovery.ts";

export const RECIPE_KIND = "MEETINGS_RECIPE";
export const RECIPE_SOURCE = "meetings-recipes";

/** How long a failure for one jurisdiction stands before the recipe is tried there again. */

export const RECIPE_FAILURE_FIRST_HOLD_DAYS = 3;
export const RECIPE_FAILURE_HOLD_DAYS = 30;
/** Failures remembered per recipe, newest kept. The counts are exact; the list is bounded. */
const FAILED_FOR_BOUND = 200;

export type RecipeStep =
  | { readonly kind: "path"; readonly template: string }
  | { readonly kind: "link"; readonly anchorPattern: string; readonly max: number };

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
  /** Consecutive failures of this method on this government, this one included. Absent on failures recorded before the count existed, which read as 1. */
  readonly streak?: number;
}

/** The days a failure holds its method off its government: 3 after the first, doubling with each consecutive failure, at most 30. */
export function recipeFailureHoldDays(failure: Pick<RecipeFailure, "streak">): number {
  const streak = Math.max(1, Math.floor(failure.streak ?? 1));
  return Math.min(RECIPE_FAILURE_HOLD_DAYS, RECIPE_FAILURE_FIRST_HOLD_DAYS * 2 ** (streak - 1));
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

  seed({
    recipeId: "official-page-events-linked-committee-page",
    title: "The body's own page that dates its committee meetings and public sessions",
    missing: "dated public meetings a body announces on its own site, outside any agenda vendor",
    bodyClass: null,
    platform: null,
    state: null,
    precondition: null,
    /* Navigation only: a free link step. No query template, so the paid search rung's order is unchanged. */
    queryTemplates: [],
    navigation: [
      {
        kind: "link",
        anchorPattern: "\\b(committee|commission|council|board of education|governing board|community engagement|public meetings?)\\b",
        max: 3,
      },
    ],
    extractorId: "official-page-events",
    verification:
      `at least one dated event verified by ${OFFICIAL_PAGE_EVENTS_VERSION} for this body: on its official host, ` +
      "named for the body in its title (its name, the name without class words, or its initials), dated in its state's zone",
    publisherTraits: [
      "a district or city CMS page, not an agenda vendor",
      "events appear as JSON-LD, microdata, .ics links, event cards or dated headings",
      "the homepage links the page by a committee or engagement name, not by the word 'meetings'",
    ],
    cost: { requests: 3, searchQueries: 0, usd: null },
    provenance:
      "the TUSD repair, #384: lib/registry/source-wiring.ts `tusd1-reconfiguration`; www.tusd1.org links /Reconfiguration " +
      "as \"Reconfiguration Committee\" (tests/fixtures/official-page-events/tusd-home.html, recorded 2026-09-23)",
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

export function knownRecipes(entries: readonly FieldManualEntry[]): readonly MeetingsRecipe[] {
  const stored = new Map<string, MeetingsRecipe>();
  for (const e of entries) {
    if (e.kind === RECIPE_KIND && isRecipe(e.payload)) stored.set(e.payload.recipeId, e.payload);
  }
  for (const s of SEED_RECIPES) {
    const saved = stored.get(s.recipeId);
    stored.set(
      s.recipeId,
      saved === undefined
        ? s
        : { ...s, successes: saved.successes, failures: saved.failures, lastSuccess: saved.lastSuccess, lastFailure: saved.lastFailure, failedFor: saved.failedFor },
    );
  }
  return [...stored.values()];
}

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
  const standing = recipe.failedFor.find(
    (f) => f.jurisdictionId === jurisdictionId && Date.parse(nowIso) - Date.parse(f.at) < recipeFailureHoldDays(f) * 86_400_000,
  );
  return standing ?? null;
}

export const LINK_STEP_MAX_WORDS = 6;
const LINK_STEP_STORY_PATH = /\/(news|news-center|newsroom|press|press-releases?|blogs?|stories|articles?|posts?)(\/|$)/i;

export function isNavigationLink(link: { readonly url: string; readonly text: string }): boolean {
  const words = link.text.split(/\s+/).filter((w) => w !== "").length;
  /* An https link the page carries, resolved against it (`anchorLinks`): its path is matched, never opened. */
  const target = new URL(link.url);
  return words > 0 && words <= LINK_STEP_MAX_WORDS && !LINK_STEP_STORY_PATH.test(target.pathname);
}

export interface RecipeCandidate {
  readonly recipeId: string;
  readonly extractorId: VerifiableVendor;
  readonly url: string;
  /** For a `link` step, the words the homepage used for the link; null for a `path` step. */
  readonly label: string | null;
}

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
      skipped.push({ recipeId: recipe.recipeId, why: `failed here at ${standing.at} (${standing.limit}); not paid for again until ${recipeFailureHoldDays(standing)} days pass` });
      continue;
    }
    for (const step of recipe.navigation) {
      if (step.kind === "link") {
        const pattern = new RegExp(step.anchorPattern, "i");
        const ownHost = new URL(input.origin).host.toLowerCase();
        const followed = new Set<string>();
        for (const link of anchorLinks(input.homepageHtml, `${input.origin}/`)) {
          if (followed.size >= step.max) break;
          if (new URL(link.url).host.toLowerCase() !== ownHost || !pattern.test(link.text) || followed.has(link.url)) continue;
          if (!isNavigationLink(link)) continue;
          followed.add(link.url);
          candidates.push({ recipeId: recipe.recipeId, extractorId: recipe.extractorId, url: link.url, label: link.text });
        }
        continue;
      }
      const path = substitute(step.template, identity);
      if (path === null) {
        skipped.push({ recipeId: recipe.recipeId, why: `a navigation template names a slot this government's identity lacks: ${step.template}` });
        continue;
      }
      candidates.push({ recipeId: recipe.recipeId, extractorId: recipe.extractorId, url: new URL(path, `${input.origin}/`).toString(), label: null });
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
  /* The streak counts this government's consecutive failures, so the hold grows only while the method keeps failing here. */
  const prior = recipe.failedFor.find((f) => f.jurisdictionId === outcome.note.jurisdictionId);
  const note: RecipeFailure = { ...outcome.note, streak: prior === undefined ? 1 : Math.max(1, Math.floor(prior.streak ?? 1)) + 1 };
  return {
    ...recipe,
    failures: recipe.failures + 1,
    lastFailure: note,
    failedFor: [note, ...recipe.failedFor.filter((f) => f.jurisdictionId !== outcome.note.jurisdictionId)].slice(0, FAILED_FOR_BOUND),
  };
}

/** The publisher platform a confirmed vendor route belongs to; null for a government's own pages. */
const VENDOR_PLATFORM: Readonly<Record<VerifiableVendor, string | null>> = {
  diligent: "diligent",
  ical: null,
  "legistar-insite": "legistar",
  "legistar-api": "legistar",
  "civicplus-agendacenter": "civicplus",
  "civicclerk-api": "civicclerk",
  iqm2: "iqm2",
  boardbook: "boardbook",
  boarddocs: "boarddocs",
  granicus: "granicus-vp",
  novusagenda: "novusagenda",
  escribe: "escribe",
  "official-page-events": null,
};

const VENDOR_VERIFICATION: Readonly<Record<VerifiableVendor, string>> = {
  diligent: "a public Diligent service list with meeting ids, names and local dates; body attribution requires its attested portal",
  ical: "a VCALENDAR with at least one VEVENT",
  "legistar-insite": "a Legistar calendar page that publishes its calendar feed",
  "legistar-api": "a Legistar events list whose rows carry EventId",
  "civicplus-agendacenter": "an AgendaCenter page with at least one agenda or minutes document link",
  "civicclerk-api": "a CivicClerk events list whose rows carry id",
  iqm2: "an IQM2 calendar with at least one meeting row",
  boardbook: "a BoardBook organization page with at least one meeting link",
  granicus: "a Granicus ViewPublisher table with dated meetings and public event or clip identities",
  escribe: "a public eScribe calendar list with meeting identities, types, local dates and document links",
  boarddocs: "a public BoardDocs committee list whose dated rows carry published meeting identities; the committee is named by the attested portal selector",
  novusagenda: "a public NovusAgenda meeting grid with published meeting ids, dates and body labels",
  "official-page-events": "a page on the body's own host with at least one dated event verified for the body",
};

export function recipeFromSearchFind(input: {
  readonly templateId: string;
  readonly template: string;
  readonly vendor: VerifiableVendor;
  readonly need: MeetingsDiscoveryNeed;
  readonly attemptId: string;
}): MeetingsRecipe {
  return {
    formatVersion: 1,
    recipeId: `search-${input.templateId}-${input.vendor}-${input.need.stateCode.toLowerCase()}-${input.need.govClass.toLowerCase()}`,
    title: `Search "${input.template}", then confirm a ${input.vendor} route`,
    missing: "the government's meetings route",
    recordClass: "meetings",
    bodyClass: input.need.govClass,
    platform: VENDOR_PLATFORM[input.vendor],
    state: input.need.stateCode.toLowerCase(),
    precondition: null,
    queryTemplates: [input.template],
    navigation: [],
    extractorId: input.vendor,
    verification: VENDOR_VERIFICATION[input.vendor],
    publisherTraits: [],
    cost: { requests: 0, searchQueries: 1, usd: null },
    successes: 0,
    failures: 0,
    lastSuccess: null,
    lastFailure: null,
    failedFor: [],
    provenance: `learned from discovery attempt ${input.attemptId}`,
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
    ...(recipe.state === null && recipe.platform === null ? { portable: true } : {}),
    outcome: recipe.successes > 0 ? "YIELDED" : latest === null ? "REFERENCE" : "FAILED",
    url: recipe.lastSuccess?.url ?? null,
    source: RECIPE_SOURCE,
    observedAt,
    tier: "B",
    payload: recipe,
  };
}
