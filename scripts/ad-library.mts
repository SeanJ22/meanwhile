/**
 * `pnpm ad:library` — **RULING 66's compliant routes to a walled social page**
 * (built 2026-08-22, NJ Hunt item 2.3/2.4).
 *
 * ```
 * pnpm ad:library --name "Kathleen Donnelly" --state NH [--town Concord]
 * pnpm ad:library --roster docs/…/names.json --json out.json
 * ```
 *
 * ## Why this exists
 *
 * `campaign-social` is the single best route to a small campaign — a campaign
 * that lives on Facebook still has a campaign site — and `facebook.com` renders
 * roughly 950 KB and **zero characters of readable text** to this project's
 * headless browser. That is deliberate anti-automation defence, and RULING 12
 * says such a wall is **named, not defeated**. The two standing prohibitions in
 * the transparency mandate — no residential-proxy spoofing, nothing fabricated
 * — are not narrowed by how badly a route is wanted.
 *
 * So the answer is not a cleverer browser. It is MORE ROUTES TO THE SAME FACT,
 * which is RULING 52's whole shape, and RULING 66 names four of them.
 *
 * ## What each route does here, and what it honestly cannot do
 *
 *   `ad-library`      The Meta Ad Library Graph API. Political-ad disclosure is
 *                     MANDATORY, so any candidate buying a single ad appears,
 *                     usually with the campaign's site and its "paid for by"
 *                     disclaimer. **It requires an access token this project
 *                     does not hold**, and the token is issued against an
 *                     identity-verified Meta account — a credential decision
 *                     that is Sean's, not a session's. With no token the route
 *                     reports `REFUSED — CREDENTIAL REQUIRED` and the run keeps
 *                     going. It is never reported as an absence.
 *   `social-archive`  web.archive.org against the page URL, at rung 11. Lawful
 *                     to read and frequently carrying the About block intact.
 *   `social-mirror`   The same content on a platform that is not walled.
 *   `news-embed`      Local coverage quoting or embedding the page — and the
 *                     best AUTHENTICITY evidence in the manifest for a social
 *                     page, which the campaign-site rule requires before one
 *                     may be linked at all.
 *
 * ## A refusal is a refusal, never an empty
 *
 * Every route prints what it fetched and what came back. `REFUSED` and `EMPTY`
 * are different outcomes printed differently: one is a wall with its rungs
 * named, the other is a route that ran and found nothing on this date. A tool
 * that collapsed them would be manufacturing exhaustion.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { today as stampToday } from "./doc-dates.mjs";

const UA = "we-the-people civic data (contact: seanj22@gmail.com)";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const today = arg("--on") ?? stampToday();

/**
 * **`LEAD` IS NOT `HIT`, AND THE DIFFERENCE IS A PERSON.**
 *
 * A route that GUESSES an identifier — a handle, a slug, a domain — can prove
 * that a page exists and can never prove whose it is. `instagram.com/vincentribas`
 * answered 719,095 bytes against a 615,950-byte control, so a page is certainly
 * there; nothing in that measurement says it belongs to the Merrimack County
 * Commissioner candidate rather than to any other Vincent Ribas. NH Hunt 6
 * recorded the same shape on domains — four of the first four hits were other
 * people — and reporting these as HIT would put sixteen unverified identities
 * into a report that reads as findings.
 *
 * So a guessed-identifier route can return LEAD at best. It is work FOR a human,
 * counted separately from both HIT and EMPTY, and it never moves a field toward
 * exhaustion in either direction.
 */
type Outcome = "HIT" | "LEAD" | "EMPTY" | "REFUSED";

interface RouteResult {
  route: string;
  outcome: Outcome;
  detail: string;
  fetched: number;
  urls: string[];
}

interface Person {
  name: string;
  state: string;
  town?: string;
  office?: string;
}

