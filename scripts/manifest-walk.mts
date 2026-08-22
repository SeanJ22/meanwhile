/**
 * **WALK THE BRANCH MANIFEST FOR ONE PERSON** (built 2026-08-21, NH Hunt 6
 * item 3 — RULING 61, RULING 63).
 *
 * ```
 * pnpm manifest:walk --name "Kathleen Donnelly" --town Concord --state NH \
 *   [--office "County Treasurer"] [--site example.com] [--json .nh6tmp/x.json]
 * ```
 *
 * RULING 61 raised exhaustion from a count to a NAMED LIST, and a named list of
 * thirty-six routes per person is not a thing anyone walks by hand thirteen
 * times without dropping some. The absence of a script is never a wall — so
 * this is the script.
 *
 * ## What it does and, more importantly, what it does NOT do
 *
 * It walks the routes that can be walked **mechanically** — a domain guess, an
 * archive query, a public register lookup, a donation-platform slug — and
 * writes each one out as a `ManifestBranch` with its route id, its date, what
 * came back, and whether it found anything.
 *
 * **It never decides that a field is absent.** It produces evidence; the
 * verdict is `judgeManifestWalk`'s, and the routes this cannot automate —
 * reading a newspaper interview, opening a Facebook page in a live browser,
 * telephoning a town clerk — come back `NOT_AUTOMATABLE` and are reported as
 * **still owed**, by name. A tool that quietly counted its own coverage as the
 * manifest's coverage would be the exhaustion bar lowering itself, which is the
 * one thing RULING 61 exists to prevent.
 *
 * ## Every route reports its count
 *
 * An operation that can return nothing is asked what it returned. Each route
 * prints what it fetched and what it found, and a zero is an outcome with a
 * reason attached rather than a clean exit.
 */
import { writeFileSync } from "node:fs";

import { today as stampToday } from "./doc-dates.mjs";
import {
  MANIFEST_ROUTES,
  MANIFEST_VERSION,
  MANIFEST_FIELDS,
  judgeManifestWalk,
  requiredRouteIds,
  type ManifestBranch,
  type ManifestField,
} from "../lib/hunt/branch-manifest.ts";

const UA = "we-the-people civic data (contact: seanj22@gmail.com)";

interface Person {
  name: string;
  town?: string;
  state: string;
  office?: string;
  site?: string;
}

interface RouteResult {
  route: string;
  status: "HIT" | "EMPTY" | "REFUSED" | "NOT_AUTOMATABLE";
  result: string;
  fetched: number;
  found: Record<string, string>;
  urls: string[];
}

async function get(
  url: string,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; status: number; body: string; url: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: ctl.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, url: res.url };
  } catch (err) {
    return { ok: false, status: 0, body: String(err), url };
  } finally {
    clearTimeout(t);
  }
}

/* Contacts hiding in the markup — the Kearsarge lesson: read the href, not the cell. */
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;
const NOISE =
  /sentry|wixpress|@example|@sentry|noreply|no-reply|revize|godaddy|wsimg|squarespace|\.png$|\.jpg$|\.gif$|@2x|nationbuilder\.com|@sentry\.io/i;

function harvest(body: string): { emails: string[]; phones: string[] } {
  const emails = [...new Set(body.match(EMAIL) ?? [])].filter((e) => !NOISE.test(e));
  const phones = [...new Set(body.match(PHONE) ?? [])];
  return { emails, phones };
}

