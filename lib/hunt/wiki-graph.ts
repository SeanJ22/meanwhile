/**
 * **THE GOVERNMENT GRAPH CRAWLER — a Tier A route that walks, rather than a
 * list that is read.** (Built 2026-08-22, NJ Hunt 5 item 10, the author's
 * instruction mid-session.)
 *
 * ## Why this is not `wikipedia-municipality` with a bigger list
 *
 * `wikipedia-municipality` reads NAMED PAGES. Somebody decides in advance which
 * articles to open, and the hunt finds exactly what that person thought of —
 * which is the flat-manifest failure RULING 84 was adopted over, one layer up.
 * A list cannot surface the New Jersey Department of Banking and Insurance,
 * because nobody writing a municipality list thinks of it.
 *
 * **The graph can.** Rockaway Township links to Morris County, which links to
 * New Jersey, which links to *Government of New Jersey*, which enumerates every
 * executive department, each linked to its own official site. Every one of those
 * departments holds public meetings and rulemaking hearings, and a hearing on
 * mortgage rules or insurance premiums or pawnbroker licensing is exactly the
 * *there is a hearing Tuesday, go* surface this product exists for.
 *
 * So this crawls. It seeds from the municipality articles for a zip and follows
 * every link that resolves to a governmental entity touching that zip, and
 * follows again from there.
 *
 * ## Stopping, and how it is reported
 *
 * **A branch stops when it leaves government, not when a counter runs out.**
 * There is no depth cap. What there is instead is a FETCH BUDGET, and the
 * difference matters: a depth cap silently decides the graph is three deep, and
 * a budget that is hit is REPORTED with the frontier that was left unexpanded,
 * named, so the clip is a stated number rather than an implied completeness.
 * That is the operation-count rule and the two-numbers rule applied to a crawl.
 *
 * ## Classification is done by CATEGORY, never by title
 *
 * A title heuristic would decide *Morris County Park Commission* is a government
 * and *Passaic Valley Water Commission* is not, on the strength of a word.
 * Wikipedia's own category graph is a far better instrument and it is maintained
 * by people with no stake in this: an article in `Category:New Jersey state
 * agencies` IS a state agency. Titles are used only to reject cheaply BEFORE a
 * fetch — a link to a year, a person, or a list is not worth a round trip — and
 * a title-rejected link is recorded rather than discarded, so the rejection is
 * auditable and a bad heuristic is visible.
 *
 * ## What is harvested at every node
 *
 * The official site, the structure, the officials, and the meeting or hearing
 * schedule. The last of those is the one that turns an enumeration into a
 * product surface, and it is why departments and agencies are in scope even
 * though whether their APPOINTED officials render as *who governs you* is a
 * scope question reserved to the author. Their MEETINGS are not in question.
 */

import {
  type WikiFetcher,
  type WikiPage,
  parseExternalLinks,
  plain,
  section,
  urlsIn,
  fetchWikitext,
} from "./wikipedia.ts";

/* ─────────────────────────── What counts as government ───────────────────── */

/**
 * Category patterns that make an article a GOVERNMENTAL ENTITY.
 *
 * Append-only, and each one is here because a real article carried it. A
 * pattern that stops matching costs nothing to keep; deleting one is how the
 * next state's crawl silently returns a smaller graph.
 */
export const GOVERNMENTAL_CATEGORY_PATTERNS: readonly RegExp[] = [
  /\bgovernment(s|al)? of\b/i,
  /\bstate agencies\b/i,
  /\bstate government\b/i,
  /\bexecutive departments\b/i,
  /\bdepartments of\b/i,
  /\bagencies of\b/i,
  /\b(municipalities|townships|boroughs|cities|towns|villages) (in|of)\b/i,
  /\bcounties (in|of)\b/i,
  /\bcounty government\b/i,
  /\bschool districts\b/i,
  /\bcongressional districts\b/i,
  /\blegislative districts\b/i,
  /\bstate legislatures?\b/i,
  /\b(senates?|houses of representatives|general assembl(y|ies))\b/i,
  /\bcourts\b/i,
  /\bjudiciary\b/i,
  /\b(commissions|boards|authorities)\b/i,
  /\bpublic transportation\b.*\bauthorit/i,
  /\bregulatory agencies\b/i,
  /\blaw enforcement agencies\b/i,
  /\bfire departments\b/i,
  /\bpolice departments\b/i,
  /\bwater (districts|authorities)\b/i,
  /\bspecial districts\b/i,
  /\bpolitics of\b/i,
  // The state article itself. Without this the crawl stops one hop short of
  // `Government of New Jersey`, which is where every executive department is
  // enumerated — the single most valuable node in the graph, unreachable
  // because `New Jersey` carried no category with the word "government" in it.
  /\bstates of the united states\b/i,
  /\bstates and territories established\b/i,
  // Row officers and cabinet posts. `New Jersey Department of State` carries
  // exactly ONE substantive category — `Secretaries of state of New Jersey` —
  // and nothing else on it says government at all.
  /\bsecretaries of state\b/i,
  /\battorneys general\b/i,
  /\bstate treasurers\b/i,
  /\bcabinet\b/i,
];

