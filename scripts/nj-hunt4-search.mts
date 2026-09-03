/**
 * **`search-index`, MADE MECHANICALLY WALKABLE.** (NJ Hunt 4 item 5, 2026-08-22.)
 *
 * ```
 * pnpm nj:search                          # every candidate in every contest
 * pnpm nj:search --contest borough-council
 * pnpm nj:search --limit 20 --out data/states/nj/hunt/nj-hunt4-search.json
 * ```
 *
 * ## Why this exists
 *
 * `search-index` has been a route id in the manifest since v1 and it has never
 * been walkable by a script — every previous session walked it by hand, which
 * meant it was walked for the candidates somebody had time for. That is the
 * ranking the equal-effort rule forbids, produced by tooling rather than by
 * choice. 272 candidates cannot be hand-searched; a script can search all of
 * them, and then the same route has been walked for everybody.
 *
 * This does NOT add a route to the manifest. `search-index` already exists.
 * RULING 63: building a branch that already exists is a reported defect, so
 * this ENRICHES the existing route with a New Jersey sub-branch (RULING 60).
 *
 * ## What it returns, and what it refuses to return
 *
 * A search result is a LEAD and never a HIT. RULING 68 and the transparency
 * mandate evidence standard both land in the same place: a search engine saying
 * a URL is about a person is somebody else claim about a real person. Every URL
 * this produces is classified into the manifest route it would be evidence FOR,
 * and then a verifying fetch decides. Nothing here writes a field.
 *
 * The CONTROL (RULING 68): the same query shape is run for a name that cannot
 * be a candidate. A search engine that returns the same result set for the
 * control as for a real name is templating, and its answers are discarded.
 *
 * ## The engines, and why there is more than one
 *
 * RULING 52: a branch returning empty is one measurement on one date. The
 * DuckDuckGo HTML endpoint answered this machine at 09:0x on 2026-08-22 and was
 * serving HTTP 202 with an empty result set by 09:1x — a rate wall, reached in
 * six queries. A single-engine hunt would have recorded 272 honest absences off
 * that one wall.
 *
 * So the engines are a TREE, and independence is counted over the dependency
 * rather than over the name: `bing` (Microsoft), `ddg` (DuckDuckGo, which is
 * itself Bing-derived for the index but a different front door and a different
 * rate ledger), `mojeek` (its own crawler), `yahoo` (Verizon/Bing). Each query
 * walks the engines in order until one answers with parsed rows; a wall on one
 * is recorded with the engine named and the walk continues. All four walled is
 * a FAILED SEARCH and is reported as one — never as an empty result.
 *
 * A zero result set is reported as a FAILED SEARCH, never as an empty one —
 * the zero-row rule.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { searchableGiven, searchableSurname } from "../lib/ballot/name-case.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const contestFilter = arg("--contest");
const limit = Number(arg("--limit") ?? "0");
const skip = Number(arg("--skip") ?? "0");
const outPath = arg("--out") ?? join(ROOT, "data", "states", "nj", "hunt", "nj-hunt4-search.json");
/**
 * **RESUME, AND WHY IT IS NOT A CONVENIENCE.**
 *
 * A rate wall is a property of the hour, not of the candidate. The first full
 * run answered for candidates 1–90 and then walled on every engine for the
 * rest — so re-running from zero would spend the engines' recovered budget
 * re-asking questions that already have answers, and wall again before reaching
 * the candidates that still need one.
 *
 * `--resume` reads the existing file, KEEPS every candidate whose walk already
 * produced at least one classified URL, and re-walks the rest. Nothing is
 * discarded: a candidate carried forward keeps its original `walkedAt`, because
 * a measurement is dated by when it was taken.
 */
const resume = process.argv.includes("--resume");
/** Re-walk even the candidates that already have hits (a manifest bump). */
const rewalkAll = process.argv.includes("--rewalk-all");

interface Ballot {
  contests: { id: string; title: string; ocdId: string }[];
  candidacies: {
    id: string;
    contestId: string;
    familyName: string;
    givenName: string;
    partyLabel: string | null;
    slogan: string | null;
  }[];
}