function slugs(person: Person): string[] {
  const parts = person.name
    .toLowerCase()
    .replace(/["'.]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 1);
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  const officeWord =
    person.office
      ?.toLowerCase()
      .replace(/[^a-z ]/g, "")
      .split(/\s+/)
      .filter((w) => !["county", "of", "the", "for"].includes(w))
      .join("") ?? "";
  const out = new Set<string>();
  for (const base of [
    `${first}${last}`,
    `${first}for${officeWord}`,
    `${last}for${officeWord}`,
    `vote${last}`,
    `vote${first}${last}`,
    `${last}for${person.state.toLowerCase()}`,
    `${first}${last}for${officeWord}`,
    `elect${last}`,
  ]) {
    if (base.length > 4 && !base.endsWith("for")) out.add(base);
  }
  return [...out];
}

/* ───────────────────────────── the routes ───────────────────────────────── */

/**
 * A domain that answers and carries the surname is NOT the candidate's site.
 *
 * `kathleendonnelly.com` answered 200 with the surname all over it on the first
 * run of this script. It belongs to a novelist who writes K-9 mysteries and has
 * no connection to Merrimack County. A name match alone is a FALSE POSITIVE
 * machine, and shipping one would put a stranger's website on a named person's
 * card — the same class of error as serving one campaign's books for three
 * politicians.
 *
 * So a hit is CONFIRMED only when the body also carries something that ties it
 * to this candidacy — the town, the state, the office, or the vocabulary of a
 * campaign. Everything else is reported as NEEDS A PERSON and never as a find.
 */
async function routeDomainSearch(person: Person): Promise<RouteResult> {
  const tried: string[] = [];
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  let fetched = 0;
  const surname = person.name.split(/\s+/).pop()!.toLowerCase();
  const corroborants = [
    person.town?.toLowerCase(),
    person.office?.toLowerCase(),
    "new hampshire",
    "campaign",
    "vote for",
    "elect",
    "ballot",
  ].filter((c): c is string => typeof c === "string" && c.length > 2);

  const candidates = slugs(person).flatMap((slug) => [`https://${slug}.com/`, `https://${slug}.org/`]);
  tried.push(...candidates);
  const probes = await Promise.all(candidates.map((url) => get(url, 12_000)));
  for (const res of probes) {
    fetched += 1;
    if (res.status < 200 || res.status >= 400 || res.body.length <= 500) continue;
    const body = res.body.toLowerCase();
    // A parked domain answers 200 with nothing of the person in it.
    if (!body.includes(surname)) continue;
    if (corroborants.some((c) => body.includes(c))) confirmed.push(res.url);
    else unconfirmed.push(res.url);
  }
  const status = confirmed.length > 0 ? "HIT" : unconfirmed.length > 0 ? "NOT_AUTOMATABLE" : "EMPTY";
  return {
    route: "domain-search",
    status,
    result:
      confirmed.length > 0
        ? `${confirmed.length} of ${fetched} guessed domains answered, name-matched AND corroborated by town/office/state`
        : unconfirmed.length > 0
          ? `${unconfirmed.length} of ${fetched} answered on the surname alone with NOTHING tying them to this candidacy — a name match is not a person; open them`
          : `${fetched} domain guesses tried, none answered with the surname in the body`,
    fetched,
    found: confirmed.length > 0 ? { campaignSite: confirmed[0]! } : {},
    urls: confirmed.length > 0 ? confirmed : unconfirmed.length > 0 ? unconfirmed : tried.slice(0, 4),
  };
}

async function routeDonationPlatform(person: Person): Promise<RouteResult> {
  const hits: string[] = [];
  let fetched = 0;
  const urls = slugs(person).flatMap((slug) => [
    `https://secure.actblue.com/donate/${slug}`,
    `https://secure.winred.com/${slug}/donate`,
  ]);
  const probes = await Promise.all(urls.map((u) => get(u, 12_000)));
  for (const res of probes) {
    fetched += 1;
    if (res.status === 200 && !/not found|no longer|page you/i.test(res.body.slice(0, 4000))) {
      hits.push(res.url);
    }
  }
  return {
    route: "donation-platform",
    status: hits.length > 0 ? "HIT" : "EMPTY",
    result:
      hits.length > 0
        ? `${hits.length} donation page(s) answered`
        : `${fetched} donation-platform slugs tried, none answered`,
    fetched,
    found: hits.length > 0 ? { campaignSite: hits[0]! } : {},
    urls: hits,
  };
}

async function routeWebArchive(person: Person): Promise<RouteResult> {
  const targets = person.site
    ? [person.site]
    : slugs(person).flatMap((s) => [`${s}.com`, `${s}.org`]);
  const hits: string[] = [];
  let fetched = 0;
  const apis = targets.map(
    (host) =>
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}&output=json&limit=3&filter=statuscode:200`,
  );
  const probes = await Promise.all(apis.map((a) => get(a, 25_000)));
  for (const res of probes) {
    fetched += 1;
    if (res.status !== 200) continue;
    try {
      const rows = JSON.parse(res.body) as string[][];
      // Row 0 is the header. A body of just the header is a real zero.
      for (const row of rows.slice(1)) {
        hits.push(`https://web.archive.org/web/${row[1]}/${row[2]}`);
      }
    } catch {
      /* a non-JSON body is a refusal, counted below as fetched-but-empty */
    }
  }
  return {
    route: "web-archive",
    status: hits.length > 0 ? "HIT" : "EMPTY",
    result:
      hits.length > 0
        ? `${hits.length} archived capture(s) across ${fetched} host(s) queried`
        : `${fetched} host(s) queried at the CDX API, no 200-status captures recorded`,
    fetched,
    found: {},
    urls: hits.slice(0, 5),
  };
}