/**
 * **The title fallback, used only when the categories do not decide.**
 *
 * Categories are the better instrument and stay primary — a title heuristic
 * decides *Morris County Park Commission* is a government and *Passaic Valley
 * Water Commission* is not, on the strength of a word. But some agency articles
 * are barely categorised at all, and refusing them because a volunteer editor
 * did not add a category is letting somebody else's filing habits decide what
 * this product covers.
 *
 * So: disqualifying categories still run FIRST and still win. This only rescues
 * an article the categories were silent about.
 */
export const GOVERNMENTAL_TITLE_PATTERNS: readonly RegExp[] = [
  /^Government of /i,
  /\bDepartment of\b/,
  /\b(Commission|Commissioners)\b/,
  /\bBoard of\b/,
  /\b(Authority|Bureau)\b/,
  /\b(Senate|General Assembly|Legislature|House of Representatives)\b/,
  /\bschool district\b/i,
  /\b(Supreme|Superior|Appellate|Municipal|Tax) Court\b/,
  /\bcongressional district\b/i,
  /\blegislative district\b/i,
  /\bCounty, [A-Z]/,
];

/**
 * Categories that DISQUALIFY, checked first. A person, a year, a building, an
 * election result — all of these are linked from government articles and none
 * of them is a governing body.
 */
export const NON_ENTITY_CATEGORY_PATTERNS: readonly RegExp[] = [
  /\b\d{4} births\b/i,
  /\b\d{4} deaths\b/i,
  /\bliving people\b/i,
  /\bpeople from\b/i,
  /\b(politicians|members of the|governors of|mayors of)\b/i,
  /\belections\b/i,
  /\bnational register of historic places\b/i,
  /\bbuildings and structures\b/i,
  /\bcompanies\b/i,
  /\bunincorporated communities\b/i,
  /\bcensus-designated places\b/i,
  /\bdisambiguation pages\b/i,
];

/**
 * Titles rejected BEFORE a fetch — cheap, and each rejection is recorded so the
 * heuristic can be audited rather than trusted.
 */
export const TITLE_REJECT_PATTERNS: readonly RegExp[] = [
  /^(File|Image|Category|Template|Help|Portal|Wikipedia|Draft|Module|Special|Talk):/i,
  /^List of /i,
  /^\d{1,4}(s|st|nd|rd|th)?$/,
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
  /\b(election|census|highway|Route \d|Interstate \d|River|Mountain|Lake|Park|Museum|Church|School|High School|University|College|Airport|Railroad|Station)\b/i,
  /\b(Act|Amendment|Constitution|Statute|Code)\b/i,
];

export type NodeKind =
  | "MUNICIPALITY"
  | "COUNTY"
  | "STATE"
  | "SCHOOL_DISTRICT"
  | "LEGISLATIVE_DISTRICT"
  | "CONGRESSIONAL_DISTRICT"
  | "LEGISLATURE"
  | "EXECUTIVE_DEPARTMENT"
  | "AGENCY_BOARD_COMMISSION"
  | "COURT"
  | "GOVERNMENT_STRUCTURE"
  | "OTHER_GOVERNMENTAL";

