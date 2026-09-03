/**
 * **Build a verified municipality → official-site index.**
 * (NJ Hunt 6, 2026-08-22. Branch `wikipedia-external-links-official-site`, Tier A.)
 *
 * ```
 * pnpm muni:sites --wiki data/states/nj/hunt/wikipedia-nj-morris.json --county data/states/nj/hunt/nj-morris-municipal-sites.json
 * pnpm muni:sites --wiki <file> --out data/states/nj/hunt/muni-sites-nj-morris.json
 * ```
 *
 * ## What this fixes, and it is the same shape twice
 *
 * The county-page index (`nj-hunt4-rosters.mts --index`) reads the county's
 * *Cities and Towns* page and pairs each outbound link to a municipality by
 * name. It reached **30 of 39** — and the nine it missed included **Rockaway
 * Township, the governing body of the target zip**. A route that misses the
 * subject of the hunt is not a route that needs a better score function; it
 * needs a SECOND BRANCH, and RULING 52 says exactly that: two routes that fail
 * for the same reason are one route wearing two names.
 *
 * The second branch was already walked and sitting in the repo. Every Wikipedia
 * municipality article carries an External links section, and the first entry is
 * the municipality's own website — `rockawaytownship.org` was in
 * `data/states/nj/hunt/wikipedia-nj-morris.json` the whole time, beside the school
 * district's site. RULING 85's two-click test, answered after the fact.
 *
 * ## A guessed identifier yields a LEAD, never a HIT
 *
 * Neither source is trusted on its face. Every URL is CONTROL-CHECKED: fetched,
 * and the page must self-identify as this municipality — its name in the title
 * or the masthead — **and must not self-identify as a different municipality of
 * the same name**, which is the whole Boonton / Boonton Township problem. A URL
 * that fails the control check is recorded as a `LEAD` with the reason and does
 * not enter the index.
 *
 * The type words matter and are checked separately: `boonton.org` titles itself
 * *Boonton, NJ* and `boontontownship.com` titles itself *Boonton Township*.
 * Pairing the township slug with the town's site put a whole government's
 * roster on the wrong body in the committed artifact — five municipalities deep,
 * shipped, and invisible until somebody read the file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodeEntities } from "../lib/hunt/roster-page.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const UA =
  "we-the-people/1.0 (civic data for a public-records product; contact: hello@wethepeople.vote)";
const SPACING_MS = 700;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ── Naming ─────────────────────────────────────────────────────────────── */