async function routeCampaignSite(person: Person): Promise<RouteResult> {
  if (!person.site) {
    return {
      route: "campaign-site",
      status: "EMPTY",
      result: "no campaign domain known to walk — domain-search is the route that finds one",
      fetched: 0,
      found: {},
      urls: [],
    };
  }
  const url = person.site.startsWith("http") ? person.site : `https://${person.site}/`;
  const res = await get(url, 25_000);
  if (res.status < 200 || res.status >= 400) {
    return {
      route: "campaign-site",
      status: "REFUSED",
      result: `HTTP ${res.status} — a refusal is not an absence; escalate the rung`,
      fetched: 1,
      found: {},
      urls: [url],
    };
  }
  const { emails, phones } = harvest(res.body);
  const og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(res.body)?.[1];
  const found: Record<string, string> = { campaignSite: res.url };
  if (emails[0]) found.email = emails[0];
  if (phones[0]) found.phone = phones[0];
  if (og) found.ogImage = og;
  return {
    route: "campaign-site",
    status: "HIT",
    result: `HTTP ${res.status}, ${res.body.length} bytes; ${emails.length} email(s), ${phones.length} phone(s), og:image ${og ? "present" : "absent"}`,
    fetched: 1,
    found,
    urls: [res.url],
  };
}

async function routeBusinessRegistry(person: Person): Promise<RouteResult> {
  // New Hampshire QuickStart is a POST-driven ASP.NET form; the GET probe here
  // reports honestly that it needs the browser rung rather than pretending a
  // 200 on the search page is a search.
  if (person.state.toUpperCase() !== "NH") {
    return {
      route: "business-registry",
      status: "NOT_AUTOMATABLE",
      result: `no registry adapter for ${person.state} yet — build one when that state is worked`,
      fetched: 0,
      found: {},
      urls: [],
    };
  }
  const res = await get("https://quickstart.sos.nh.gov/online/BusinessInquire", 20_000);
  return {
    route: "business-registry",
    status: res.status === 200 ? "NOT_AUTOMATABLE" : "REFUSED",
    result:
      res.status === 200
        ? "NH QuickStart answers at rung 2 but searches by POST — rung 6 (live browser) is the route, walked by hand"
        : `HTTP ${res.status} at the search page`,
    fetched: 1,
    found: {},
    urls: ["https://quickstart.sos.nh.gov/online/BusinessInquire"],
  };
}

async function routeNonprofitFiling(person: Person): Promise<RouteResult> {
  const api = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(person.name)}`;
  const res = await get(api, 25_000);
  if (res.status !== 200) {
    return {
      route: "nonprofit-filing",
      status: "REFUSED",
      result: `HTTP ${res.status} from the ProPublica Nonprofit Explorer API`,
      fetched: 1,
      found: {},
      urls: [api],
    };
  }
  let total = 0;
  try {
    total = (JSON.parse(res.body) as { total_results?: number }).total_results ?? 0;
  } catch {
    /* handled by the zero below */
  }
  return {
    route: "nonprofit-filing",
    status: total > 0 ? "HIT" : "EMPTY",
    result: `${total} organisation(s) matched the name in IRS 990 filings`,
    fetched: 1,
    found: {},
    urls: total > 0 ? [`https://projects.propublica.org/nonprofits/search?q=${encodeURIComponent(person.name)}`] : [],
  };
}

async function routeLegislativeDirectory(person: Person): Promise<RouteResult> {
  if (person.state.toUpperCase() !== "NH") {
    return {
      route: "legislative-directory",
      status: "NOT_AUTOMATABLE",
      result: `no legislature adapter for ${person.state} yet`,
      fetched: 0,
      found: {},
      urls: [],
    };
  }
  /*
   * gc.nh.gov answers rung 2 at HTTP 200 (RULING 52's re-walk, 2026-08-21).
   * `memberlookup.aspx` is a 404 — a MOVED PATH, which is the host answering
   * us and is a different hunt from a refusal. These two are the live indexes,
   * and BOTH are walked: a county candidate may sit in either chamber.
   */
  const urls = [
    "https://gc.nh.gov/house/members/default.aspx",
    "https://gc.nh.gov/senate/members/senate_roster.aspx",
  ];
  const surname = person.name.split(/\s+/).pop()!;
  const hits: string[] = [];
  let fetched = 0;
  let refusals = 0;
  let bytes = 0;
  for (const url of urls) {
    const res = await get(url, 25_000);
    fetched += 1;
    if (res.status !== 200) {
      refusals += 1;
      continue;
    }
    bytes += res.body.length;
    if (new RegExp(`\\b${surname}\\b`, "i").test(res.body)) hits.push(url);
  }
  return {
    route: "legislative-directory",
    status: refusals === fetched ? "REFUSED" : hits.length > 0 ? "HIT" : "EMPTY",
    result:
      refusals === fetched
        ? `both chamber indexes refused (${refusals} of ${fetched}) — a refusal, not an absence`
        : hits.length > 0
          ? `the surname "${surname}" appears in ${hits.length} of ${fetched} chamber indexes (${bytes} bytes read); OPEN IT — a surname is not a person`
          : `${fetched} chamber indexes read, ${bytes} bytes, surname "${surname}" in neither`,
    fetched,
    found: {},
    urls: hits.length > 0 ? hits : urls,
  };
}