/** The kind, decided from categories then title. Reported, never assumed. */
export function classifyKind(title: string, categories: readonly string[]): NodeKind {
  const cat = categories.join(" | ");
  const t = title;
  if (/^Government of /i.test(t) || /\bstructure of\b/i.test(t)) return "GOVERNMENT_STRUCTURE";
  if (/\bcongressional district\b/i.test(t)) return "CONGRESSIONAL_DISTRICT";
  if (/\blegislative district\b/i.test(t)) return "LEGISLATIVE_DISTRICT";
  if (/\b(Senate|General Assembly|House of Representatives|Legislature)\b/i.test(t))
    return "LEGISLATURE";
  if (/\bDepartment of\b/i.test(t) || /executive departments/i.test(cat))
    return "EXECUTIVE_DEPARTMENT";
  if (/\b(Commission|Board|Authority|Bureau|Office of|Division of)\b/i.test(t))
    return "AGENCY_BOARD_COMMISSION";
  if (/\bCourt\b/i.test(t) || /\bcourts\b/i.test(cat)) return "COURT";
  if (/\bschool district\b/i.test(t) || /school districts/i.test(cat)) return "SCHOOL_DISTRICT";
  if (/\bCounty\b/i.test(t) && /counties (in|of)/i.test(cat)) return "COUNTY";
  if (/\b(municipalities|townships|boroughs|cities|towns|villages) (in|of)/i.test(cat))
    return "MUNICIPALITY";
  if (/\bstate (government|agencies)\b/i.test(cat)) return "AGENCY_BOARD_COMMISSION";
  if (/^(New Jersey|Arizona|New Hampshire)$/i.test(t)) return "STATE";
  return "OTHER_GOVERNMENTAL";
}

export interface Classification {
  governmental: boolean;
  /** Which category matched, so the decision is auditable. */
  matchedOn: string | null;
  /** Which disqualifying category matched, where one did. */
  rejectedOn: string | null;
  kind: NodeKind | null;
}

export function classify(title: string, categories: readonly string[]): Classification {
  for (const c of categories) {
    for (const p of NON_ENTITY_CATEGORY_PATTERNS) {
      if (p.test(c)) return { governmental: false, matchedOn: null, rejectedOn: c, kind: null };
    }
  }
  for (const c of categories) {
    for (const p of GOVERNMENTAL_CATEGORY_PATTERNS) {
      if (p.test(c)) {
        return {
          governmental: true,
          matchedOn: c,
          rejectedOn: null,
          kind: classifyKind(title, categories),
        };
      }
    }
  }
  for (const p of GOVERNMENTAL_TITLE_PATTERNS) {
    if (p.test(title)) {
      return {
        governmental: true,
        matchedOn: `title fallback: ${p.source}`,
        rejectedOn: null,
        kind: classifyKind(title, categories),
      };
    }
  }
  return { governmental: false, matchedOn: null, rejectedOn: null, kind: null };
}

/**
 * Words that mean *this is a body*, whatever else the title says.
 *
 * **This is the guard on the pre-fetch reject list, and it is here because the
 * reject list ate school districts.** `/\bSchool\b/` is a perfectly sensible way
 * to skip an article about a high school and a catastrophic way to skip
 * `Rockaway Township Public Schools`; `/\bPark\b/` skips a park and also
 * `Morris County Park Commission`. A cheap heuristic that silently removes a
 * whole class of body is worse than no heuristic.
 */
const BODY_WORDS =
  /\b(District|Districts|Commission|Board|Authority|Department|Government|Council|County|Township|Borough|Municipality|Court|Legislature|Senate|Assembly|Bureau|Agency|Division of|Office of|Precinct)\b/;

/**
 * Namespaces that are never articles, checked BEFORE the body-word guard.
 *
 * The guard is there so `/\bSchool\b/` cannot eat `Rockaway Township Public
 * Schools`. It must not also let `Category:Townships in Morris County, New
 * Jersey` through on the strength of the word *Township* — a category listing
 * is not a body, and four of them reached the graph as `MUNICIPALITY` before
 * this was split out.
 */
const NAMESPACE_REJECT =
  /^(File|Image|Category|Template|Help|Portal|Wikipedia|Draft|Module|Special|Talk|MediaWiki):/i;

/** Cheap pre-fetch rejection. `null` means the link is worth a round trip. */
export function titleReject(title: string): string | null {
  if (NAMESPACE_REJECT.test(title)) return NAMESPACE_REJECT.source;
  if (BODY_WORDS.test(title)) return null;
  for (const p of TITLE_REJECT_PATTERNS) {
    if (p.test(title)) return p.source;
  }
  return null;
}