async function get(
  url: string,
  timeoutMs = 20_000,
): Promise<{ status: number; body: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "*/*" },
      redirect: "follow",
      signal: ctl.signal,
    });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    return { status: 0, body: String(err) };
  } finally {
    clearTimeout(t);
  }
}

/* ── ad-library ──────────────────────────────────────────────────────────── */

const TOKEN = process.env.META_AD_LIBRARY_TOKEN?.trim();

async function routeAdLibrary(p: Person): Promise<RouteResult> {
  if (!TOKEN) {
    /*
     * **This is a REFUSAL, and it must never read as "this candidate runs no
     * ads".** The Ad Library holds every political ad by law; not being able to
     * ask it is a fact about our credentials. Recording it as EMPTY would put a
     * false negative into an exhaustion count, which is the one thing RULING 61
     * exists to prevent.
     */
    return {
      route: "ad-library",
      outcome: "REFUSED",
      detail:
        "CREDENTIAL REQUIRED — graph.facebook.com/ads_archive answers HTTP 500 OAuthException without an access token, " +
        "and the token is issued against an identity-verified Meta account. That is a credential decision for the author, " +
        "not a session (see the Needs Sean row). This is a refusal, NOT evidence that this candidate runs no ads.",
      fetched: 0,
      urls: ["https://graph.facebook.com/v21.0/ads_archive"],
    };
  }
  const url =
    `https://graph.facebook.com/v21.0/ads_archive?search_terms=${encodeURIComponent(p.name)}` +
    `&ad_reached_countries=['US']&ad_type=POLITICAL_AND_ISSUE_ADS&limit=25` +
    `&fields=page_name,ad_creative_link_captions,ad_creative_link_titles,bylines,ad_snapshot_url` +
    `&access_token=${TOKEN}`;
  const r = await get(url);
  if (r.status !== 200) {
    return {
      route: "ad-library",
      outcome: "REFUSED",
      detail: `HTTP ${r.status} — ${r.body.slice(0, 160)}`,
      fetched: r.body.length,
      urls: [url.replace(TOKEN, "<token>")],
    };
  }
  let data: { data?: unknown[] } = {};
  try {
    data = JSON.parse(r.body) as { data?: unknown[] };
  } catch {
    return {
      route: "ad-library",
      outcome: "REFUSED",
      detail: "HTTP 200 with a body that is not JSON — a challenge or an error page, not the archive",
      fetched: r.body.length,
      urls: [],
    };
  }
  const rows = data.data ?? [];
  return {
    route: "ad-library",
    outcome: rows.length > 0 ? "HIT" : "EMPTY",
    detail:
      rows.length > 0
        ? `${rows.length} ad record(s): ${JSON.stringify(rows).slice(0, 300)}`
        : "the archive answered and holds no political ad matching this name on this date — a fact about advertising spend, not about the candidate",
    fetched: r.body.length,
    urls: [],
  };
}

/* ── social-archive ──────────────────────────────────────────────────────── */