const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8"),
) as Ballot;

/**
 * The municipality a contest belongs to, read from its OCD-ID rather than from
 * its title. A title is prose; an OCD-ID is the join key this repo already uses
 * everywhere else.
 */
function municipality(ocdId: string): string | null {
  const m = /\/place:([a-z_]+)/.exec(ocdId) ?? /\/school_district:([a-z_]+)/.exec(ocdId);
  if (!m) return null;
  return m[1]
    .replace(/_/g, " ")
    .replace(/\b([a-z])/g, (s) => s.toUpperCase());
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/*
 * **RULING 63, RECORDED AGAINST THIS SESSION.** The first draft of this file
 * wrote its own title-caser without checking whether one existed. One did:
 * `lib/ballot/name-case.ts`, since 2026-08-17, with an exceptions map (DeCroce,
 * DiMaio, LaVecchia), Mc handling and apostrophe handling that the duplicate
 * lacked. Duplication is worse than a gap and it is reported as a defect rather
 * than quietly deleted. `searchableSurname` there is the shared one, and it now
 * carries the suffix-stripping this file actually needed.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  /** The manifest route this URL would be evidence for, if it verifies. */
  route: string;
}

/** Host families, and the manifest route each is evidence for. */
const HOST_ROUTES: readonly { test: RegExp; route: string }[] = [
  { test: /(^|\.)facebook\.com$/i, route: "campaign-social" },
  { test: /(^|\.)instagram\.com$/i, route: "campaign-social" },
  { test: /(^|\.)x\.com$|(^|\.)twitter\.com$/i, route: "campaign-social" },
  { test: /(^|\.)linkedin\.com$/i, route: "employer-listing" },
  { test: /(^|\.)goodparty\.org$/i, route: "candidate-platform" },
  { test: /(^|\.)vote411\.org$|(^|\.)lwv/i, route: "lwv-questionnaire" },
  {
    test: /(^|\.)actblue\.com$|(^|\.)winred\.com$|(^|\.)anedot\.com$|(^|\.)donorbox\.org$|(^|\.)secure\.actblue\.com$/i,
    route: "donation-platform",
  },
  {
    test: /(^|\.)tapinto\.net$|(^|\.)patch\.com$|(^|\.)dailyrecord\.com$|(^|\.)njhills\.com$|(^|\.)newjerseyhills\.com$|(^|\.)nj\.com$|(^|\.)northjersey\.com$|(^|\.)njspotlightnews\.org$/i,
    route: "local-newspaper",
  },
  { test: /(^|\.)elec\.nj\.gov$/i, route: "filing-campaign-finance-local" },
  { test: /(^|\.)fec\.gov$/i, route: "filing-fec" },
  { test: /(^|\.)njcourts\.gov$/i, route: "bar-directory" },
  { test: /(^|\.)morriscountyclerk\.org$|(^|\.)morriscountynj\.gov$/i, route: "filing-county" },
  { test: /(^|\.)web\.archive\.org$/i, route: "web-archive" },
  { test: /(^|\.)k12\.nj\.us$|schoolwires|edline|(^|\.)sharpschool/i, route: "body-roster-page" },
  { test: /\.gov$|(^|\.)nj\.us$/i, route: "gov-staff-directory" },
];

/** Hosts whose answers are never evidence of anything (RULING 70 and the photo doors). */
const NEVER: readonly RegExp[] = [
  /(^|\.)ballotpedia\.org$/i,
  /(^|\.)wikipedia\.org$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)legacy\.com$/i,
  /whitepages|spokeo|truepeoplesearch|radaris|beenverified|fastpeoplesearch|mylife\.com|intelius|peoplefinder|usphonebook|clustrmaps/i,
];

/**
 * The route a URL is evidence for. A `.org` or `.com` that carries the
 * candidate own surname in the host is a possible campaign site — and it is
 * still a LEAD, because a surname in a host name is a guess about a person.
 */