/**
 * **How soon a link is worth expanding — RULING 90 applied to a queue.**
 *
 * A municipality article carries 150–350 outbound links, so a plain
 * breadth-first queue spends its whole budget at depth 1 and never reaches the
 * departments that `Government of New Jersey` enumerates. The first real run did
 * exactly that: 260 fetches, `maxDepthReached 1`, and 4,769 links left
 * unexpanded.
 *
 * Depth is not the fix — **capping depth is the thing this crawler exists not to
 * do.** The fix is ORDER. A title that names a department, a commission, a
 * board, an authority or a court is expanded before another municipality,
 * because those are the nodes no list would have contained and they are what the
 * crawl is for. Lower number is sooner.
 */
export function expansionPriority(title: string): number {
  if (/^Government of /i.test(title)) return 0;
  if (/\b(Department|Commission|Authority|Bureau|Agency)\b/.test(title)) return 1;
  if (/\b(Board of|Division of|Office of|Court)\b/.test(title)) return 2;
  if (/\b(Legislature|Senate|General Assembly|legislative district|congressional district)\b/i.test(title))
    return 3;
  if (/\bschool district\b/i.test(title) || /\bPublic Schools\b/.test(title)) return 4;
  if (/\bCounty\b/.test(title)) return 5;
  return 9;
}

/* ───────────────────────────────── Scope ─────────────────────────────────── */

/**
 * **Does this node touch the zip?**
 *
 * The author's instruction is *governmental entities that touch this zip*, and
 * without a scope test the crawl walks out through `United States` into every
 * government on earth. Two ways to be in scope, and both are stated rather than
 * inferred:
 *
 * - **The state matches.** A New Jersey department governs a New Jersey reader,
 *   whether or not the article mentions Morris County.
 * - **The node is federally in-scope FOR THIS ZIP** — the specific congressional
 *   district and the chambers a resident is represented in. `United States
 *   Congress` is in scope; `Government of Alaska` is not, and it is reached from
 *   the same page.
 */
export interface Scope {
  /** e.g. "New Jersey". */
  state: string;
  /** Federal titles this zip's own representation section named. */
  federalAllow: readonly string[];
}

export function inScope(title: string, categories: readonly string[], scope: Scope): boolean {
  const hay = `${title} | ${categories.join(" | ")}`;
  if (new RegExp(`\\b${scope.state}\\b`, "i").test(hay)) return true;
  return scope.federalAllow.some((f) => f.toLowerCase() === title.toLowerCase());
}

/* ────────────────────────────── Harvesting ───────────────────────────────── */

export interface HarvestedLink {
  url: string;
  label: string | null;
  /** Why this link was kept: `OFFICIAL_SITE`, `MEETINGS`, `OTHER`. */
  role: "OFFICIAL_SITE" | "MEETINGS" | "OTHER";
}

/** URL or label shapes that mean *this is where the schedule lives*. */
const MEETING_PATTERNS =
  /\b(meeting|agenda|minutes|calendar|hearing|public\s*notice|board\s*docs|boarddocs|legistar|civicclerk|granicus|\.ics)\b/i;

/** Hosts that are a body's own — the official-site test, not a hand-list. */
export function isOfficialHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return (
      h.endsWith(".gov") ||
      h.endsWith(".mil") ||
      h.endsWith(".us") ||
      h.endsWith(".k12.nj.us") ||
      /\.(nj|nh|az)\.us$/.test(h)
    );
  } catch {
    return false;
  }
}

/**
 * The infobox `website =` field. This is where a department's own site is
 * written down when the External links block is empty, which for agency
 * articles is most of the time.
 */