/** `Rockaway Township, New Jersey` → `rockaway_township`, the registry's form. */
export function slugOf(wikiTitle: string): string {
  return wikiTitle
    .replace(/,\s*New Jersey$/i, "")
    .replace(/,\s*New Hampshire$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** The municipal type word a name carries, or null where it carries none. */
export function typeWord(text: string): "township" | "borough" | "town" | "city" | null {
  const t = text.toLowerCase();
  if (/\btownship\b|\btwp\b/.test(t)) return "township";
  if (/\bborough\b|\bboro\b/.test(t)) return "borough";
  if (/\btown\b/.test(t)) return "town";
  if (/\bcity\b/.test(t)) return "city";
  return null;
}

/** The bare place name with the type word removed — `rockaway` from both forms. */
function bareName(text: string): string {
  return text
    .toLowerCase()
    .replace(/,.*$/, "")
    .replace(/\b(township|twp|borough|boro|town|city|of)\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/* ── The control check ──────────────────────────────────────────────────── */

interface Control {
  ok: boolean;
  status: number;
  title: string | null;
  reason: string;
}

async function controlCheck(url: string, municipalityTitle: string): Promise<Control> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let status = 0;
  let html = "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    status = res.status;
    html = await res.text();
  } catch (e) {
    return { ok: false, status: 0, title: null, reason: `unreachable at rung 2: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }

  if (status !== 200) return { ok: false, status, title: null, reason: `HTTP ${status}` };

  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
  // The masthead too — some sites title themselves "Home" and name the place in an h1.
  const h1 = decodeEntities(
    (/<h1[^>]*>([\s\S]{0,160}?)<\/h1>/i.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  /*
   * **The identity ladder** (NJ Hunt 6). Title and masthead alone refused four
   * live, correct municipal sites: Wharton and Chester Township both title
   * themselves "Home", and Parsippany–Troy Hills titles itself "…Township of
   * Parsippany" without the "Troy Hills" half of its own legal name. A control
   * check strict enough to reject a real government is not a strict control
   * check; it is a second wall of our own making. So the identity is read off
   * the title, the masthead, the Open Graph site name, and the leading visible
   * text — in that order, and WHICH ONE matched is recorded.
   */
  const ogSite = decodeEntities(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{2,120})["']/i.exec(html)?.[1] ?? "",
  );
  const leadText = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .slice(0, 2500);
  const identity = `${title} ${h1} ${ogSite} ${leadText}`.toLowerCase();

  const bare = bareName(municipalityTitle);
  const wantTypeEarly = typeWord(municipalityTitle);
  const firstToken = bare.split(" ")[0] ?? "";
  const fullNamed = bare.length > 0 && identity.includes(bare);
  /*
   * A partial match is accepted ONLY with the municipal type also confirmed on
   * the page — `parsippany` plus `township`. The token alone would let
   * `Chesterfield Township` answer for `Chester Township`, which is the exact
   * wrong-government failure this check exists to prevent.
   */
  const partialNamed =
    !fullNamed &&
    firstToken.length >= 5 &&
    identity.includes(firstToken) &&
    wantTypeEarly !== null &&
    typeWord(identity) === wantTypeEarly;

  if (!fullNamed && !partialNamed) {
    return {
      ok: false,
      status,
      title,
      reason: `the page does not name ${bare} in its title, masthead, og:site_name or leading text — title "${title}". A guessed identifier yields a LEAD, never a HIT.`,
    };
  }

  /*
   * The type word, where the municipality carries one. A township's site that
   * titles itself a borough is a DIFFERENT GOVERNMENT of the same name, and
   * pairing them is how one town's council ends up rendered as another's.
   * Where the site states no type at all the check passes — plenty of correct
   * sites simply say "Rockaway, NJ" — and the pair is marked `typeUnstated` so
   * the ambiguity is visible rather than assumed away.
   */
  /*
   * The TYPE is read only off the page's own self-description — title, masthead,
   * Open Graph name. Reading it out of the leading body text made Wharton, a
   * borough, report as a township because the word appears in its news copy.
   * The name match may range wider; the type claim may not.
   */
  const selfDescription = `${title} ${h1} ${ogSite}`.toLowerCase();
  const wantType = typeWord(municipalityTitle);
  const gotType = typeWord(selfDescription);
  if (wantType !== null && gotType !== null && wantType !== gotType) {
    return {
      ok: false,
      status,
      title,
      reason: `wanted a ${wantType} and the page titles itself a ${gotType} — "${title}". A different government of the same name.`,
    };
  }

  return {
    ok: true,
    status,
    title,
    reason:
      (fullNamed ? "named in full" : "named partially, municipal type confirmed") +
      (gotType === null ? ", type unstated on the page" : `, ${gotType} confirmed`),
  };
}

/* ── Sources ────────────────────────────────────────────────────────────── */

interface Lead {
  municipality: string;
  wikiTitle: string;
  url: string;
  source: string;
  label: string | null;
}

function fromWikipedia(path: string): { leads: Lead[]; districts: Lead[]; asked: number; titles: string[] } {
  const wiki = JSON.parse(readFileSync(join(ROOT, path), "utf8")) as {
    municipalities: {
      title: string | null;
      externalLinks?: { url: string; label: string }[];
    }[];
  };
  const leads: Lead[] = [];
  const districts: Lead[] = [];
  for (const m of wiki.municipalities) {
    if (m.title === null) continue;
    const slug = slugOf(m.title);
    const bare = bareName(m.title);
    for (const link of m.externalLinks ?? []) {
      const label = link.label ?? "";
      const lower = label.toLowerCase();
      // The municipality's own site: the label names the place and says website.
      if (/\b(?:web ?site|official)\b/.test(lower) && !/school|district|librar|chamber/i.test(lower)) {
        if (bare.length === 0 || lower.includes(bare))
          leads.push({ municipality: slug, wikiTitle: m.title, url: link.url, source: "wikipedia-external-links", label });
      }
      // School districts are a body class of their own, and the same section
      // names them. RULING 57: name the twig, then hunt it.
      if (/\b(?:public schools|school district|regional (?:high )?school)\b/i.test(lower)) {
        districts.push({ municipality: slug, wikiTitle: m.title, url: link.url, source: "wikipedia-external-links", label });
      }
    }
  }
  return {
    leads,
    districts,
    asked: wiki.municipalities.length,
    titles: wiki.municipalities.map((m) => m.title).filter((t): t is string => t !== null),
  };
}

/**
 * **RULING 93 — the state's own directory of its municipalities.**
 *
 * `data/hunt/tier-directories.json`, route `nj-localgov`. This is the tier above
 * publishing about the tier below, and it out-performs both other sources: it
 * named all four municipalities the control check could not resolve from the
 * encyclopedia or the county page, and it disambiguates the five Washington
 * Townships of New Jersey BY COUNTY, which is the shape a national product hits
 * constantly and neither other source solves.
 *
 * Matched by bare name AND municipal type, never by name alone — `Chester
 * Borough` and `Chester Township` are two governments.
 */
function fromStateDirectory(path: string, wikiTitles: string[]): Lead[] {
  const raw = JSON.parse(readFileSync(join(ROOT, path), "utf8")) as {
    routes: { route: string; entities: { name: string; url: string; qualifier: string | null }[] }[];
  };
  const leads: Lead[] = [];
  for (const route of raw.routes) {
    if (!/localgov|municipal/i.test(route.route)) continue;
    for (const title of wikiTitles) {
      const wantBare = bareName(title);
      const wantType = typeWord(title);
      if (wantBare.length === 0) continue;
      /*
       * **The qualifier is not decoration.** New Jersey has FIVE Washington
       * Townships and the state's directory disambiguates them by county —
       * `Washington Township (Morris County)`. Matching on bare name and type
       * alone paired Morris County's township with BERGEN County's website: a
       * different government, in a different county, rendered as this reader's.
       *
       * So where the directory qualifies a row, the qualifier must agree with
       * what the municipality's own title says, and where several rows tie with
       * no qualifier to separate them the pairing is REFUSED. Ambiguity is not
       * a licence to pick one.
       */
      const titleLower = title.toLowerCase();
      const matches = route.entities.filter((entity) => {
        if (bareName(entity.name) !== wantBare) return false;
        const gotType = typeWord(entity.name);
        if (wantType !== null && gotType !== null && wantType !== gotType) return false;
        if (wantType === null && gotType !== null) return false;
        return true;
      });
      const qualified = matches.filter((entity) => {
        const county = entity.qualifier?.toLowerCase().replace(/\s*county.*$/, "").trim();
        return county !== undefined && county.length > 0 && titleLower.includes(county);
      });
      const chosen =
        qualified.length > 0 ? qualified : matches.length === 1 ? matches : [];
      if (matches.length > 1 && qualified.length === 0) {
        console.log(
          `  ! ${slugOf(title)}: ${matches.length} directory rows share this name and none is ` +
            `qualified to this county — REFUSED rather than guessed (${matches
              .map((e) => e.url)
              .join(", ")})`,
        );
      }
      for (const entity of chosen) {
        leads.push({
          municipality: slugOf(title),
          wikiTitle: title,
          url: entity.url,
          source: `state-directory:${route.route}`,
          label: entity.qualifier === null ? entity.name : `${entity.name} (${entity.qualifier})`,
        });
      }
    }
  }
  return leads;
}

function fromCountyIndex(path: string): Lead[] {
  const index = JSON.parse(readFileSync(join(ROOT, path), "utf8")) as {
    sites: { municipality: string; url: string }[];
  };
  return index.sites.map((s) => ({
    municipality: s.municipality,
    wikiTitle: s.municipality.replace(/_/g, " "),
    url: s.url,
    source: "county-cities-and-towns-page",
    label: null,
  }));
}

/* ── Run ────────────────────────────────────────────────────────────────── */

const wikiPath = arg("--wiki");
const countyPath = arg("--county");
const directoryPath = arg("--state-directory");
const outArg = arg("--out");

if (wikiPath === undefined) {
  console.error(
    "pnpm muni:sites --wiki data/states/nj/hunt/wikipedia-nj-morris.json [--county data/states/nj/hunt/nj-morris-municipal-sites.json] [--out <file>]",
  );
  process.exit(2);
}

const { leads: wikiLeads, districts, asked, titles } = fromWikipedia(wikiPath);
const directoryLeads =
  directoryPath === undefined ? [] : fromStateDirectory(directoryPath, titles);
const countyLeads = countyPath === undefined ? [] : fromCountyIndex(countyPath);

/**
 * **The state's own directory first** (RULING 93), then Wikipedia — which is
 * per-article and so cannot mispair across municipalities — then the county
 * page, which pairs by score and is the one that mispaired five governments.
 */
const byMunicipality = new Map<string, Lead[]>();
for (const lead of [...directoryLeads, ...wikiLeads, ...countyLeads]) {
  byMunicipality.set(lead.municipality, [...(byMunicipality.get(lead.municipality) ?? []), lead]);
}

console.log(
  `resolving official sites for ${byMunicipality.size} municipality slug(s) — ` +
    `${directoryLeads.length} state-directory lead(s), ${wikiLeads.length} wikipedia lead(s), ` +
    `${countyLeads.length} county lead(s), ${asked} article(s) read`,
);

interface Resolved {
  municipality: string;
  url: string | null;
  source: string | null;
  pageTitle: string | null;
  control: string;
  /** Every URL tried for this municipality and why it was accepted or refused. */
  tried: { url: string; source: string; status: number; ok: boolean; reason: string }[];
}

const resolved: Resolved[] = [];
const seenUrls = new Map<string, string>();

for (const [municipality, leads] of [...byMunicipality].sort()) {
  const row: Resolved = { municipality, url: null, source: null, pageTitle: null, control: "", tried: [] };
  const uniqueUrls = new Map<string, Lead>();
  for (const lead of leads) if (!uniqueUrls.has(lead.url)) uniqueUrls.set(lead.url, lead);

  for (const [url, lead] of uniqueUrls) {
    const control = await controlCheck(url, lead.wikiTitle);
    await sleep(SPACING_MS);
    row.tried.push({ url, source: lead.source, status: control.status, ok: control.ok, reason: control.reason });
    if (control.ok && row.url === null) {
      row.url = url;
      row.source = lead.source;
      row.pageTitle = control.title;
      row.control = control.reason;
    }
  }

  /*
   * Two municipalities resolving to ONE site is the mispairing this tool was
   * built over, wearing its other face. Report it; never silently keep both.
   */
  if (row.url !== null) {
    const claimed = seenUrls.get(row.url);
    if (claimed !== undefined && claimed !== municipality) {
      row.control += ` — WARNING: ${claimed} also resolved to this URL. Two governments cannot share one official site.`;
    } else {
      seenUrls.set(row.url, municipality);
    }
  }

  resolved.push(row);
  const label = municipality.padEnd(32);
  console.log(
    row.url === null
      ? `  ${label} —  no verified site from ${row.tried.length} lead(s): ${row.tried.map((t) => t.reason).join("; ").slice(0, 120)}`
      : `  ${label} ${row.url}  [${row.source}] ${row.control}`,
  );
}

const withSite = resolved.filter((r) => r.url !== null);
const outPath = join(
  ROOT,
  outArg ?? `data/hunt/muni-sites-${wikiPath.replace(/^.*wikipedia-/, "").replace(/\.json$/, "")}.json`,
);

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      route: "municipality-official-site",
      tier: "A",
      branches: [
        "state-published-local-government-directory",
        "wikipedia-external-links-official-site",
        "county-cities-and-towns-page",
      ],
      note:
        "Every URL was CONTROL-CHECKED: fetched, and the page must name this municipality " +
        "and must not title itself a different municipal type of the same name. A URL that " +
        "failed is kept with its reason rather than dropped, because the reason is the finding.",
      builtAt: AS_OF,
      totals: {
        municipalitiesAsked: byMunicipality.size,
        municipalitiesResolved: withSite.length,
        leadsTried: resolved.reduce((n, r) => n + r.tried.length, 0),
        leadsRefusedByControl: resolved.reduce((n, r) => n + r.tried.filter((t) => !t.ok).length, 0),
        schoolDistrictLeads: districts.length,
      },
      sites: withSite.map((r) => ({ municipality: r.municipality, url: r.url })),
      resolved,
      schoolDistrictLeads: districts,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `\n  resolved ${withSite.length} of ${byMunicipality.size} municipality slug(s)\n` +
    `  leads tried ${resolved.reduce((n, r) => n + r.tried.length, 0)}, refused by the control check ` +
    `${resolved.reduce((n, r) => n + r.tried.filter((t) => !t.ok).length, 0)}\n` +
    `  school-district site leads carried forward: ${districts.length}\n` +
    `written ${outPath}`,
);
