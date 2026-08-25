/**
 * **WALK THE `body-own-page-roster` BRANCH — Tier B, RULING 84.**
 * (NJ Hunt 6, 2026-08-22. Serves item 1: wire what was collected.)
 *
 * ```
 * pnpm roster:hunt --index data/hunt/nj-morris-municipal-sites.json
 * pnpm roster:hunt --index <file> --only rockaway_township
 * pnpm roster:hunt --url https://www.rockawaytownship.org/ --label rockaway_township
 * ```
 *
 * ## The claim this is evidence for
 *
 * NJ Hunt 5 named 261 officials from Wikipedia and could confirm 818 of 898
 * rows against a primary source. The rows it could NOT confirm included every
 * member of the Rockaway Township Council — the governing body of the target
 * zip — so not one of them was eligible to render under RULING 87. They were on
 * the township's own site with a ward, a term, a direct extension and an email
 * each, which is MORE than the encyclopedia held.
 *
 * This walks that route for every municipality in an index: find the governing
 * body's page from the site's own navigation, read the roster off it, and record
 * what every attempt returned.
 *
 * ## What it does not do
 *
 * It writes no reader surface. Output is `data/hunt/roster-pages-<scope>.json`,
 * a discovery-and-confirmation record. Wiring it is a separate, reviewed step,
 * because a name reaching a reader is a claim about a real person.
 *
 * ## Rate discipline
 *
 * Serialized, spaced, identified `User-Agent` with a contact address, ceiling on
 * candidate pages per site. Public-records rule: never at a rate that degrades
 * service.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  cellText,
  decodeEntities,
  extractRoster,
  looksLikeNameCell,
  type RosterExtraction,
} from "../lib/hunt/roster-page.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const UA =
  "we-the-people/1.0 (civic data for a public-records product; contact: hello@wethepeople.vote)";
const SPACING_MS = 700;
/** Candidate pages fetched per site. A ceiling that is STATED, never silent. */
/*
 * **MEASURED, AND THE RAISE WAS REVERTED — RULING 133.**
 *
 * The sitemap branch surfaced 215 scored candidates on one municipal site and
 * 102 on another, and the run reported "6 candidate page(s) of 215". That is a
 * clip stated honestly and it is still a clip, so the ceiling was raised to 10
 * to see what it was hiding.
 *
 * **It was hiding nothing.** Three runs against the same 39 sites:
 *
 * | run | sites with a roster | members | pages fetched |
 * |---|---|---|---|
 * | anchors only, ceiling 6 | 14 | 57 | 128 |
 * | + sitemap, ceiling 6 | 17 | 82 | 169 |
 * | + sitemap, ceiling 10, scores >= 8 | 17 | 82 | 180 |
 *
 * The sitemap branch is worth three municipalities and 25 members. The ceiling
 * raise is worth ZERO and costs eleven more requests at somebody else's
 * expense, so it goes back. RULING 133 says a change is kept only if the
 * rebuilt number fell, and a change kept because it sounded right is what that
 * ruling forbids.
 *
 * What DOES stay is the score filter on sitemap candidates, which is why the
 * ceiling stopped binding: a slug matching "government" fits dozens of pages,
 * and letting those compete for the slots is how 215 candidates crowded out
 * the one page named "Township Council".
 */
const CANDIDATE_CEILING = 6;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Fetched {
  status: number;
  body: string;
  finalUrl: string;
  error: string | null;
}