/** Every route this can walk mechanically. Everything else is honest about it. */
const AUTOMATED: Record<string, (p: Person) => Promise<RouteResult>> = {
  "domain-search": routeDomainSearch,
  "donation-platform": routeDonationPlatform,
  "web-archive": routeWebArchive,
  "campaign-site": routeCampaignSite,
  "business-registry": routeBusinessRegistry,
  "nonprofit-filing": routeNonprofitFiling,
  "legislative-directory": routeLegislativeDirectory,
};

/* ─────────────────────────────── the run ────────────────────────────────── */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const person: Person = {
  name: arg("--name") ?? "",
  town: arg("--town"),
  state: arg("--state") ?? "NH",
  office: arg("--office"),
  site: arg("--site"),
};

if (!person.name) {
  console.error(
    'usage: pnpm manifest:walk --name "First Last" [--town T] [--state NH] [--office O] [--site domain] [--json out.json]',
  );
  process.exit(2);
}

/*
 * **THE DATE COMES FROM THE STAMP CLOCK, NEVER FROM A UTC READ.**
 *
 * `new Date().toISOString()` is UTC, and a UTC read after 5pm America/Phoenix
 * is a day ahead — the same fabrication as a plausible date, wearing a smaller
 * hat. `today()` in `scripts/doc-dates.mjs` is the Phoenix clock that
 * `corepack pnpm stamp` prints, and `tests/doc-dates.test.ts` refuses any
 * script that reaches around it.
 */
const today = arg("--on") ?? stampToday();

console.log(`\nMANIFEST WALK — ${person.name}${person.office ? ` (${person.office})` : ""}`);
console.log(`  manifest ${MANIFEST_VERSION} · ${MANIFEST_ROUTES.length} routes named · walked ${today}\n`);

const results: RouteResult[] = [];
for (const [route, fn] of Object.entries(AUTOMATED)) {
  const r = await fn(person);
  results.push(r);
  console.log(`  ${r.status.padEnd(15)} ${route.padEnd(24)} ${r.result}`);
  for (const [k, v] of Object.entries(r.found)) console.log(`      ${k}: ${v}`);
  for (const u of r.urls.slice(0, 3)) console.log(`      → ${u}`);
}

/**
 * **`found` is PER FIELD, and getting this wrong reads as an absence claim.**
 *
 * The first run of this script reported `a branch found the thing` for PHOTO
 * because the domain-search route had turned up a campaign site. It had found a
 * thing; it had not found that thing. A branch record that says `found: true`
 * on a field the route never produced is a fact about one field standing in for
 * a fact about another, which is a smaller version of exactly what
 * `judgeManifestWalk` exists to refuse.
 */
const FIELD_KEYS: Record<ManifestField, string[]> = {
  photo: ["ogImage", "photo"],
  blurb: ["blurb"],
  contact: ["email", "phone"],
  campaignSite: ["campaignSite"],
  verifiedPage: ["verifiedPage"],
};

function branchesFor(field: ManifestField): ManifestBranch[] {
  const keys = FIELD_KEYS[field];
  return results.map((r) => ({
    branch: `${r.route}: ${r.result}`,
    attemptedAt: today,
    result: r.result,
    found: keys.some((k) => k in r.found),
    route: r.route,
    through: MANIFEST_ROUTES.find((x) => x.id === r.route)?.through,
    rung: "2",
  }));
}


console.log("\n  WHAT THIS RUN COULD NOT WALK — still owed, by name:\n");
const owedByField: Record<string, string[]> = {};
for (const field of MANIFEST_FIELDS) {
  const owed = requiredRouteIds(field).filter((id) => !(id in AUTOMATED));
  owedByField[field] = owed;
  console.log(`  ${field.padEnd(14)} ${owed.length} of ${requiredRouteIds(field).length} routes need a person: ${owed.join(", ")}`);
}

console.log("\n  VERDICT PER FIELD (RULING 61 — never a conclusion, always a work list):\n");
for (const field of MANIFEST_FIELDS) {
  const v = judgeManifestWalk({
    field: field as ManifestField,
    branches: branchesFor(field as ManifestField),
    checkedAt: today,
    manifestVersion: MANIFEST_VERSION,
  });
  console.log(`  ${field.padEnd(14)} exhausted=${v.exhausted}  walked ${v.walked.length}/${v.required.length}  ${v.reason.slice(0, 96)}`);
}

const out = arg("--json");
if (out) {
  writeFileSync(
    out,
    `${JSON.stringify({ person, today, manifestVersion: MANIFEST_VERSION, results, branchesByField: Object.fromEntries(MANIFEST_FIELDS.map((f) => [f, branchesFor(f as ManifestField)])), owedByField }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\n  written ${out}`);
}
console.log("");