export function infoboxWebsite(wikitext: string): string | null {
  /**
   * **A `url=` inside a `{{cite}}` is not the body's website.**
   *
   * The first version matched the first `|url=` anywhere in the article and put
   * a `nytimes.com` story forward as the New Jersey Division of Criminal
   * Justice's official site, and an `insidernj.com` post as the Division of
   * Consumer Affairs'. Calling a newspaper article a government's own page is a
   * provenance error, not a cosmetic one — every downstream read of that field
   * would cite the wrong publisher for the wrong thing.
   *
   * Two guards. Citation templates are cut out before the search, and the
   * result must be an OFFICIAL host. A body whose article carries no official
   * URL returns `null`, which is honest; the External links pass still runs and
   * a news link still lands in `OTHER` where it belongs.
   */
  const withoutCites = wikitext.replace(/\{\{\s*cite[\s\S]*?\}\}/gi, " ");
  const re = /\|\s*(?:website|homepage|url)\s*=\s*([^\n|}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutCites)) !== null) {
    for (const url of urlsIn(m[1])) {
      if (isOfficialHost(url)) return url;
    }
  }
  return null;
}

export function harvestLinks(wikitext: string): HarvestedLink[] {
  const out: HarvestedLink[] = [];
  const seen = new Set<string>();

  const push = (url: string, label: string | null, role: HarvestedLink["role"]): void => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, label, role });
  };

  const site = infoboxWebsite(wikitext);
  if (site !== null) push(site, "infobox website", "OFFICIAL_SITE");

  for (const l of parseExternalLinks(wikitext)) {
    const hay = `${l.url} ${l.label ?? ""}`;
    if (MEETING_PATTERNS.test(hay)) push(l.url, l.label, "MEETINGS");
    else if (isOfficialHost(l.url)) push(l.url, l.label, "OFFICIAL_SITE");
    else push(l.url, l.label, "OTHER");
  }
  return out;
}

/**
 * Every wikilink target in a run of wikitext, deduplicated, with section links
 * and display text stripped. This is the graph's edge set.
 */
export function wikiLinks(wikitext: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext)) !== null) {
    const t = m[1].trim();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * The officials an article names in its infobox leader fields. Municipality and
 * agency infoboxes both use `leader_name`, `leader_title`, and agency infoboxes
 * add `chief1_name` / `chief1_position`.
 */
export function infoboxLeaders(wikitext: string): { title: string | null; name: string }[] {
  const out: { title: string | null; name: string }[] = [];
  const pairs: [RegExp, RegExp][] = [
    [/\|\s*leader_title(\d*)\s*=\s*([^\n|}]+)/gi, /\|\s*leader_name(\d*)\s*=\s*([^\n|}]+)/gi],
    [/\|\s*chief(\d*)_position\s*=\s*([^\n|}]+)/gi, /\|\s*chief(\d*)_name\s*=\s*([^\n|}]+)/gi],
  ];
  for (const [titleRe, nameRe] of pairs) {
    const titles = new Map<string, string>();
    let m: RegExpExecArray | null;
    while ((m = titleRe.exec(wikitext)) !== null) titles.set(m[1] ?? "", plain(m[2]).trim());
    while ((m = nameRe.exec(wikitext)) !== null) {
      const name = plain(m[2]).trim();
      if (name.length < 3) continue;
      out.push({ title: titles.get(m[1] ?? "") ?? null, name });
    }
  }
  return out;
}

/** The article's own section headings — the entity's structure, as published. */
export function structureOf(wikitext: string): string[] {
  return (wikitext.match(/^={2,3}[^=\n]+={2,3}\s*$/gm) ?? []).map((h) =>
    h.replace(/^=+\s*|\s*=+\s*$/g, ""),
  );
}

/* ──────────────────────────────── The node ───────────────────────────────── */

export interface GraphNode {
  title: string;
  /** The article actually served, after redirects. */
  resolvedTitle: string | null;
  /** How many hops from a seed. Recorded, never used to stop a branch. */
  depth: number;
  /** Which node linked here first. */
  discoveredFrom: string | null;
  categories: string[];
  classification: Classification;
  inScope: boolean;
  expanded: boolean;
  /** Why it was not expanded, where it was not. */
  notExpandedBecause: string | null;
  officialSites: HarvestedLink[];
  meetingLinks: HarvestedLink[];
  otherLinks: HarvestedLink[];
  structure: string[];
  leaders: { title: string | null; name: string }[];
  /** Governmental wikilinks this node points at. The graph's edges. */
  outboundGovernmental: string[];
  missReason: string | null;
  fetchedAt: string;
}