/** Rung 2 — a plain identified GET, with a ceiling so one host cannot hang a run. */
async function get(url: string): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    return { status: res.status, body: await res.text(), finalUrl: res.url, error: null };
  } catch (e) {
    return { status: 0, body: "", finalUrl: url, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * **Which link on a municipal site leads to the governing body's roster.**
 *
 * Ordered by how specifically the anchor text names a BODY. `Township Council`
 * beats `Government` beats `Departments`. The mayor's page is included because
 * several New Jersey forms put the mayor on the governing body and some sites
 * publish the whole body there.
 *
 * Append-only, and the score is the reason a new state's wording can be added
 * without disturbing what already works.
 */
const LINK_SCORES: { pattern: RegExp; score: number }[] = [
  { pattern: /\b(?:township|town|borough|city|common|municipal)\s+council\b/i, score: 10 },
  { pattern: /\bboard\s+of\s+(?:aldermen|commissioners|selectmen|trustees|education)\b/i, score: 10 },
  { pattern: /\b(?:township|town)\s+committee\b/i, score: 10 },
  { pattern: /\bgoverning\s+body\b/i, score: 9 },
  { pattern: /\bcouncil\s+members?\b/i, score: 9 },
  { pattern: /\bmayor\s*(?:&|and)\s*council\b/i, score: 10 },
  { pattern: /^\s*council\s*$/i, score: 8 },
  { pattern: /\bcommittee\s+members?\b/i, score: 8 },
  { pattern: /\belected\s+officials?\b/i, score: 8 },
  { pattern: /\bmayor(?:'s)?\b/i, score: 5 },
  { pattern: /\bcommissioners?\b/i, score: 5 },
  { pattern: /\bgovernment\b/i, score: 3 },
];

interface Candidate {
  url: string;
  text: string;
  score: number;
}

/**
 * **RUNG 10 — the site's own sitemap, scored the same way as its anchors.**
 * (Added 2026-08-24, the NJ depth session.)
 *
 * The homepage-anchor branch reached 14 of 39 Morris municipalities. It depends
 * on the HOMEPAGE naming the council in link text, and a script-built menu
 * defeats it completely: Dover's anchor list read *Annual Rabies*, *Body Art*
 * and *Death Certificates*, and the branch correctly scored none of them.
 *
 * A sitemap does not care what the menu does. It is the site's own enumeration
 * of its own pages, published for exactly this purpose, and it fails for
 * entirely different reasons than the anchor branch does — which is what makes
 * the two INDEPENDENT under RULING 52 rather than one route wearing two names.
 *
 * The SLUG is scored with the SAME `LINK_SCORES` table, with separators turned
 * into spaces, so `/157/Township-Council` scores the way the words *Township
 * Council* already do. One scoring table, never two.
 *
 * A sitemap index (a sitemap of sitemaps) is followed one level, capped, since
 * a large municipal site can publish dozens.
 */
async function sitemapCandidates(
  baseUrl: string,
  fetcher: (url: string) => Promise<Fetched>,
): Promise<Candidate[]> {
  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return null;
    }
  })();
  if (!origin) return [];

  const seenMaps = new Set<string>();
  const urls = new Set<string>();

  const readMap = async (mapUrl: string, depth: number): Promise<void> => {
    if (depth > 1 || seenMaps.size >= 6 || seenMaps.has(mapUrl)) return;
    seenMaps.add(mapUrl);
    const res = await fetcher(mapUrl);
    await sleep(SPACING_MS);
    if (res.status !== 200 || res.body.length === 0) return;
    const isIndex = /<sitemapindex/i.test(res.body);
    for (const m of res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = m[1];
      if (isIndex) {
        await readMap(loc, depth + 1);
      } else if (urls.size < 5_000) {
        urls.add(loc);
      }
    }
  };

  for (const name of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
    await readMap(`${origin}${name}`, 0);
    if (urls.size > 0) break;
  }

  const out: Candidate[] = [];
  for (const u of urls) {
    let path: string;
    try {
      const parsed = new URL(u);
      if (parsed.hostname.replace(/^www\./, "") !== new URL(baseUrl).hostname.replace(/^www\./, "")) continue;
      path = decodeURIComponent(parsed.pathname);
    } catch {
      continue;
    }
    if (/\.(?:pdf|jpe?g|png|gif|docx?|xlsx?|zip)$/i.test(path)) continue;
    /* The slug, read as the words it is made of. */
    const words = path.replace(/[/_+.-]+/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
    if (!words) continue;
    let score = 0;
    for (const rule of LINK_SCORES) if (rule.pattern.test(words)) score = Math.max(score, rule.score);
    if (score === 0) continue;
    out.push({ url: u, text: `${words} (from the sitemap)`, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

function candidates(html: string, baseUrl: string): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const rawHref = m[1];
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text.length < 3 || text.length > 60) continue;
    if (/^(?:mailto:|tel:|javascript:|#)/i.test(rawHref)) continue;

    let url: string;
    try {
      url = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }
    // Stay on the body's own host. A vendor portal is a different rung.
    try {
      if (new URL(url).hostname.replace(/^www\./, "") !== new URL(baseUrl).hostname.replace(/^www\./, ""))
        continue;
    } catch {
      continue;
    }
    if (/\.(?:pdf|jpg|png|gif|docx?|xlsx?)(?:$|\?)/i.test(url)) continue;

    let score = 0;
    for (const rule of LINK_SCORES) if (rule.pattern.test(text)) score = Math.max(score, rule.score);
    if (score === 0) continue;

    const existing = out.get(url);
    if (existing === undefined || existing.score < score) out.set(url, { url, text, score });
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

/**
 * **Does this page's OWN heading name a governing body?**
 *
 * The selection control. A municipal site has dozens of pages carrying people
 * with contact details — advisory committees, wellness boards, recreation
 * commissions, department directories — and the anchor text that led here is the
 * SITE's description of the link, not the PAGE's description of itself.
 *
 * Returns the heading it read, so a wiring step can be checked by a human
 * against the claim rather than trusting a boolean.
 */
const GOVERNING_HEADING =
  /\b(?:township|town|borough|city|common|municipal)\s+council\b|\bboard\s+of\s+(?:aldermen|commissioners|selectmen|trustees)\b|\b(?:township|town)\s+committee\b|\bgoverning\s+body\b|\bmayor\s*(?:&|and)\s*council\b|\bcouncil\s+members?\b|\belected\s+officials?\b|\bmayor\b/i;

/** A heading naming one of these is a DIFFERENT body, however many people it lists. */
const NOT_THE_GOVERNING_BODY =
  /\b(?:advisory|wellness|recreation|library|historic|environmental|planning|zoning|adjustment|shade\s*tree|senior|youth|arts|cultural|beautification|economic\s+development|emergency|fire|police|sewer|utilit|school|education|health)\b/i;

function bodyIdentity(html: string): { evidence: string | null; confirmed: boolean } {
  const strip = (raw: string): string =>
    decodeEntities(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const title = strip(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1] ?? "");
  const h1 = strip(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i.exec(html)?.[1] ?? "");
  const h2 = strip(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/i.exec(html)?.[1] ?? "");
  for (const heading of [h1, title, h2]) {
    if (heading.length === 0) continue;
    if (NOT_THE_GOVERNING_BODY.test(heading)) continue;
    if (GOVERNING_HEADING.test(heading)) return { evidence: heading.slice(0, 120), confirmed: true };
  }
  const first = [h1, title, h2].find((x) => x.length > 0) ?? null;
  return { evidence: first === null ? null : first.slice(0, 120), confirmed: false };
}

interface SiteResult {
  municipality: string;
  siteUrl: string;
  /** The page the roster came off, when one did. */
  rosterUrl: string | null;
  rosterPageTitle: string | null;
  /** The heading the roster page gives ITSELF — the claim a human can check. */
  bodyEvidence: string | null;
  /** Whether that heading names a governing body. False means LEAD, not FOUND. */
  bodyConfirmed: boolean;
  /** Person-shaped names the roster page carries, for confirming other sources. */
  personNamesOnPage: string[];
  members: RosterExtraction["members"];
  strategy: string | null;
  /** Every page fetched and what it returned. The count discipline. */
  attempts: {
    url: string;
    linkText: string | null;
    status: number;
    rows: number;
    strategy: string | null;
    note: string | null;
    bodyEvidence: string | null;
    bodyConfirmed: boolean;
  }[];
  candidatesSeen: number;
  candidatesFetched: number;
  /** Named when nothing was found — never an empty roster reading as an empty body. */
  failure: string | null;
  walkedAt: string;
}

/**
 * The person-shaped names a page carries. A weaker signal than a parsed roster
 * row and used only to CONFIRM a name another source proposed — never to invent
 * one — so it is collected even when the row parser returns nothing.
 */
function personNamesIn(html: string): string[] {
  const text = cellText(/<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html);
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][a-z]{1,15}(?:\s+[A-Z]\.?)?\s+[A-Z][A-Za-z'\u2019-]{2,20})\b/g)) {
    if (looksLikeNameCell(m[1])) seen.add(m[1]);
  }
  return [...seen].sort();
}

async function walkSite(municipality: string, siteUrl: string): Promise<SiteResult> {
  const result: SiteResult = {
    municipality,
    siteUrl,
    rosterUrl: null,
    rosterPageTitle: null,
    bodyEvidence: null,
    bodyConfirmed: false,
    personNamesOnPage: [],
    members: [],
    strategy: null,
    attempts: [],
    candidatesSeen: 0,
    candidatesFetched: 0,
    failure: null,
    walkedAt: AS_OF,
  };

  const home = await get(siteUrl);
  await sleep(SPACING_MS);
  if (home.status !== 200 || home.body.length === 0) {
    result.failure =
      home.error !== null
        ? `the site refused at rung 2: ${home.error}. This is a WALL on ${siteUrl}, not a fact about the body — the next rungs are the full browser header set, a different client, and the live browser.`
        : `HTTP ${home.status} from ${siteUrl} at rung 2. A wall, not an absence.`;
    result.attempts.push({
      url: siteUrl,
      linkText: null,
      status: home.status,
      rows: 0,
      strategy: null,
      note: home.error,
      bodyEvidence: null,
      bodyConfirmed: false,
    });
    return result;
  }

  // The homepage itself sometimes carries the roster.
  const pages: { url: string; text: string | null; html: string; status: number }[] = [
    { url: home.finalUrl, text: null, html: home.body, status: home.status },
  ];

  const found = candidates(home.body, home.finalUrl);
  /*
   * **A SECOND, INDEPENDENT BRANCH TO THE SAME FACT — the site's own SITEMAP.**
   * (Added 2026-08-24, the NJ depth session. Ladder rung 10.)
   *
   * The homepage-anchor branch reached **14 of 39** Morris municipalities and
   * reported the other 25 as failed extractions, honestly. RULING 52: a branch
   * returning empty is one measurement on one route, never a verdict about the
   * fact — and these two routes fail for genuinely different reasons, which is
   * what makes them independent rather than one route wearing two names.
   *
   * The anchor branch depends on the HOMEPAGE naming the council in link text.
   * Dover's homepage does not: its governing-body link lives behind a
   * script-built menu, so the branch saw an anchor list of *Annual Rabies*,
   * *Body Art* and *Death Certificates* and correctly scored none of them.
   * A sitemap does not care what the menu does — it is the site's own
   * enumeration of its own pages, published for exactly this purpose.
   *
   * The SLUG is scored with the SAME `LINK_SCORES`, with separators turned into
   * spaces, so `/157/Township-Council` and `/mayor-and-council` score the way
   * the words *Township Council* and *Mayor and Council* already do. One
   * scoring table, not two — RULING 103's predicate applied before there is
   * anything to sweep.
   */
  /* Only the SPECIFIC patterns from the sitemap. A slug matching "government"
   * (score 3) or "mayor" (score 5) fits dozens of pages on a large municipal
   * site, and letting those compete for the ceiling is how 215 candidates crowd
   * out the one page named "Township Council". The anchor branch keeps its full
   * range, because anchor TEXT is written by a human describing a link. */
  const fromSitemap = (await sitemapCandidates(home.finalUrl, get)).filter((c) => c.score >= 8);
  const seen = new Set(found.map((c) => c.url));
  for (const c of fromSitemap) if (!seen.has(c.url)) found.push(c);
  found.sort((a, b) => b.score - a.score);
  result.candidatesSeen = found.length;

  for (const candidate of found.slice(0, CANDIDATE_CEILING)) {
    const res = await get(candidate.url);
    await sleep(SPACING_MS);
    result.candidatesFetched++;
    pages.push({ url: res.finalUrl, text: candidate.text, html: res.body, status: res.status });
  }

  let best: {
    extraction: RosterExtraction;
    url: string;
    text: string | null;
    bodyEvidence: string | null;
    bodyConfirmed: boolean;
  } | null = null;
  for (const page of pages) {
    if (page.status !== 200 || page.html.length === 0) {
      result.attempts.push({
        url: page.url,
        linkText: page.text,
        status: page.status,
        rows: 0,
        strategy: null,
        note: "not fetched at rung 2",
        bodyEvidence: null,
        bodyConfirmed: false,
      });
      continue;
    }
    const extraction = extractRoster(page.url, page.html);
    const { evidence, confirmed } = bodyIdentity(page.html);
    result.attempts.push({
      url: page.url,
      linkText: page.text,
      status: page.status,
      rows: extraction.members.length,
      strategy: extraction.strategy,
      note: extraction.failure,
      bodyEvidence: evidence,
      bodyConfirmed: confirmed,
    });
    if (extraction.members.length === 0) continue;
    /*
     * **A confirmed body beats a bigger list, always.** Anchor text alone chose
     * Chatham Township's *Mayors Wellness Advisory Committee* as its governing
     * body, because the word "Mayor" scores. Attaching an advisory committee's
     * members to a township council is a false claim about who governs a
     * reader, which is the one failure this product cannot survive — so the
     * page must name a governing body IN ITS OWN HEADING, and a page that does
     * not is kept as a LEAD rather than promoted.
     */
    const better =
      best === null ||
      (confirmed && !best.bodyConfirmed) ||
      (confirmed === best.bodyConfirmed && extraction.members.length > best.extraction.members.length);
    if (better) best = { extraction, url: page.url, text: page.text, bodyEvidence: evidence, bodyConfirmed: confirmed };
  }

  /*
   * **Names are recorded whether or not a roster parsed**, and this is the case
   * that matters. Chester Borough's Mayor & Council page publishes its mayor
   * with a phone extension behind Joomla's spam-protected mailto obfuscation:
   * the row parser gets nothing, and the body then rendered with no presiding
   * officer from a page carrying her name. Reading the names off the page turns
   * that into what it is — the body's own page naming its own officer.
   */
  {
    const named = new Set<string>();
    for (const page of pages) {
      if (page.status !== 200 || page.html.length === 0) continue;
      if (!bodyIdentity(page.html).confirmed && page.url !== home.finalUrl) continue;
      for (const n of personNamesIn(page.html)) named.add(n);
    }
    result.personNamesOnPage = [...named].sort();
  }

  if (best === null) {
    result.failure =
      `${result.candidatesFetched} candidate page(s) of ${found.length} named on ${siteUrl} ` +
      `returned no roster. A FAILED extraction, not a body without members: the rungs still ` +
      `owed are the page's own network calls, the vendor directory module, a PDF roster, and ` +
      `the live browser.`;
    return result;
  }

  result.rosterUrl = best.url;
  result.rosterPageTitle = best.text;
  result.bodyEvidence = best.bodyEvidence;
  result.bodyConfirmed = best.bodyConfirmed;
  result.members = best.extraction.members;
  result.strategy = best.extraction.strategy;
  return result;
}

/* ── Run ────────────────────────────────────────────────────────────────── */

const indexPath = arg("--index");
const singleUrl = arg("--url");
const only = arg("--only");

interface Site {
  municipality: string;
  url: string;
}
let sites: Site[];
let scope: string;

if (singleUrl !== undefined) {
  sites = [{ municipality: arg("--label") ?? "adhoc", url: singleUrl }];
  scope = "adhoc";
} else if (indexPath !== undefined) {
  const index = JSON.parse(readFileSync(join(ROOT, indexPath), "utf8")) as {
    sites: Site[];
  };
  sites = index.sites;
  scope = indexPath.replace(/^.*[\\/]/, "").replace(/\.json$/, "").replace(/-municipal-sites$/, "");
} else {
  console.error(
    "pnpm roster:hunt --index data/hunt/nj-morris-municipal-sites.json [--only <slug>]\n" +
      "pnpm roster:hunt --url <site> --label <slug>",
  );
  process.exit(2);
}

if (only !== undefined) sites = sites.filter((s) => s.municipality === only);
if (sites.length === 0) {
  console.error("no sites to walk — check --only");
  process.exit(2);
}

console.log(`walking body-own-page-roster for ${sites.length} site(s) — ${scope}`);

const results: SiteResult[] = [];
for (const [i, site] of sites.entries()) {
  const r = await walkSite(site.municipality, site.url);
  results.push(r);
  const label = `${String(i + 1).padStart(2)}/${sites.length} ${site.municipality}`.padEnd(38);
  if (r.members.length > 0) {
    const withEmail = r.members.filter((m) => m.email !== null).length;
    const withPhone = r.members.filter((m) => m.phone !== null).length;
    console.log(
      `${label} ${String(r.members.length).padStart(2)} member(s)  email ${withEmail}  phone ${withPhone}  ` +
        `${r.bodyConfirmed ? "BODY" : "lead"}  ${r.rosterUrl}  « ${r.bodyEvidence ?? "no heading"} »`,
    );
  } else {
    console.log(`${label}  0 — ${r.failure?.slice(0, 110)}`);
  }
}

/**
 * **A partial run MERGES; it never replaces.** (NJ Hunt 6.)
 *
 * `--only morris_plains` re-walked one site and wrote a one-site artifact over
 * a thirty-nine-site one. Nothing errored: the file was valid, the run reported
 * its own counts truthfully, and thirty-eight bodies had quietly stopped
 * existing. A scoped run that destroys everything outside its scope is the
 * failed-fetch-empties-a-full-surface shape, one layer further back.
 */
if (only !== undefined && existsSync(join(ROOT, "data", "hunt", `roster-pages-${scope}.json`))) {
  const prior = JSON.parse(
    readFileSync(join(ROOT, "data", "hunt", `roster-pages-${scope}.json`), "utf8"),
  ) as { sites: SiteResult[] };
  const walked = new Set(results.map((r) => r.municipality));
  const kept = prior.sites.filter((s) => !walked.has(s.municipality));
  console.log(`\n  --only: merging ${results.length} re-walked site(s) into ${kept.length} kept from the prior run`);
  results.push(...kept);
  results.sort((a, b) => a.municipality.localeCompare(b.municipality));
}

const totals = {
  sitesWalked: results.length,
  sitesWithRoster: results.filter((r) => r.members.length > 0).length,
  sitesWithConfirmedBody: results.filter((r) => r.members.length > 0 && r.bodyConfirmed).length,
  membersOnConfirmedBodyPage: results
    .filter((r) => r.bodyConfirmed)
    .reduce((n, r) => n + r.members.length, 0),
  sitesWalled: results.filter((r) => r.failure?.startsWith("the site refused") || r.failure?.startsWith("HTTP")).length,
  membersFound: results.reduce((n, r) => n + r.members.length, 0),
  membersWithEmail: results.reduce((n, r) => n + r.members.filter((m) => m.email !== null).length, 0),
  membersWithPhone: results.reduce((n, r) => n + r.members.filter((m) => m.phone !== null).length, 0),
  hrefMismatches: results.reduce(
    (n, r) => n + r.members.filter((m) => m.emailHrefMismatch !== null).length,
    0,
  ),
  pagesFetched: results.reduce((n, r) => n + r.candidatesFetched + 1, 0),
};

const out = {
  route: "body-own-page-roster",
  tier: "B",
  branch: "body-own-page-roster",
  note:
    "Read off each body's OWN page. RULING 87: the encyclopedia names, the primary " +
    "source proves — and here the primary source carries more than the encyclopedia did. " +
    "Nothing in this file has reached a reader; wiring is a separate reviewed step.",
  walkedAt: AS_OF,
  scope,
  totals,
  sites: results,
};

const outPath = join(ROOT, "data", "hunt", `roster-pages-${scope}.json`);
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");

console.log(
  `\n  sites walked ${totals.sitesWalked} · with a roster ${totals.sitesWithRoster} · ` +
    `of those, the page names a GOVERNING BODY ${totals.sitesWithConfirmedBody} · walled ${totals.sitesWalled}\n` +
    `  members ${totals.membersFound} collected, ${totals.membersOnConfirmedBodyPage} of them on a ` +
    `confirmed governing-body page — the rest are LEADS and may not render as FOUND\n` +
    `  with email ${totals.membersWithEmail} · with phone ${totals.membersWithPhone}\n` +
    `  mailto/text mismatches ${totals.hrefMismatches} (the page disagrees with itself — reported, never guessed)\n` +
    `  pages fetched ${totals.pagesFetched}, ceiling ${CANDIDATE_CEILING} candidate(s) per site\n` +
    `written ${outPath}`,
);
