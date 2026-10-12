/**
 * Search for a government's meetings beyond registered feeds (Brave and Exa),
 * priced per query. The pure half of that rung:
 *
 * - Queries come from the saved methods' templates
 *   (`lib/hunt/meetings-recipes.ts`), then the defaults below. A query with an
 *   unfilled slot is never sent.
 * - A result is a pointer, never evidence. Only a result on an official
 *   government source is followed, then opened robots-first and confirmed by
 *   content.
 * - Every request carries its provider's published price into the cost
 *   ledger; an unestablished price is null (UNMEASURED), never zero.
 */

import type { MeetingsRecipe, RecipeIdentity } from "./meetings-recipes.ts";
import { substitute } from "./meetings-recipes.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../civic-data/source-authority.ts";

export type SearchProvider = "brave" | "exa";

export interface SearchPrice {
  readonly provider: SearchProvider;
  /** The provider API host, the cost ledger's `source`. */
  readonly host: string;
  /** Published price per request, or null when it is not established. */
  readonly usdPerRequest: number | null;
  readonly source: string;
  readonly readOn: string;
  /** How the number was read from the page, in plain words. */
  readonly basis: string;
}

/** Read from each provider's own pricing page on 2026-09-23. */
export const SEARCH_PRICES: Readonly<Record<SearchProvider, SearchPrice>> = {
  brave: {
    provider: "brave",
    host: "api.search.brave.com",
    usdPerRequest: 0.005,
    source: "https://brave.com/search/api/",
    readOn: "2026-09-23",
    basis: "Search plan: \"$5 per 1,000 requests\"; the $5 monthly free credit does not change the per-request price",
  },
  exa: {
    provider: "exa",
    host: "api.exa.ai",
    usdPerRequest: 0.007,
    source: "https://exa.ai/pricing",
    readOn: "2026-09-23",
    basis:
      "/search base price $7 per 1,000 requests including up to 10 results (this client asks for 5, no contents); " +
      "the page names no separate price for type \"fast\", which this client sends, so the /search base price is applied",
  },
};

/** The query every government gets when no saved method supplies one. */
export const DEFAULT_SEARCH_TEMPLATES: readonly { readonly templateId: string; readonly template: string; readonly ownSiteOnly: boolean }[] = [
  { templateId: "own-site-meetings", template: "{bodyName} meetings agendas minutes", ownSiteOnly: true },
  { templateId: "publisher-portal", template: "{bodyName} {state} meeting agendas", ownSiteOnly: false },
];

export interface PlannedQuery {
  /** The template's id, or the saved method's id when a recipe supplied it. */
  readonly templateId: string;
  readonly recipeId: string | null;
  /** The template with its identity slots, saved as a method when the query finds a route. */
  readonly template: string;
  readonly query: string;
  /** Restrict results to the government's own domain. */
  readonly ownSiteOnly: boolean;
}

/** The queries for one government: the saved methods' templates first, then the defaults, unique, at most `limit`. */
export function plannedQueries(
  recipes: readonly MeetingsRecipe[],
  identity: RecipeIdentity,
  limit: number,
): readonly PlannedQuery[] {
  const out: PlannedQuery[] = [];
  const seen = new Set<string>();
  const add = (q: PlannedQuery): void => {
    const key = `${q.query.toLowerCase()}|${q.ownSiteOnly}`;
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(q);
  };
  for (const recipe of recipes) {
    recipe.queryTemplates.forEach((template, i) => {
      const query = substitute(template, identity);
      if (query !== null) add({ templateId: `${recipe.recipeId}#q${i}`, recipeId: recipe.recipeId, template, query, ownSiteOnly: /\bsite:/.test(template) || recipe.platform === null });
    });
  }
  for (const d of DEFAULT_SEARCH_TEMPLATES) {
    const query = substitute(d.template, identity);
    if (query !== null) add({ templateId: d.templateId, recipeId: null, template: d.template, query, ownSiteOnly: d.ownSiteOnly });
  }
  return out.map((q) => ({ ...q, query: q.query.replace(/\s*\bsite:\S+/g, "").trim() }));
}

export type HitStanding = "OWN_SITE" | "PUBLISHER";

/**
 * Whether a search result is worth opening for this government: on its own
 * domain or another official publisher. Source authority is separate from
 * the executor's subsequent check that the content names the correct body.
 */
export function hitStanding(hitUrl: string, domain: string, linkingPage?: OfficialLinkingPage | null): HitStanding | null {
  let host: string;
  try {
    const u = new URL(hitUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  const own = domain.toLowerCase();
  if (!isOfficialSource(hitUrl, linkingPage)) return null;
  return host === own || host.endsWith(`.${own}`) ? "OWN_SITE" : "PUBLISHER";
}

/** The price record a request is charged at: the published price when established, otherwise null (UNMEASURED). */
export function requestPrice(provider: SearchProvider, delivered: boolean): { readonly usd: number | null; readonly price: SearchPrice } {
  const price = SEARCH_PRICES[provider];
  /* A request that errored in transport may or may not be billed; that is not established, so it is UNMEASURED. */
  return { usd: delivered ? price.usdPerRequest : null, price };
}