/**
 * **Fetch a page WITH its categories — off `/w/api.php`, which is disallowed.**
 * (2026-09-01.)
 *
 * This composed `…/w/api.php?action=query&redirects=1&prop=revisions|categories…`
 * and `en.wikipedia.org/robots.txt` says, under `User-agent: *`:
 *
 * ```
 *   Allow: /w/api.php?action=mobileview&
 *   Allow: /w/load.php?
 *   Disallow: /w/
 * ```
 *
 * Neither `Allow` is a content query, so this call was disallowed for as long as
 * it existed. The reasoning and the measurement are in `lib/hunt/wikipedia.ts`
 * beside `WIKI_API_DISALLOWED`; this is the second call site.
 *
 * ## What moved, and the one thing that NARROWED
 *
 * The wikitext is identical — same record, another representation (RULING 206),
 * and `fetchWikitext` follows the redirect the API's `redirects=1` used to.
 *
 * **The categories are not identical, and pretending otherwise would be the
 * defect.** `prop=categories` returned the categories a page ends up in AFTER
 * template expansion; `[[Category:…]]` in the wikitext is only what the article
 * DECLARES ITSELF. A page categorised entirely by an infobox returns fewer here.
 *
 * That is a NARROWING, it is stated rather than absorbed, and it is safe in the
 * one direction that matters for this module: categories are used to CLASSIFY a
 * discovered node, and a node whose category set comes back short is classified
 * as less certain rather than as something it is not. A wider claim would need
 * the wider source, and the wider source is disallowed.
 */
export async function fetchPageWithCategories(
  title: string,
  fetcher: WikiFetcher,
  now: string,
): Promise<WikiPage & { categories: string[] }> {
  const page = await fetchWikitext(title, fetcher, now);
  if (page.wikitext === null) return { ...page, categories: [] };

  /*
   * `[[Category:Foo]]` and `[[Category:Foo|sortkey]]`, and never a category LINK
   * (`[[:Category:Foo]]`), which is a mention rather than a membership.
   */
  const categories = [
    ...new Set(
      [...page.wikitext.matchAll(/\[\[\s*Category\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]/gi)].map(
        (m) => m[1].trim(),
      ),
    ),
  ];

  return { ...page, categories };
}

/** Build a node from a fetched page. Harvest happens here; the walk is outside. */
export function buildNode(
  page: WikiPage & { categories: string[] },
  depth: number,
  discoveredFrom: string | null,
  scope: Scope,
): GraphNode {
  const title = page.title ?? page.requested;
  const classification = classify(title, page.categories);
  const scoped = inScope(title, page.categories, scope);

  const node: GraphNode = {
    title: page.requested,
    resolvedTitle: page.title,
    depth,
    discoveredFrom,
    categories: page.categories,
    classification,
    inScope: scoped,
    expanded: false,
    notExpandedBecause: null,
    officialSites: [],
    meetingLinks: [],
    otherLinks: [],
    structure: [],
    leaders: [],
    outboundGovernmental: [],
    missReason: page.missReason,
    fetchedAt: page.fetchedAt,
  };

  if (page.wikitext === null) return node;

  const links = harvestLinks(page.wikitext);
  node.officialSites = links.filter((l) => l.role === "OFFICIAL_SITE");
  node.meetingLinks = links.filter((l) => l.role === "MEETINGS");
  node.otherLinks = links.filter((l) => l.role === "OTHER");
  node.structure = structureOf(page.wikitext);
  node.leaders = infoboxLeaders(page.wikitext);

  // Edges. Title-rejected links never become edges, and the government sections
  // are read first so a department list is not lost in a 500-link article.
  const govSections = [
    section(page.wikitext, "Government"),
    section(page.wikitext, "Executive branch"),
    section(page.wikitext, "Legislative branch"),
    section(page.wikitext, "Judicial branch"),
    section(page.wikitext, "Departments"),
    section(page.wikitext, "Agencies"),
    section(page.wikitext, "Local government"),
    section(page.wikitext, "Federal, state, and county representation"),
  ].filter((s): s is string => s !== null);

  const ordered = [...govSections.flatMap(wikiLinks), ...wikiLinks(page.wikitext)];
  const seen = new Set<string>();
  for (const t of ordered) {
    if (seen.has(t)) continue;
    seen.add(t);
    if (titleReject(t) !== null) continue;
    node.outboundGovernmental.push(t);
  }
  return node;
}