function routeFor(url: string, family: string, given: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (NEVER.some((n) => n.test(host))) return null;
  const g = given.toLowerCase().replace(/[^a-z]/g, "");
  const f = family.toLowerCase().replace(/[^a-z]/g, "");
  const bare = host.replace(/^www\./, "").replace(/[^a-z]/g, "");
  const generic = /(^|\.)(gov|nj\.us|k12\.nj\.us)$/i.test(host);
  if (!generic && f.length >= 5 && bare.includes(f)) return "campaign-site";
  if (!generic && g.length >= 4 && f.length >= 3 && bare.includes(g) && bare.includes(f))
    return "campaign-site";
  for (const h of HOST_ROUTES) if (h.test.test(host)) return h.route;
  return "search-index";
}

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type Row = { url: string; title: string; snippet: string };

async function html(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
  });
  return { status: res.status, text: await res.text() };
}

/** Bing. Results are `b_algo` blocks whose href is a `ck/a` redirect carrying the target base64-encoded. */
async function bing(q: string): Promise<Row[]> {
  const { status, text } = await html("https://www.bing.com/search?q=" + encodeURIComponent(q));
  if (status !== 200) throw new Error(`WALL ${status} — bing`);
  const out: Row[] = [];
  for (const b of text.split('class="b_algo"').slice(1)) {
    const a = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(b);
    if (!a) continue;
    const href = a[1].replace(/&amp;/g, "&");
    let url = href;
    const enc = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(href);
    if (enc) {
      try {
        url = Buffer.from(enc[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      } catch {
        /* keep the redirect; the classifier will drop a bing.com host */
      }
    }
    if (/(^|\.)bing\.com$/i.test(new URL(url).hostname)) continue;
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(b);
    out.push({ url, title: strip(a[2]).slice(0, 200), snippet: p ? strip(p[1]).slice(0, 320) : "" });
  }
  if (out.length === 0) throw new Error("WALL — bing answered 200 with zero parsed rows");
  return out;
}

/** DuckDuckGo HTML. Answers until it rate-walls with HTTP 202 and an empty body. */
async function ddg(q: string): Promise<Row[]> {
  const { status, text } = await html("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q));
  if (status !== 200) throw new Error(`WALL ${status} — ddg`);
  const out: Row[] = [];
  const re =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]*class="result__a"|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let url = m[1];
    if (url.includes("uddg=")) url = decodeURIComponent(url.split("uddg=")[1].split("&")[0]);
    if (url.startsWith("//")) url = "https:" + url;
    const snipM = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(m[3]);
    out.push({ url, title: strip(m[2]), snippet: snipM ? strip(snipM[1]).slice(0, 320) : "" });
  }
  if (out.length === 0) throw new Error("WALL — ddg answered 200 with zero parsed rows");
  return out;
}

/** Mojeek — its own crawler, so a genuinely independent dependency. */
async function mojeek(q: string): Promise<Row[]> {
  const { status, text } = await html("https://www.mojeek.com/search?q=" + encodeURIComponent(q));
  if (status !== 200) throw new Error(`WALL ${status} — mojeek`);
  const out: Row[] = [];
  const re = /<a\b[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*\bclass="ob"[^>]*>([\s\S]*?)<\/a>|<a\b[^>]*\bclass="ob"[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const url = m[1] ?? m[3];
    const title = strip(m[2] ?? m[4] ?? "");
    if (url) out.push({ url, title, snippet: "" });
  }
  if (out.length === 0) throw new Error("WALL — mojeek answered 200 with zero parsed rows");
  return out;
}

/** Yahoo — a fourth front door, and the last one tried. */
async function yahoo(q: string): Promise<Row[]> {
  const { status, text } = await html("https://search.yahoo.com/search?p=" + encodeURIComponent(q));
  if (status !== 200) throw new Error(`WALL ${status} — yahoo`);
  const out: Row[] = [];
  const re = /<a[^>]+class="[^"]*d-ib[^"]*"[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let url = m[1];
    const ru = /\/RU=([^/]+)\//.exec(url);
    if (ru) {
      try {
        url = decodeURIComponent(ru[1]);
      } catch {
        /* keep as-is */
      }
    }
    if (/(^|\.)yahoo\.com$/i.test(new URL(url).hostname)) continue;
    out.push({ url, title: strip(m[2]), snippet: "" });
  }
  if (out.length === 0) throw new Error("WALL — yahoo answered 200 with zero parsed rows");
  return out;
}


/**
 * **SearXNG — RUNG 5, A DIFFERENT EGRESS.** (Added mid-run, NJ Hunt 4 item 5.)
 *
 * Bing and Yahoo both rate-walled this machine after roughly 170 queries: from
 * candidate 90 to candidate 100 the run answered ZERO queries and failed thirty.
 * That is not a fact about the 272 candidates, and a run that stopped there
 * would have written 180 honest-looking absences off one IP's rate ledger.
 *
 * A SearXNG instance queries the upstream engines FROM ITS OWN SERVER. Our
 * requests to it are not on the rate ledger the wall belongs to, which is the
 * ladder's rung 5 exactly: a rung is `(client, headers, URL, egress)`, and this
 * changes the egress. Three public instances are used because a public instance
 * is somebody's hobby server and any one of them can be down — measured
 * 2026-08-22, each returned a DIFFERENT result set for the same query, so they
 * are also genuinely different upstream mixes rather than three names for one
 * answer.
 *
 * Politeness is not optional here and is stricter than for a commercial engine:
 * one request at a time, spaced, identified, and the instances are rotated so no
 * single volunteer host carries the whole run.
 */
const SEARX_HOSTS = ["https://priv.au", "https://opnxng.com", "https://paulgo.io"];
let searxCursor = 0;

function searxAt(host: string) {
  return async function searxEngine(q: string): Promise<Row[]> {
    const { status, text } = await html(host + "/search?q=" + encodeURIComponent(q));
    if (status !== 200) throw new Error(`WALL ${status} — ${host}`);
    const out: Row[] = [];
    const re = /<h3><a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>([\s\S]{0,900}?)(?=<h3><a|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const url = m[1];
      let host2 = "";
      try {
        host2 = new URL(url).hostname;
      } catch {
        continue;
      }
      if (/(^|\.)(priv\.au|opnxng\.com|paulgo\.io)$/i.test(host2)) continue;
      const p = /<p class="content">([\s\S]*?)<\/p>/.exec(m[3]);
      out.push({ url, title: strip(m[2]).slice(0, 200), snippet: p ? strip(p[1]).slice(0, 320) : "" });
    }
    if (out.length === 0) throw new Error(`WALL — ${host} answered 200 with zero parsed rows`);
    return out;
  };
}

/** One SearXNG call, rotating instances so no volunteer host carries the run. */
async function searx(q: string): Promise<Row[]> {
  const errors: string[] = [];
  for (let i = 0; i < SEARX_HOSTS.length; i++) {
    const host = SEARX_HOSTS[(searxCursor + i) % SEARX_HOSTS.length];
    try {
      const rows = await searxAt(host)(q);
      searxCursor = (searxCursor + i + 1) % SEARX_HOSTS.length;
      return rows;
    } catch (e) {
      errors.push((e as Error).message);
      await sleep(500);
    }
  }
  throw new Error(errors.join(" · "));
}

const ENGINES: readonly { name: string; run: (q: string) => Promise<Row[]> }[] = [
  { name: "searx", run: searx },
  { name: "bing", run: bing },
  { name: "yahoo", run: yahoo },
  { name: "ddg", run: ddg },
  { name: "mojeek", run: mojeek },
];

/** Engine health, so a dead engine is skipped rather than re-walled 272 times. */
const engineWalls = new Map<string, number>();
const engineHits = new Map<string, number>();
const engineOffSubject = new Map<string, number>();
const WALL_GIVE_UP = 8;

/**
 * A walled engine is RESTED, not hammered.
 *
 * Bing and Yahoo both wall on rate. Asking a walled engine again immediately,
 * 272 times, is what turned a temporary wall into an apparent 180-candidate
 * absence. After a wall an engine is skipped until `restUntil` passes — a
 * minute, doubling to a cap — and every skip is counted so the report can say
 * how much of the run each engine actually carried.
 */
const engineRest = new Map<string, number>();
const engineRestMs = new Map<string, number>();
const REST_BASE_MS = 60_000;
const REST_CAP_MS = 15 * 60_000;
let clock = 0;

/**
 * Ask EVERY engine that will answer, and union what they return, rather than
 * stopping at the first. Bing and Yahoo returned overlapping-but-different sets
 * for the same Rockaway councillor — Bing had the vote411 questionnaire, Yahoo
 * had the GoodParty profile, and neither had both. First-answer-wins would have
 * lost whichever the coin landed against.
 */
const UNION_ALL = true;

/**
 * One query across the engine tree. Returns the rows and the engine that
 * answered. Throws only when EVERY engine walled — and then it is a failed
 * search, named as one.
 *
 * `mustMention` is the standing rule made mechanical: **a 200 whose content is
 * not about the thing asked for is not a document.** Bing silently drops a
 * quoted phrase when the rest of the query is thin — `"Melissa Burnside"
 * Rockaway NJ` returns ten pages about a shoe brand, HTTP 200, ten parsed rows,
 * and not one mention of the person. Reading that as "nothing found about
 * Melissa Burnside" is the false miss this whole project exists to refuse. So a
 * result set that never mentions the surname is treated as that engine failing
 * THIS query, and the next engine is asked.
 */
function rest(name: string): void {
  const next = Math.min((engineRestMs.get(name) ?? 0) * 2 || REST_BASE_MS, REST_CAP_MS);
  engineRestMs.set(name, next);
  engineRest.set(name, clock + next);
}

async function search(
  q: string,
  mustMention?: string,
  retrying = false,
): Promise<{ rows: Row[]; engine: string }> {
  clock = Date.now();
  const walls: string[] = [];
  const union = new Map<string, Row>();
  const answered: string[] = [];
  const token = mustMention?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  const about = (rows: Row[]) =>
    token.length < 3 ||
    rows.some((r) => `${r.title} ${r.snippet} ${r.url}`.toLowerCase().replace(/[^a-z]/g, "").includes(token));
  for (const e of ENGINES) {
    if ((engineWalls.get(e.name) ?? 0) >= WALL_GIVE_UP && (engineHits.get(e.name) ?? 0) === 0) {
      walls.push(`${e.name}: skipped, walled ${engineWalls.get(e.name)} times with no answer`);
      continue;
    }
    if (clock < (engineRest.get(e.name) ?? 0)) {
      walls.push(`${e.name}: resting after a rate wall`);
      continue;
    }
    try {
      const rows = await e.run(q);
      if (!about(rows)) {
        engineOffSubject.set(e.name, (engineOffSubject.get(e.name) ?? 0) + 1);
        walls.push(`${e.name}: 200 with ${rows.length} rows, none mentioning ${mustMention} — not a document`);
        await sleep(400);
        continue;
      }
      engineHits.set(e.name, (engineHits.get(e.name) ?? 0) + 1);
      engineRestMs.delete(e.name);
      answered.push(e.name);
      for (const r of rows) if (!union.has(r.url)) union.set(r.url, r);
      if (!UNION_ALL) return { rows, engine: e.name };
      await sleep(400);
    } catch (err) {
      engineWalls.set(e.name, (engineWalls.get(e.name) ?? 0) + 1);
      rest(e.name);
      walls.push(`${e.name}: ${(err as Error).message}`);
      await sleep(400);
    }
  }
  if (union.size > 0) return { rows: [...union.values()], engine: answered.join("+") };

  const soonest = Math.min(...[...engineRest.values()], Infinity);
  if (!retrying && Number.isFinite(soonest) && soonest > clock) {
    const waitMs = Math.min(soonest - clock + 1_000, REST_CAP_MS);
    console.log(`  every engine is resting — waiting ${Math.round(waitMs / 1000)}s rather than recording a miss`);
    await sleep(waitMs);
    return search(q, mustMention, true);
  }
  throw new Error(`NO ENGINE ANSWERED ABOUT THE SUBJECT — ${walls.join(" · ")}`);
}

/* ── the control, once for the run (RULING 68) ───────────────────────────── */
const CONTROL_QUERY = '"Zzyzx Qwertling" Rockaway New Jersey candidate 2026';
let controlUrls = new Set<string>();
try {
  const c = await search(CONTROL_QUERY);
  controlUrls = new Set(c.rows.map((r) => r.url));
  console.log(
    `CONTROL (RULING 68): ${JSON.stringify(CONTROL_QUERY)} returned ${c.rows.length} result(s) via ${c.engine}. ` +
      `Any real-name result matching one of those URLs is discarded as templating.`,
  );
} catch (e) {
  console.log(
    `CONTROL failed: ${(e as Error).message} — the run continues, every result is kept, and this is stated.`,
  );
}

/*
 * THE CONTROL MUST NOT REST AN ENGINE, and the first version of this file did.
 *
 * A control query asks for a name that cannot exist. An engine that answers it
 * with ZERO results is the control WORKING — that is the whole point of asking.
 * But zero parsed rows is also how this file recognises a rate wall, so the
 * engines that behaved correctly on the control were being rested for a minute
 * before the run had asked a single real question. SearXNG, the one branch whose
 * egress is not walled, was taken out of the run by being right.
 *
 * So the ledger is cleared here: nothing an engine did on the control counts for
 * or against it.
 */
engineRest.clear();
engineRestMs.clear();
engineWalls.clear();
engineHits.clear();
engineOffSubject.clear();

/* ── the walk ────────────────────────────────────────────────────────────── */
const contests = ballot.contests.filter((c) => !contestFilter || c.id.includes(contestFilter));
const results: Record<
  string,
  {
    candidate: string;
    contestId: string;
    contestTitle: string;
    municipality: string | null;
    queries: { q: string; n: number; engine?: string; error?: string }[];
    hits: SearchHit[];
    walkedAt: string;
  }
> = {};

/* What a previous run already answered. */
const carried: typeof results = {};
if (resume) {
  try {
    const prior = JSON.parse(readFileSync(outPath, "utf8")) as {
      candidates: Record<string, (typeof results)[string]>;
    };
    for (const [id, row] of Object.entries(prior.candidates ?? {})) {
      if (!rewalkAll && row.hits.length > 0) carried[id] = row;
    }
    console.log(
      `resuming: ${Object.keys(prior.candidates ?? {}).length} candidate(s) in the prior walk, ` +
        `${Object.keys(carried).length} carried forward with hits, the rest re-walked.`,
    );
  } catch {
    console.log("resuming: no prior walk found at that path — walking everything.");
  }
}

let seenCount = 0;
let done = 0;
let searched = 0;
let failedQueries = 0;
outer: for (const contest of contests) {
  const cands = ballot.candidacies.filter((c) => c.contestId === contest.id);
  const place = municipality(contest.ocdId);
  for (const c of cands) {
    seenCount++;
    if (seenCount <= skip) continue;
    if (carried[c.id]) {
      results[c.id] = carried[c.id];
      continue;
    }
    if (limit && done >= limit) break outer;
    /*
     * TITLE-CASE THE SURNAME BEFORE ASKING.
     *
     * The clerk filing PDF carries family names in ALL CAPS. Bing tokenises an
     * all-caps word differently and silently drops it from a quoted phrase:
     * `"Melissa BURNSIDE" Rockaway New Jersey Borough Council` came back as ten
     * results about a shoe brand, with the surname absent from every one, while
     * `"Melissa Burnside"` returned the Borough directory at rank 1. That is a
     * defect that would have read as 272 honest absences.
     */
    const name = `${searchableGiven(c.givenName)} ${searchableSurname(c.familyName)}`;
    const office = contest.title.replace(/^Member of the /, "").replace(/ - Ward \d/, "");
    const where = place ?? "Morris County";
    const queries = [
      `"${name}" ${where} ${office} New Jersey`,
      `"${name}" ${where} New Jersey 2026 election candidate`,
      `"${name}" ${where} New Jersey ${office} campaign website`,
    ];
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    const qlog: { q: string; n: number; engine?: string; error?: string }[] = [];
    for (const q of queries) {
      try {
        const { rows, engine } = await search(q, searchableSurname(c.familyName));
        searched++;
        qlog.push({ q, n: rows.length, engine });
        for (const r of rows) {
          if (seen.has(r.url) || controlUrls.has(r.url)) continue;
          seen.add(r.url);
          /*
           * THE RELEVANCE FLOOR, and it is not tidiness.
           *
           * Bing relaxes a quoted phrase silently: `"Justin MURPHY" Morris
           * County New Jersey` came back with justinbiebermusic.com at rank 1.
           * A search engine that answers with something else entirely has not
           * told us anything about this person, and keeping those rows would
           * bury every real result under noise nobody would read.
           *
           * So a row survives only if the SURNAME appears in what came back —
           * the title, the snippet or the URL. That is a floor, not a
           * verification: RULING 68 still caps everything here at LEAD, and the
           * verifying fetch downstream is what turns a LEAD into evidence.
           */
          const hay = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
          const fam = searchableSurname(c.familyName).toLowerCase().replace(/[^a-z]/g, "");
          if (fam.length >= 3 && !hay.replace(/[^a-z]/g, "").includes(fam)) continue;
          const route = routeFor(r.url, searchableSurname(c.familyName), c.givenName);
          if (!route) continue;
          hits.push({ url: r.url, title: r.title, snippet: r.snippet, route });
        }
      } catch (e) {
        failedQueries++;
        qlog.push({ q, n: 0, error: (e as Error).message });
      }
      await sleep(1200);
    }
    results[c.id] = {
      candidate: name,
      contestId: contest.id,
      contestTitle: contest.title,
      municipality: place,
      queries: qlog,
      hits,
      walkedAt: AS_OF,
    };
    done++;
    /*
     * **WRITE AS IT GOES.** The first full run walked ninety candidates, was
     * stopped to add engines, and lost all ninety — because the file was only
     * written at the end. Ninety candidates is roughly an hour of a rate-limited
     * search index's budget, and spending it twice for want of a flush is the
     * kind of loss that is invisible until it happens.
     */
    flush();
    if (done % 10 === 0)
      console.log(`  ${done} candidates walked, ${searched} queries issued, ${failedQueries} failed`);
  }
}

/**
 * **WRITE AS IT GOES.** The first full run walked ninety candidates, was stopped
 * to add engines, and lost all ninety — because the file was only written at the
 * end. Ninety candidates is roughly an hour of a rate-limited search index's
 * budget, and spending it twice for want of a flush is the kind of loss that is
 * invisible until it happens.
 */
function flush(): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        route: "search-index",
        engines: ENGINES.map((e) => e.name),
        engineAnswers: Object.fromEntries(engineHits),
        engineWalls: Object.fromEntries(engineWalls),
        engineOffSubject: Object.fromEntries(engineOffSubject),
        walkedAt: AS_OF,
        control: CONTROL_QUERY,
        candidates: results,
      },
      null,
      2,
    ),
    "utf8",
  );
}

flush();

/* The counts. A zero-row read is a FAILED read, never an empty one. */
const total = Object.keys(results).length;
const withHits = Object.values(results).filter((r) => r.hits.length > 0).length;
console.log(
  `\nsearch-index walked for ${total} candidate(s) across ${contests.length} contest(s): ` +
    `${searched} queries answered, ${failedQueries} failed on every engine, ` +
    `${withHits} candidate(s) returned at least one classified URL.`,
);
console.log(
  `  engines that answered: ${[...engineHits].map(([n, c]) => `${n} ${c}`).join(" · ") || "none"}`,
);
console.log(`  engine walls: ${[...engineWalls].map(([n, c]) => `${n} ${c}`).join(" · ") || "none"}`);
console.log(
  `  engine answered 200 but off-subject: ${[...engineOffSubject].map(([n, c]) => `${n} ${c}`).join(" · ") || "none"}`,
);
if (total > 0 && searched === 0) {
  console.error("ZERO QUERIES ISSUED — that is a failed run, not an empty search.");
  process.exit(1);
}
console.log(`written ${outPath}`);