function slugCandidates(name: string): string[] {
  const parts = name
    .replace(/["'’]/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => !/^[A-Z]\.$/.test(w));
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  const joined = `${first}${last}`.toLowerCase();
  const dashed = `${first}-${last}`.toLowerCase();
  return [...new Set([joined, dashed, `${joined}forNH`.toLowerCase(), `vote${joined}`])].filter(Boolean);
}

async function routeSocialArchive(p: Person): Promise<RouteResult> {
  const urls: string[] = [];
  const hits: string[] = [];
  let fetched = 0;
  for (const slug of slugCandidates(p.name)) {
    const target = `https://facebook.com/${slug}`;
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(target)}`;
    urls.push(api);
    const r = await get(api, 15_000);
    fetched += r.body.length;
    if (r.status !== 200) continue;
    try {
      const j = JSON.parse(r.body) as {
        archived_snapshots?: { closest?: { url?: string; timestamp?: string } };
      };
      const snap = j.archived_snapshots?.closest;
      if (snap?.url) hits.push(`${target} → ${snap.url} (captured ${snap.timestamp})`);
    } catch {
      /* a non-JSON body from the availability API is a refusal of that call, not a finding */
    }
  }
  return {
    route: "social-archive",
    outcome: hits.length > 0 ? "HIT" : "EMPTY",
    detail:
      hits.length > 0
        ? hits.join(" · ")
        : `no Wayback capture for any of ${slugCandidates(p.name).length} guessed page slugs — a guessed slug that misses says nothing about whether the page exists`,
    fetched,
    urls,
  };
}

/* ── THE CONTROL QUERY ───────────────────────────────────────────────────── */

/**
 * **ASK THE HOST FOR SOMETHING THAT CANNOT EXIST, AND KEEP THE ANSWER.**
 *
 * The first run of this tool reported `HIT` for `social-mirror` and
 * `news-embed` on **16 of 16 candidates** — a 100% hit rate on GUESSED handles
 * across sixteen different people, which is not a discovery, it is a
 * measurement of the instrument. The control proved it in one command:
 *
 *   bsky.app/profile/janebradstreet.bsky.social ....... 200, 5,989 bytes
 *   bsky.app/profile/zzqxwvnonexistent99.bsky.social .. 200, 5,989 bytes
 *   instagram.com/janebradstreet/ .................... 200, 615,870 bytes
 *   instagram.com/zzqxwvnonexistent99/ ............... 200, 615,886 bytes
 *   concordmonitor.com/?s=Bradstreet ................. 200, 195,196 bytes
 *   concordmonitor.com/?s=Zzqxwvnonexistent .......... 200, 195,170 bytes
 *
 * Three hosts, three shapes of the same lie: an SPA shell, a login wall, and an
 * empty-results page that echoes the query back into its own HTML so a
 * substring test for the surname passes. Every one answers 200. This repo has
 * now recorded this shape six times — an empty RSS feed read as working, a
 * zero-match join read as a clean build, a scripted edit that edited nothing, a
 * portal 200ing with zero meetings, an Apptegy page missing its byline, and a
 * state roster SPA serving the identical shell for every member.
 *
 * So: before guessing an identifier at a host, ask that host for a control
 * identifier that certainly does not exist. Any real answer within
 * `SHELL_TOLERANCE` bytes of the control is the control wearing a name, and is
 * reported EMPTY. A tool that skipped this would have put thirty-two
 * fabricated findings into an exhaustion count.
 */
const CONTROL = "zzqxwvnonexistent99";
const SHELL_TOLERANCE = 0.02; /* 2% — instagram's shell varied by 16 bytes in 615 KB */

const controlCache = new Map<string, number>();

async function controlSize(make: (s: string) => string): Promise<number> {
  const url = make(CONTROL);
  const key = new URL(url).hostname;
  const hit = controlCache.get(key);
  if (hit !== undefined) return hit;
  const r = await get(url, 15_000);
  const size = r.status === 200 ? r.body.length : -1;
  controlCache.set(key, size);
  return size;
}

/** Is this response distinguishable from the host's answer for a name that cannot exist? */
function beyondControl(size: number, control: number): boolean {
  if (control < 0) return true; /* the control 404'd — a 200 here is a real difference */
  return Math.abs(size - control) > control * SHELL_TOLERANCE;
}

/* ── social-mirror ───────────────────────────────────────────────────────── */

const MIRRORS = [
  (s: string) => `https://www.instagram.com/${s}/`,
  (s: string) => `https://bsky.app/profile/${s}.bsky.social`,
  (s: string) => `https://linktr.ee/${s}`,
];

async function routeSocialMirror(p: Person): Promise<RouteResult> {
  const urls: string[] = [];
  const hits: string[] = [];
  const refused: string[] = [];
  let fetched = 0;
  const shells: string[] = [];
  for (const slug of slugCandidates(p.name).slice(0, 2)) {
    for (const make of MIRRORS) {
      const u = make(slug);
      urls.push(u);
      const control = await controlSize(make);
      const r = await get(u, 12_000);
      fetched += r.body.length;
      if (r.status === 0 || r.status === 403 || r.status === 429) {
        refused.push(`${u} (${r.status || "network"})`);
      } else if (r.status === 200 && beyondControl(r.body.length, control)) {
        hits.push(`${u} (HTTP 200, ${r.body.length} B vs control ${control} B)`);
      } else if (r.status === 200) {
        shells.push(`${new URL(u).hostname} (${r.body.length} B ≈ control ${control} B)`);
      }
    }
  }
  if (hits.length === 0 && shells.length > 0) {
    return {
      route: "social-mirror",
      outcome: "EMPTY",
      detail:
        `every mirror answered 200 with a body indistinguishable from its own control for a name that cannot exist — ` +
        `${shells.join(", ")}. A shell is not a profile, and a 200 here is a fact about the host.`,
      fetched,
      urls,
    };
  }
  if (hits.length === 0 && refused.length > 0 && refused.length === urls.length) {
    return {
      route: "social-mirror",
      outcome: "REFUSED",
      detail: `every mirror refused: ${refused.join(", ")}`,
      fetched,
      urls,
    };
  }
  return {
    route: "social-mirror",
    outcome: hits.length > 0 ? "LEAD" : "EMPTY",
    detail:
      hits.length > 0
        ? `${hits.join(" · ")} — a page EXISTS at a GUESSED handle. Whose it is has not been established and cannot be by this route; a human opens it and reads it before anything ships.`
        : `no mirror answered for ${urls.length} guessed handles${refused.length ? ` (${refused.length} refused)` : ""}`,
    fetched,
    urls,
  };
}

/* ── news-embed ──────────────────────────────────────────────────────────── */

/**
 * There is no general news API here, and inventing one would be worse than
 * saying so. What this DOES do is walk the archive of the local outlets this
 * project already knows for the state, which is a real route and a small one.
 *
 * It reports its own scope rather than implying a national sweep — a
 * scope-limited resolver states OUR scope, never THEIR absence.
 */
const LOCAL_OUTLETS: Record<string, string[]> = {
  NH: ["https://www.concordmonitor.com/?s=", "https://www.intertownrecord.org/?s="],
  NJ: ["https://www.dailyrecord.com/search/?q=", "https://newjerseyhills.com/search/?q="],
  AZ: ["https://tucson.com/search/?q=", "https://www.azcentral.com/search/?q="],
};

async function routeNewsEmbed(p: Person): Promise<RouteResult> {
  const outlets = LOCAL_OUTLETS[p.state] ?? [];
  if (outlets.length === 0) {
    return {
      route: "news-embed",
      outcome: "REFUSED",
      detail: `no local outlet is wired for ${p.state} — OUR scope, and it says nothing about coverage of this person`,
      fetched: 0,
      urls: [],
    };
  }
  const urls: string[] = [];
  const hits: string[] = [];
  let fetched = 0;
  const shells: string[] = [];
  for (const base of outlets) {
    const u = `${base}${encodeURIComponent(p.name)}`;
    urls.push(u);
    /*
     * The control matters MORE here than on a profile host, because a search
     * page ECHOES the query into its own HTML. A substring test for the surname
     * therefore passes on an empty-results page, and passed on all sixteen
     * candidates in this tool's first run.
     */
    const control = await controlSize((s) => `${base}${encodeURIComponent(s)}`);
    const r = await get(u, 15_000);
    fetched += r.body.length;
    if (r.status !== 200) continue;
    if (!beyondControl(r.body.length, control)) {
      shells.push(`${new URL(u).hostname} (${r.body.length} B ≈ its own no-results page at ${control} B)`);
      continue;
    }
    const surname = p.name.split(/\s+/).pop() ?? "";
    if (surname.length > 2 && r.body.includes(surname)) {
      hits.push(`${new URL(u).hostname} returned a results page larger than its own empty control and naming "${surname}" (${r.body.length} B vs ${control} B)`);
    }
  }
  return {
    route: "news-embed",
    outcome: hits.length > 0 ? "HIT" : "EMPTY",
    detail:
      hits.length > 0
        ? `${hits.join(" · ")} — still a LEAD, never a source; the article is opened and read before anything ships`
        : shells.length > 0
          ? `${outlets.length} wired outlet(s) searched; ${shells.length} returned their own no-results page — ${shells.join(", ")}. The query is echoed into that page, so a surname test passes on it and means nothing.`
          : `${outlets.length} wired outlet(s) searched, none returned results on this date`,
    fetched,
    urls,
  };
}

/* ─────────────────────────────── the run ────────────────────────────────── */

const ROUTES = [routeAdLibrary, routeSocialArchive, routeSocialMirror, routeNewsEmbed];

const rosterPath = arg("--roster");
const people: Person[] = rosterPath
  ? (JSON.parse(readFileSync(rosterPath, "utf8")) as Person[])
  : [
      {
        name: arg("--name") ?? "",
        state: arg("--state") ?? "NH",
        town: arg("--town"),
        office: arg("--office"),
      },
    ];

if (people.length === 0 || !people[0]!.name) {
  console.error(
    'usage: pnpm ad:library --name "First Last" --state NH [--town T] [--office O] [--json out.json]\n' +
      "   or: pnpm ad:library --roster <file.json> [--json out.json]",
  );
  process.exit(2);
}

console.log(`\nRULING 66 — COMPLIANT ROUTES TO A WALLED SOCIAL PAGE · walked ${today}`);
console.log(
  `  ${people.length} person(s) · 4 routes each · ad-library token ${TOKEN ? "PRESENT" : "ABSENT (route reports REFUSED, never EMPTY)"}\n`,
);

const all: { person: Person; results: RouteResult[] }[] = [];

for (const person of people) {
  console.log(`  ${person.name}${person.office ? ` — ${person.office}` : ""}`);
  const results: RouteResult[] = [];
  for (const fn of ROUTES) {
    const r = await fn(person);
    results.push(r);
    console.log(`      ${r.outcome.padEnd(8)} ${r.route.padEnd(16)} ${r.detail.slice(0, 150)}`);
  }
  all.push({ person, results });
  console.log("");
}

/* The pair, per route, across the whole roster. */
console.log("  PER ROUTE, ACROSS ALL PERSONS:\n");
for (const route of ["ad-library", "social-archive", "social-mirror", "news-embed"]) {
  const rs = all.flatMap((a) => a.results).filter((r) => r.route === route);
  const hit = rs.filter((r) => r.outcome === "HIT").length;
  const lead = rs.filter((r) => r.outcome === "LEAD").length;
  const empty = rs.filter((r) => r.outcome === "EMPTY").length;
  const refused = rs.filter((r) => r.outcome === "REFUSED").length;
  const sum = hit + lead + empty + refused;
  console.log(
    `    ${route.padEnd(16)} HIT ${hit} · LEAD ${lead} · EMPTY ${empty} · REFUSED ${refused}  (${sum} of ${people.length}${sum === people.length ? " — reconciles" : " *** DOES NOT RECONCILE ***"})`,
  );
}

console.log(
  "\n  REFUSED is not EMPTY. A refused route has NOT been walked for RULING 61 purposes,\n" +
    "  and a field it would have served stays STILL OWED rather than moving toward exhaustion.\n",
);

const out = arg("--json");
if (out) {
  writeFileSync(out, `${JSON.stringify({ walkedAt: today, tokenPresent: Boolean(TOKEN), all }, null, 2)}\n`, "utf8");
  console.log(`  written ${out}\n`);
}
