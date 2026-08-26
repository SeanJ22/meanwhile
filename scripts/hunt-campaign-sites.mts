#!/usr/bin/env tsx
/**
 * **THE CAMPAIGN-SITE HUNT, BY BROAD ROUTE.** (Built 2026-08-24, the NJ depth
 * session. Serves the `campaignSite` field, owed on 260 of 272 candidacies at
 * 07866 when this was written.)
 *
 * ```
 * pnpm hunt:sites --route=<id> [--route=<id> …]   walk named routes
 * pnpm hunt:sites --routes                        list the routes and exit
 * ```
 *
 * ## Why this exists rather than another per-candidate search
 *
 * RULING 84 tiers the manifest and RULING 90 item 3 makes the meta-search a
 * FIRST move: *one cheap search answering where all 272 live beats hundreds
 * answering nothing.* NJ Hunt 4 spent an entire search budget on 272
 * individuals. Every route here is a BROAD one — it fetches a small number of
 * pages that are each about many candidates at once, and the per-candidate cost
 * is a string match against bytes already on this machine.
 *
 * ## The three phases, and the conservation contract across them
 *
 * **HARVEST** fetches the route's source pages. **MINE** matches every
 * candidate's name forms against every harvested page and collects the external
 * links sitting near a match. **PROVE** fetches each distinct lead through
 * `ControlledProbe` and applies `verdictFor`.
 *
 * RULING 128: every phase states `produced + dropped + … === input`, exactly,
 * and the run refuses to write an artifact whose arithmetic does not close.
 *
 * ## What a HIT means here, and it is the same bar as everywhere else
 *
 * RULING 68 and `lib/hunt/candidate-evidence.ts`, reused rather than
 * reimplemented — a page must clear the host's own control AND name the
 * candidate in a form stronger than the bare surname AND carry a word showing
 * it is about standing for office. A domain that merely answers is a `LEAD`.
 *
 * RULING 110: every name FORM is recorded on every row, matched or not,
 * including diminutives — two of the first eight hits on this ballot existed
 * only under a diminutive.
 *
 * ## Symmetry is enforced, not remembered
 *
 * A route may declare `symmetricWith`. Both sides are walked or neither is, and
 * the run REFUSES rather than walking one. The equal-effort rule is a hunt
 * discipline; a party-hosted route walked for one party and not the other is
 * that rule failing in the place it was written for.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  flattenForEvidence,
  matchNameForms,
  officeEvidenceIn,
  verdictFor,
} from "../lib/hunt/candidate-evidence.ts";
import { ControlledProbe, type ProbeOutcome } from "../lib/hunt/control-query.ts";
import { browserProfileHeaders, sourceUserAgent } from "../lib/sources/http.ts";
import { conserve } from "../lib/sources/normalize-account.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "data", "hunt");
const SPACING_MS = 1_200;

/* ------------------------------------------------------------------ types */

interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel: string | null;
  slogan: string | null;
}

interface Contest {
  id: string;
  title: string;
}

interface SourcePage {
  url: string;
  /** Who publishes it — RULING 93 asks this of every directory route. */
  publisher: string;
  status: number;
  bytes: number;
  text: string;
  ok: boolean;
  note?: string;
}

interface Lead {
  candidacyId: string;
  subject: string;
  contestTitle: string;
  /** The page the lead was mined FROM — the provenance, never dropped. */
  foundOn: string;
  foundOnPublisher: string;
  /**
   * The page the evidence is ON. It is what gets fetched and read.
   */
  url: string;
  /**
   * The SITE, which is what a reader is shown.
   *
   * The two are separated because collapsing them broke the route in both
   * directions. Mining paths produced two rows for one slate site; mining hosts
   * lost the page that carried the name and the office, so a site that had
   * proven itself stopped proving itself. A campaign site is a PLACE and the
   * evidence for it is a PAGE, and they are not the same string.
   */
  siteUrl: string;
  /** Whether the URL was read off a page or constructed by us. RULING 68. */
  guessed: boolean;
}

interface Proven extends Lead {
  outcome: ProbeOutcome;
  detail: string;
  status: number;
  bytes: number;
  control: number;
  formsSearched: { form: string; kind: string; matched: boolean }[];
  officeEvidence: string[];
  attemptedAt: string;
}

interface Route {
  id: string;
  tier: "A" | "B" | "C";
  publisher: string;
  /** What the route is ABOUT — the tier below it, in RULING 93's terms. */
  about: string;
  /** Both sides walked or neither. */
  symmetricWith?: string;
  /** The pages to harvest. May fetch to discover more. */
  pages: (ctx: Ctx) => Promise<{ url: string; publisher: string }[]>;
}

interface Ctx {
  candidacies: Candidacy[];
  contests: Map<string, Contest>;
  get: (url: string, publisher: string) => Promise<SourcePage>;
  today: string;
}

/* ------------------------------------------------------------- utilities */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * The stamp comes from `scripts/doc-dates.mjs`, never a local formatter — a
 * second copy of the Phoenix rule is a duplicate implementation (RULING 103).
 *
 * It is written into `attemptedAt` by the code path that PERFORMS the read, in
 * the same run, which is the declared reading-path carve-out of RULING 107 and
 * not a restamp.
 *
 * @freshness-reads-here
 */

function subjectOf(c: Candidacy): string {
  return `${c.givenName} ${c.familyName}`.replace(/\s+/g, " ").trim();
}

/** The filed name, cleaned of parenthetical and quoted nicknames for form-building. */
function filedName(c: Candidacy): string {
  return `${c.givenName} ${c.familyName}`
    .replace(/,\s*(JR|SR|II|III|IV|V)\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Links a page carries that could be somebody's campaign site.
 *
 * Excluded by host: the publisher itself, the social platforms (a social page
 * is the campaign-site rule's OTHER door and is not decided here), the
 * fundraising processors, and the platform furniture. A processor link is not a
 * campaign site — it is a payment page — and promoting one would put a donate
 * form under a reader-facing "campaign site" label.
 */
const NOT_A_CAMPAIGN_SITE =
  /(?:facebook|instagram|twitter|x\.com|bsky\.app|threads\.net|linkedin|youtube|tiktok|actblue|winred|secure\.anedot|donorbox|transaxt|everyaction|ngpvan|mobilize|eventbrite|google\.com|goo\.gl|docs\.google|forms\.gle|outlook\.|wix\.com|parastorage|wixstatic|wp\.com|gravatar|cloudfront\.net|paypal|venmo|stripe|squarespace-cdn|apple\.com|spotify)/i;

/**
 * Hosts that are never anybody's campaign site, however well a page reads.
 *
 * **Found by running the route rather than by imagining it**, which is why this
 * is separate from the pattern above. The first walk promoted one WordPress
 * shortlink as the campaign site of THREE different people: a shortlink
 * redirects to a post that names them and carries office evidence, so it
 * cleared the control and the self-identification bar honestly, and both bars
 * were working exactly as written.
 *
 * Three classes, each failing for its own reason:
 *
 * - **Shorteners and click-trackers.** The bytes at the URL are somebody else's
 *   post reached through a redirect. A campaign site is a place, not a hop.
 * - **Blogging and list platforms at their own apex** — a login page is not a
 *   candidate.
 * - **Government hosts.** A `.gov` page about an election is the state doing its
 *   job. It may be somebody's VERIFIED PAGE; it is never their campaign site,
 *   and the two fields are not interchangeable.
 */
const NEVER_A_CAMPAIGN_SITE_HOST = new RegExp(
  [
    String.raw`(?:^|\.)(?:wp\.me|bit\.ly|tinyurl\.com|t\.co|lnkd\.in|ow\.ly|buff\.ly|rb\.gy`,
    String.raw`|mailchi\.mp|sendibt\d*\.com|list-manage\.com|constantcontact\.com`,
    String.raw`|campaign-archive\.com|wordpress\.com|blogspot\.com|medium\.com`,
    String.raw`|substack\.com|linktr\.ee|smore\.com|paperturn-view\.com)$`,
    String.raw`|\.gov$|(?:^|\.)nj\.us$|\.mil$`,
  ].join(""),
  "i",
);

function externalLinks(html: string, pageUrl: string): { page: string; site: string }[] {
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  /* Keyed on the SITE, so one slate site linked twice is one lead — and the
   * page kept with it is the one that will be read for evidence. */
  const out = new Map<string, string>();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const raw = m[1];
    if (!/^https?:\/\//i.test(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const h = u.hostname.replace(/^www\./, "");
    if (h === host) continue;
    if (NOT_A_CAMPAIGN_SITE.test(h)) continue;
    if (NEVER_A_CAMPAIGN_SITE_HOST.test(h)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|xml|webp)$/i.test(u.pathname)) continue;
    const site = `${u.protocol}//${u.hostname}`;
    const page = `${u.protocol}//${u.hostname}${u.pathname}`.replace(/\/$/, "") || site;
    /* A DEEPER page wins: it is likelier to carry the name and the office than
     * an apex that is a slideshow. The apex is still what the reader is shown. */
    const held = out.get(site);
    if (held === undefined || page.length > held.length) out.set(site, page);
  }
  return [...out.entries()].map(([site, page]) => ({ site, page }));
}

/* --------------------------------------------------------------- routes */

const ROUTES: Route[] = [
  {
    id: "party-municipal-committee",
    tier: "A",
    publisher: "the Morris County Democratic Committee",
    about: "the municipal Democratic committees, and the candidates they run",
    symmetricWith: "party-county-gop",
    async pages(ctx) {
      /*
       * RULING 93, applied to a PARTY hierarchy rather than a government one.
       * The county committee publishes an index of its municipal committees;
       * each municipal committee publishes its own town's slate. Descending
       * that index reaches every town in one walk, where guessing sideways at
       * town-by-town domains reaches none of them reliably.
       *
       * The index is read through the site's own REST API (ladder rung 7) —
       * the JSON feeding the page, which carries the rendered HTML of all 85
       * pages in one request instead of 85.
       */
      const found: { url: string; publisher: string }[] = [
        { url: "https://morrisdems.org/", publisher: "the Morris County Democratic Committee" },
      ];
      const index = await ctx.get(
        "https://morrisdems.org/wp-json/wp/v2/pages?per_page=100&_fields=id,link,title,content",
        "the Morris County Democratic Committee",
      );
      if (!index.ok) return found;
      let pages: { link: string; content?: { rendered?: string } }[];
      try {
        pages = JSON.parse(index.text);
      } catch {
        return found;
      }
      const hosts = new Set<string>();
      for (const p of pages) {
        const html = p.content?.rendered ?? "";
        for (const link of externalLinks(html, p.link)) {
          const h = new URL(link.site).hostname.replace(/^www\./, "");
          /* Government and clerk hosts are a different route's business. */
          if (/\.gov$|\.us$|morriscountyclerk|njelec/i.test(h)) continue;
          if (hosts.has(h)) continue;
          hosts.add(h);
          found.push({ url: `https://${h}/`, publisher: `a municipal Democratic committee (${h})` });
        }
      }
      return found;
    },
  },
  {
    id: "party-county-gop",
    tier: "A",
    publisher: "the Morris County Republican Committee",
    about: "the Republican candidates and clubs of Morris County",
    symmetricWith: "party-municipal-committee",
    async pages(ctx) {
      /*
       * The same descent, and it does NOT find the same thing — stated rather
       * than smoothed. The county Republican committee publishes no municipal
       * committee index; what it publishes is a page sitemap. So the sitemap is
       * the index, every page in it is walked, and the difference between the
       * two parties' routes is a difference in what the two publishers publish,
       * not in the effort spent on them.
       */
      const found: { url: string; publisher: string }[] = [];
      const map = await ctx.get(
        "https://www.morrisgop.org/pages-sitemap.xml",
        "the Morris County Republican Committee",
      );
      if (map.ok) {
        for (const m of map.text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          found.push({ url: m[1], publisher: "the Morris County Republican Committee" });
        }
      }
      if (found.length === 0) {
        found.push({
          url: "https://www.morrisgop.org/",
          publisher: "the Morris County Republican Committee",
        });
      }
      return found;
    },
  },
  {
    id: "press-outlet-wp-search",
    tier: "A",
    publisher: "the local and statewide press that covers these races",
    about: "every candidate on this ballot, one surname at a time",
    async pages(ctx) {
      /*
       * **THE PUBLISHER'S OWN SEARCH, WHICH IS NOT A SEARCH ENGINE.**
       *
       * Conceived on 2026-08-24 after measuring that every general web index
       * this project is PERMITTED to walk is walled: `html.duckduckgo.com` and
       * `lite.duckduckgo.com` publish `Allow: /` and answer HTTP 202 with a
       * challenge page at rungs 2 and 3, and rung 6 renders
       * *"Unfortunately, bots use DuckDuckGo too."* Mojeek, Brave, Ecosia,
       * Startpage and Bing all `Disallow: /search`, so they are not walked at
       * any rung — `CLAUDE.md` says a robots disallow gets a COMPLIANT ROUTE to
       * the same information rather than a cleverer client.
       *
       * This is that compliant route. Both outlets run WordPress and publish
       * `/wp-json/wp/v2/search`, which is the site's own documented interface —
       * ladder rung 7, the page's own network calls, and rung 12, the vendor
       * platform underneath. It is asked one SURNAME at a time, which is a
       * broad question rather than a per-person one: a surname query returns
       * every article about anyone of that name, and the articles are then
       * mined for all 272 at once.
       *
       * The control is clean and was measured before this was written: a
       * deliberately impossible term returns `[]` on both hosts, so a real
       * answer is distinguishable from the host talking about itself.
       */
      const outlets = [
        { host: "newjerseyglobe.com", who: "the New Jersey Globe" },
        { host: "morristowngreen.com", who: "Morristown Green" },
      ];
      const surnames = new Map<string, string>();
      for (const c of ctx.candidacies) {
        const s = c.familyName
          .replace(/,\s*(JR|SR|II|III|IV|V)\.?/gi, "")
          .replace(/[^A-Za-z' -]/g, "")
          .trim();
        if (s.length >= 4) surnames.set(s.toLowerCase(), s);
      }
      console.log(`  ${surnames.size} distinct surname(s) to ask ${outlets.length} outlet(s)`);

      const articles = new Map<string, string>();
      for (const [, surname] of surnames) {
        for (const o of outlets) {
          const q = `https://${o.host}/wp-json/wp/v2/search?search=${encodeURIComponent(surname)}&per_page=20`;
          const res = await ctx.get(q, `${o.who}, its own search API`);
          if (!res.ok) continue;
          let hits: { url?: string }[];
          try {
            hits = JSON.parse(res.text);
          } catch {
            continue;
          }
          for (const h of hits) {
            if (h.url && !articles.has(h.url)) articles.set(h.url, o.who);
          }
        }
      }
      console.log(`  ${articles.size} distinct article(s) named by those searches`);
      return [...articles.entries()].map(([url, who]) => ({ url, publisher: who }));
    },
  },
  {
    id: "party-committee-domain-shape",
    tier: "A",
    publisher: "the municipal party committees of Morris County, both parties",
    about: "the candidates each municipal committee runs",
    async pages() {
      /*
       * **RULING 52 — a branch that fails is one measurement, and the fact gets
       * another branch. RULING 60 — a branch proven in one place is proven for
       * that SHAPE.**
       *
       * The Democratic county committee publishes an index of its municipal
       * committees; the Republican county committee publishes no such index.
       * That is an asymmetry in what the two PUBLISHERS publish, and if the
       * hunt stopped there it would become an asymmetry in what this product
       * knows — which is precisely the information asymmetry the equal-effort
       * rule exists to catch, arriving through the front door.
       *
       * So the shape the index revealed is applied to both parties equally:
       * every municipality gets the SAME number of guesses per party, drawn
       * from the same pattern list. The Democratic committee domains this
       * pattern set was learned from are what makes it a shape rather than an
       * invention — `mendhamtwpdems.com`, `roxburydems.org`, `mpdems.org`,
       * `montvillenjdems.org`, `wtdcnj.org` are five different arrangements of
       * the same idea.
       *
       * Every URL here is GUESSED, so nothing from this route can rise above a
       * LEAD on the probe alone (RULING 68); it is the page's own words that
       * decide, exactly as everywhere else.
       */
      const file = join(OUT_DIR, "muni-sites-nj-morris.json");
      const munis: string[] = existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as { sites: { municipality: string }[] }).sites.map(
            (s) => s.municipality,
          )
        : [];
      const out: { url: string; publisher: string }[] = [];
      for (const m of munis) {
        const bare = m.replace(/_(township|borough|town|twp)$/, "");
        const slug = bare.replace(/_/g, "");
        const withTwp = m.replace(/_township$/, "twp").replace(/_/g, "");
        for (const [party, suffixes] of [
          ["Democratic", ["dems.org", "dems.com", "democrats.org", "democrats.com", "njdems.org"]],
          ["Republican", ["gop.org", "gop.com", "republicans.org", "republicans.com", "njgop.org"]],
        ] as const) {
          for (const base of new Set([slug, withTwp])) {
            for (const suffix of suffixes) {
              out.push({
                url: `https://${base}${suffix}/`,
                publisher: `a guessed ${party} municipal committee domain for ${m}`,
              });
            }
          }
        }
      }
      return out;
    },
  },
  {
    id: "municipal-government",
    tier: "A",
    publisher: "each Morris County municipality",
    about: "the sitting officials of that municipality",
    async pages() {
      const file = join(OUT_DIR, "nj-morris-municipal-sites.json");
      if (!existsSync(file)) return [];
      const d = JSON.parse(readFileSync(file, "utf8")) as {
        sites: { municipality: string; url: string }[];
      };
      return d.sites.map((s) => ({ url: s.url, publisher: `the ${s.municipality} municipal website` }));
    },
  },
];

/* ------------------------------------------------------------------ main */

const args = process.argv.slice(2);
if (args.includes("--routes")) {
  for (const r of ROUTES) {
    console.log(`  ${r.tier}  ${r.id.padEnd(28)} ${r.publisher} — about ${r.about}`);
  }
  process.exit(0);
}

const wanted = args.filter((a) => a.startsWith("--route=")).map((a) => a.slice("--route=".length));
if (wanted.length === 0) {
  console.error("hunt:sites · name at least one --route=<id>, or --routes to list them.");
  process.exit(2);
}

/* Symmetry, enforced before anything is fetched. */
for (const id of wanted) {
  const route = ROUTES.find((r) => r.id === id);
  if (!route) {
    console.error(`hunt:sites · no route "${id}". Run --routes.`);
    process.exit(2);
  }
  if (route.symmetricWith && !wanted.includes(route.symmetricWith)) {
    console.error(
      `hunt:sites · REFUSED. "${id}" is symmetric with "${route.symmetricWith}" and both are walked ` +
        "or neither is. A party-hosted route walked for one party and not the other is the " +
        "equal-effort rule failing in the place it was written for.",
    );
    process.exit(2);
  }
}

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8")) as {
  contests: Contest[];
  candidacies: Candidacy[];
};
const contests = new Map(ballot.contests.map((c) => [c.id, c]));
const stamp = today();

const fetched = new Map<string, SourcePage>();

/**
 * A read-through disk cache, so re-running a route costs nothing at the origin.
 *
 * Not a nicety. This route asks two newspapers 516 questions; re-walking it to
 * fix a bug in OUR code would be 516 more requests at somebody else's expense,
 * and the public-records rule says never request at a rate that degrades
 * service. A cached page is also what makes a diff-able re-run possible: the
 * same bytes, a different verdict, and the difference is ours.
 *
 * `--fresh` bypasses it, because a cache nobody can turn off eventually serves
 * a session a page the publisher has since changed.
 */
const CACHE_DIR = join(ROOT, ".hunt-tmp", "cache");
const FRESH = process.argv.includes("--fresh");

function cachePath(url: string): string {
  return join(CACHE_DIR, `${createHash("sha256").update(url).digest("hex").slice(0, 32)}.json`);
}

async function get(url: string, publisher: string): Promise<SourcePage> {
  const cached = fetched.get(url);
  if (cached) return cached;
  if (!FRESH) {
    const file = cachePath(url);
    if (existsSync(file)) {
      try {
        const disk = JSON.parse(readFileSync(file, "utf8")) as SourcePage;
        fetched.set(url, { ...disk, publisher });
        return fetched.get(url)!;
      } catch {
        /* a corrupt cache entry is not a document — fall through and fetch */
      }
    }
  }
  await sleep(SPACING_MS);
  let page: SourcePage;
  try {
    const res = await fetch(url, {
      headers: { ...browserProfileHeaders(), "User-Agent": sourceUserAgent() },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    page = {
      url,
      publisher,
      status: res.status,
      bytes: text.length,
      text,
      ok: res.ok && text.length > 0,
      note: res.ok ? undefined : `HTTP ${res.status} — a wall, never an absence`,
    };
  } catch (e) {
    /*
     * **RUNG 4 — a different CLIENT whose TLS fingerprint passes.**
     *
     * Not a retry. Node's `fetch` refused five municipal committee sites on the
     * first walk with a bare `fetch failed`, and a bare `fetch failed` is a
     * TRANSPORT verdict about our client, never a fact about the host. `curl`
     * negotiates a different TLS handshake and beat the same wall in the f
     * session, which is why rung 4 exists at all.
     *
     * A rung that fails is recorded as a rung that failed, with both clients
     * named, so the next session does not re-derive which one was tried.
     */
    const node = `node fetch refused: ${(e as Error).message.split("\n")[0].slice(0, 90)}`;
    const viaCurl = curlRead(url);
    page = viaCurl
      ? {
          url,
          publisher,
          status: viaCurl.status,
          bytes: viaCurl.text.length,
          text: viaCurl.text,
          ok: viaCurl.status >= 200 && viaCurl.status < 400 && viaCurl.text.length > 0,
          note: `${node}; RUNG 4 (curl) answered HTTP ${viaCurl.status}`,
        }
      : await afterCurl(url, publisher, node);
  }
  fetched.set(url, page);
  /* Only a page that ANSWERED is cached. Caching a refusal would freeze a wall
   * into a fact, which is the one thing this project never records. */
  if (page.ok) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(url), JSON.stringify(page));
  }
  return page;
}

/**
 * **RUNG 11 — the Internet Archive, when the host itself is gone.**
 *
 * Two of the municipal committee sites the county party links do not resolve at
 * all: `NXDOMAIN`, not a wall. A domain that has expired is the one case where
 * no amount of client-swapping helps, and it is also the case where the archive
 * is strongest — the committee's own page about its own candidates is still
 * there, dated.
 *
 * A capture is NOT the live web and the difference is recorded on the row: the
 * note names the archive and the capture timestamp, so nothing downstream can
 * mistake a 2023 snapshot for what the committee publishes today.
 */
async function afterCurl(url: string, publisher: string, node: string): Promise<SourcePage> {
  /* Rung 2 again, over plain http — a TLS handshake failure is about TLS. */
  if (url.startsWith("https://")) {
    const plain = curlRead(url.replace(/^https:/, "http:"));
    if (plain && plain.status >= 200 && plain.status < 400 && plain.text.length > 0) {
      return {
        url,
        publisher,
        status: plain.status,
        bytes: plain.text.length,
        text: plain.text,
        ok: true,
        note: `${node}; rung 4 (curl) refused over https; PLAIN HTTP answered ${plain.status}`,
      };
    }
  }

  try {
    const host = new URL(url).hostname;
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(host)}`;
    const res = await fetch(api, {
      headers: { "User-Agent": sourceUserAgent() },
      signal: AbortSignal.timeout(30_000),
    });
    const j = (await res.json()) as {
      archived_snapshots?: { closest?: { url?: string; timestamp?: string; available?: boolean } };
    };
    const snap = j.archived_snapshots?.closest;
    if (!snap?.available || !snap.url) {
      return {
        url,
        publisher,
        status: 0,
        bytes: 0,
        text: "",
        ok: false,
        note: `${node}; rung 4 (curl) refused; rung 11 (Internet Archive) holds no capture of ${host}`,
      };
    }
    const cap = curlRead(snap.url);
    if (!cap || cap.text.length === 0) {
      return {
        url,
        publisher,
        status: 0,
        bytes: 0,
        text: "",
        ok: false,
        note: `${node}; rung 11 named a capture at ${snap.timestamp} and it could not be read`,
      };
    }
    return {
      url,
      publisher,
      status: cap.status,
      bytes: cap.text.length,
      text: cap.text,
      ok: true,
      note:
        `${node}; rung 4 (curl) refused; RUNG 11 — read from the Internet Archive, capture ` +
        `${snap.timestamp}. This is an ARCHIVED page, not what the publisher serves today.`,
    };
  } catch (e) {
    return {
      url,
      publisher,
      status: 0,
      bytes: 0,
      text: "",
      ok: false,
      note: `${node}; rung 4 (curl) refused; rung 11 threw: ${(e as Error).message.slice(0, 70)}`,
    };
  }
}

/** Rung 4: the same request through a client with a different TLS fingerprint. */
function curlRead(url: string): { status: number; text: string } | null {
  try {
    const out = spawnSync(
      "curl",
      [
        "-s",
        "-L",
        "--max-time",
        "30",
        "-A",
        sourceUserAgent(),
        "-w",
        "\n%{http_code}",
        url,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (out.status !== 0 || !out.stdout) return null;
    const nl = out.stdout.lastIndexOf("\n");
    const status = Number(out.stdout.slice(nl + 1).trim());
    if (!Number.isFinite(status) || status === 0) return null;
    return { status, text: out.stdout.slice(0, nl) };
  } catch {
    return null;
  }
}

const ctx: Ctx = { candidacies: ballot.candidacies, contests, get, today: stamp };

console.log(`hunt:sites · ${wanted.length} route(s) · ${ballot.candidacies.length} candidacies\n`);

const allLeads: Lead[] = [];
const routeReports: Record<string, unknown>[] = [];

for (const id of wanted) {
  const route = ROUTES.find((r) => r.id === id)!;
  console.log(`ROUTE ${route.id}  (Tier ${route.tier}) — ${route.publisher}`);

  const all = await route.pages(ctx);
  /*
   * **A STATED CLIP, NEVER A SILENT ONE — RULING 129 and the two-numbers rule.**
   *
   * The press route's 258 surname searches named **4,056 distinct articles**,
   * which at a polite request rate is several hours. `--max-pages=N` bounds a
   * run, and when it bites BOTH numbers are printed and the artifact carries
   * them. A cap reached while the source still offers more is a boundary this
   * run stopped at, not the end of the data, and the difference has to be
   * readable in the output rather than inferable from it.
   *
   * Pages already in the disk cache are FREE and are never counted against the
   * cap: the cap exists to bound requests to somebody else's server, and a
   * cached page makes none.
   */
  const cap = Number((process.argv.find((a) => a.startsWith("--max-pages=")) ?? "").slice("--max-pages=".length));
  let targets = all;
  let clipped = 0;
  if (Number.isFinite(cap) && cap > 0) {
    const free = all.filter((t) => existsSync(cachePath(t.url)));
    const costly = all.filter((t) => !existsSync(cachePath(t.url)));
    targets = [...free, ...costly.slice(0, cap)];
    clipped = costly.length - Math.min(cap, costly.length);
  }
  console.log(
    `  source pages to harvest: ${targets.length} of ${all.length}` +
      (clipped > 0
        ? `  — CLIPPED: ${clipped} page(s) not fetched this run because --max-pages=${cap} bounded it. ` +
          "The source still offers them."
        : ""),
  );

  let harvested = 0;
  let refused = 0;
  const pages: SourcePage[] = [];
  for (const t of targets) {
    const p = await get(t.url, t.publisher);
    if (p.ok) {
      harvested += 1;
      pages.push(p);
    } else {
      refused += 1;
    }
  }
  const harvest = conserve(`hunt:sites/${route.id}/harvest`, {
    logicalInput: targets.length,
    produced: harvested,
    dropped: refused,
    outOfWindow: 0,
    duplicates: 0,
    unretrieved: 0,
  });
  console.log(`  harvest: ${harvested} read, ${refused} refused, of ${targets.length}`);

  /* MINE — every candidate against every harvested page. */
  let mined = 0;
  let pagesWithNoName = 0;
  const routeLeads: Lead[] = [];
  for (const p of pages) {
    const flat = flattenForEvidence(p.text);
    const links = externalLinks(p.text, p.url);
    let namedHere = 0;
    for (const c of ballot.candidacies) {
      const forms = matchNameForms(filedName(c), flat);
      const strong = forms.some((f) => f.matched && f.kind !== "surname");
      if (!strong) continue;
      namedHere += 1;
      /*
       * The page NAMES this person. Two things follow, and they are different
       * claims: the page itself is a candidate for their VERIFIED PAGE, and
       * every external link on it is a candidate for their CAMPAIGN SITE.
       *
       * Only the second is mined here. A page naming twelve people cannot
       * attribute its twelve outbound links to the right one by proximity
       * alone, so every link is carried as a LEAD against every named person
       * and the PROVE phase decides — which is what the control and the
       * self-identification bar are for.
       */
      for (const link of links) {
        routeLeads.push({
          candidacyId: c.id,
          subject: subjectOf(c),
          contestTitle: contests.get(c.contestId)?.title ?? "",
          foundOn: p.url,
          foundOnPublisher: p.publisher,
          url: link.page,
          siteUrl: link.site,
          guessed: false,
        });
        mined += 1;
      }
    }
    if (namedHere === 0) pagesWithNoName += 1;
  }
  console.log(
    `  mine: ${mined} lead(s) from ${pages.length - pagesWithNoName} page(s) that named somebody; ` +
      `${pagesWithNoName} page(s) named nobody on this ballot`,
  );

  /*
   * **THE PAGE TEXT IS DROPPED THE MOMENT MINING IS DONE WITH IT.**
   *
   * The press route harvests 668 articles and the run held every one of their
   * bodies in memory for the whole run, on top of every probe body. It died
   * with V8's heap-limit allocation failure partway through the prove phase.
   *
   * Nothing downstream reads a SOURCE page again — the leads carry the URL and
   * the publisher, and PROVE fetches the lead itself. So the text goes, and the
   * disk cache means a later run does not re-request a single page for it.
   */
  for (const p of pages) {
    p.text = "";
    fetched.delete(p.url);
  }

  allLeads.push(...routeLeads);
  routeReports.push({
    route: route.id,
    tier: route.tier,
    publisher: route.publisher,
    about: route.about,
    symmetricWith: route.symmetricWith ?? null,
    walkedAt: stamp,
    harvest: {
      sourcePagesOffered: all.length,
      sourcePagesAttempted: targets.length,
      clippedByMaxPages: clipped,
      read: harvested,
      refused,
      outcome: harvest.outcome,
      accountedFor: harvest.accountedFor,
      refusedPages: targets
        .filter((t) => !fetched.get(t.url)?.ok)
        .map((t) => ({ url: t.url, note: fetched.get(t.url)?.note ?? "not attempted" })),
    },
    mine: {
      leads: mined,
      pagesNamingSomebody: pages.length - pagesWithNoName,
      pagesNamingNobody: pagesWithNoName,
    },
  });
}

/* PROVE — one fetch per DISTINCT url, however many candidates it leads from. */
const distinct = [...new Set(allLeads.map((l) => l.url))];
console.log(`\nPROVE · ${distinct.length} distinct URL(s) from ${allLeads.length} lead(s)`);

const bodies = new Map<string, string>();

/*
 * **ONE FETCH PER URL, NOT ONE PER LEAD.**
 *
 * `ControlledProbe` caches the CONTROL by hostname and nothing else, which is
 * right for its job and wrong for this loop: the press route produced **1,502
 * leads over 229 distinct URLs**, because one article naming six candidates
 * yields six leads at the same address. Fetching per lead would have asked
 * those 229 hosts 1,502 times for the same pages.
 *
 * That is not a speed problem, it is the public-records rule — never request at
 * a rate that degrades service — and it was found by watching the run rather
 * than by reading the code.
 */
const probed = new Map<string, { status: number; length: number }>();
const probe = new ControlledProbe(async (url) => {
  const seen = probed.get(url);
  if (seen) return seen;
  /* The same read-through disk cache the harvest uses. Fixing OUR classifier
   * must not cost 249 hosts a second round of requests. */
  if (!FRESH) {
    const file = cachePath(`probe:${url}`);
    if (existsSync(file)) {
      try {
        const disk = JSON.parse(readFileSync(file, "utf8")) as { status: number; text: string };
        bodies.set(url, disk.text);
        const hit = { status: disk.status, length: disk.text.length };
        probed.set(url, hit);
        return hit;
      } catch {
        /* a corrupt entry is not a document — fall through and fetch */
      }
    }
  }
  await sleep(SPACING_MS);
  let result: { status: number; length: number };
  try {
    const res = await fetch(url, {
      headers: { ...browserProfileHeaders(), "User-Agent": sourceUserAgent() },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    bodies.set(url, text);
    result = { status: res.status, length: text.length };
  } catch {
    result = { status: 0, length: 0 };
  }
  probed.set(url, result);
  if (result.status > 0) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(`probe:${url}`), JSON.stringify({ status: result.status, text: bodies.get(url) ?? "" }));
  }
  return result;
});

/**
 * **A PAGE ABOUT A CANDIDATE IS NOT A PAGE BY THE CANDIDATE.**
 * (Found by running the press route, 2026-08-24.)
 *
 * `verdictFor` asks the right question for a GENERIC lead: does this page name
 * the person and say it is about standing for office? A newspaper article
 * answers yes to both, honestly — *Bennett for Congress* is exactly the phrase
 * the office test looks for, and it appears in every story written about her.
 *
 * So the press route produced **33 rows clearing that bar, of which 31 were
 * news sites**: `govtrack.us`, `cnn.com`, `nypost.com`, `jewishinsider.com`,
 * `dailysabah.com`, `theintercept.com`. Every one of those is a true statement
 * about the page and a false claim about the field, and shipping any of them
 * under a reader-facing "campaign site" label would put a newspaper's byline
 * where a candidate's own words belong.
 *
 * This is RULING 136's frame: the WordPress shortlink was an EXAMPLE, and the
 * class is *a page that mentions somebody is not a page they publish*. A host
 * blocklist cannot close a class — there are more newspapers than anyone can
 * list — so the discriminator is positive rather than negative, and it is the
 * two things that are true of a campaign site and of almost nothing else:
 *
 * 1. **The HOST carries the candidate's name or their slate's.** `tomkean.com`,
 *    `analiliafornj.com`, `joehathawayforcongress.com`, `votemtarlington.com`.
 * 2. **The page carries the PAID-FOR-BY disclaimer.** It is a legal obligation
 *    on campaign material and no newspaper carries one about somebody else.
 *
 * Failing both does not make a page worthless — it makes it a `LEAD` with its
 * reason recorded, which is what a news article genuinely is for this field.
 */
function asCampaignSite(
  generic: { outcome: ProbeOutcome; detail: string },
  lead: Lead,
  forms: { form: string; kind: string; matched: boolean }[],
  body: string,
): { outcome: ProbeOutcome; detail: string } {
  if (generic.outcome !== "HIT") return generic;

  const host = (() => {
    try {
      return new URL(lead.siteUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();
  /* Letters only: `tomkean.com` has to match the form `tom kean`. */
  const hostLetters = host.replace(/[^a-z]/g, "");
  const named = forms.some((f) => {
    if (f.kind === "surname") return false;
    const squashed = f.form.replace(/[^a-z]/g, "");
    return squashed.length >= 6 && hostLetters.includes(squashed);
  });
  if (named) {
    return { outcome: "HIT", detail: `${generic.detail}; and the HOST itself carries the candidate's name` };
  }

  /*
   * **A GIVEN NAME PLUS A CAMPAIGN WORD IS A HOST SAYING WHOSE IT IS.**
   *
   * Tightening to full-name-in-host rejected `analiliafornj.com`, which IS
   * Analilia Mejia's campaign site and is already held and verified. The host
   * carries her GIVEN name and the office, not her surname — and that shape is
   * everywhere: `jerseyjustin4senate.com`, `veronicaforsenate.com`.
   *
   * A given name alone is far too weak, so it is required TOGETHER with a
   * campaign word in the host. The page has already cleared the control, the
   * name test and the office test to reach this line; this only decides whether
   * the host is the candidate's own place or somebody else's.
   *
   * Recorded rather than smoothed: the first version of this function traded a
   * false-positive class for a false-negative one, and a rejected true site is
   * a `LEAD` a human looks at — which is the correct direction to fail, and
   * still a failure worth naming.
   */
  const given = forms
    .find((f) => f.kind === "given-surname" || f.kind === "diminutive-surname")
    ?.form.split(" ")[0];
  if (given && given.length >= 5 && hostLetters.includes(given) && /(?:for|vote|elect|team)/.test(host)) {
    return {
      outcome: "HIT",
      detail: `${generic.detail}; and the HOST carries the candidate's given name beside a campaign word`,
    };
  }

  /*
   * **THE DISCLAIMER HAS TO NAME THIS CANDIDATE.**
   *
   * *Paid for by* alone was still too loose, and the run that proved it is
   * recorded here rather than smoothed: tightening to "host names them OR the
   * page carries a disclaimer" cut 33 rows to 10 and removed every newspaper —
   * and left `morrisdems.org` standing as Christopher Russo's campaign site and
   * `workingfamilies.org` as Analilia Mejia's. Both carry a real disclaimer.
   * Neither is a disclaimer about the CANDIDATE: *Paid for by the Morris County
   * Democratic Committee* is a committee identifying itself.
   *
   * So the surname must appear within a short window after the phrase. That is
   * what a candidate committee's disclaimer looks like — *Paid for by Kapner for
   * Mendham Township Committee* — and what a party's does not.
   */
  const flat = flattenForEvidence(body);
  const surname = forms.find((f) => f.kind === "surname")?.form;
  if (surname) {
    for (const m of flat.matchAll(/paid for by/gi)) {
      const window = flat.slice(m.index ?? 0, (m.index ?? 0) + 140);
      if (window.includes(surname)) {
        return {
          outcome: "HIT",
          detail:
            `${generic.detail}; and the page carries a paid-for-by disclaimer NAMING this candidate ` +
            `("${window.slice(0, 90).trim()}…"), which is their own campaign material`,
        };
      }
    }
  }

  return {
    outcome: "LEAD",
    detail:
      `the page names the candidate and is about the race, but the host (${host || "unreadable"}) does not ` +
      "carry their name and the page carries no paid-for-by disclaimer. A page ABOUT a candidate is not a " +
      "page BY the candidate — most often a news article, which is a real find for a different field.",
  };
}

const proven: Proven[] = [];
let hits = 0;
let leadsOut = 0;
let empties = 0;
let refusals = 0;

/**
 * The URL for one identifier on the lead's own host.
 *
 * **This function is the control, and getting it wrong made the control
 * meaningless in the first three runs of this route.** `ControlledProbe` calls
 * the SAME `make` twice — once with `CONTROL_IDENTIFIER`, once with the real
 * one — and compares the two answers. The first version here ignored its
 * argument and returned the lead URL both times, so the host was compared
 * against itself: every page came back `EMPTY` as "indistinguishable from this
 * host's own answer for a name that cannot exist", which it trivially was.
 *
 * Worse, `controlSize` caches by HOSTNAME, so the one page that did promote was
 * promoted by comparing against whichever path on that host happened to be
 * probed first. An order-dependent verdict about a named person is exactly what
 * RULING 68 exists to stop, arriving through the instrument built to enforce it.
 */
function onLeadHost(leadUrl: string): (identifier: string) => string {
  const origin = new URL(leadUrl).origin;
  return (identifier) => (identifier === leadUrl ? leadUrl : `${origin}/${identifier}`);
}

for (const lead of allLeads) {
  const r = await probe.probe(onLeadHost(lead.url), lead.url, { guessed: lead.guessed });
  const body = bodies.get(lead.url) ?? "";
  const flat = flattenForEvidence(body);
  const forms = matchNameForms(filedName(ballot.candidacies.find((c) => c.id === lead.candidacyId)!), flat);
  const office = officeEvidenceIn(flat);
  const generic = verdictFor(r.outcome, forms, office);
  const v = asCampaignSite(generic, lead, forms, body);
  if (v.outcome === "HIT") hits += 1;
  else if (v.outcome === "LEAD") leadsOut += 1;
  else if (v.outcome === "EMPTY") empties += 1;
  else refusals += 1;
  proven.push({
    ...lead,
    outcome: v.outcome,
    detail: v.detail,
    status: r.outcome === "REFUSED" ? 0 : 200,
    bytes: r.length,
    control: r.control,
    formsSearched: forms,
    officeEvidence: office,
    attemptedAt: stamp,
  });

  /*
   * **ONLY A HIT KEEPS ITS BODY.**
   *
   * Slate propagation re-reads a PROVEN site to see whether it names anybody
   * else in the contest, so those bodies have to survive the loop. The other
   * ~1,900 do not, and retaining them is what killed two runs with V8 heap-limit
   * allocation failures.
   *
   * The disk cache means dropping one costs nothing: a later run reads it back
   * without asking the host again.
   */
  if (v.outcome !== "HIT") bodies.delete(lead.url);
}

const proveAccount = conserve("hunt:sites/prove", {
  logicalInput: allLeads.length,
  produced: hits,
  dropped: leadsOut + empties + refusals,
  outOfWindow: 0,
  duplicates: 0,
  unretrieved: 0,
});

console.log(`  HIT ${hits} · LEAD ${leadsOut} · EMPTY ${empties} · REFUSED ${refusals}`);
console.log(`  conservation: ${proveAccount.outcome} — ${proveAccount.accountedFor} of ${allLeads.length}`);

/*
 * **SLATE PROPAGATION — the stuck protocol's third move, applied to a page we
 * already hold.** (Added 2026-08-24.)
 *
 * *What did entities of this same shape do? Test the SHAPE, not the instance.*
 * In New Jersey municipal races candidates run as a bracketed slate and the
 * slate has ONE website — `votemtarlington.com` carries `/meet-jay` and
 * `/meet-jess`, two people, one site.
 *
 * The mining pass can only reach the second person if the SOURCE page named
 * them too, which is an accident of how the county party wrote its post. So
 * every body that has already been fetched is re-read against ALL 272
 * candidates rather than only the one it was fetched for.
 *
 * **This costs no request.** The bytes are in memory. And the bar does not
 * move: `verdictFor` is the same function, the name must match in a form
 * stronger than the bare surname, and the page must still say it is about
 * standing for office. A slate site that does not name the second candidate
 * produces nothing, which is the correct outcome.
 */
const alreadyClaimed = new Set(proven.map((p) => `${p.candidacyId}|${p.siteUrl}`));
let propagated = 0;
for (const p of proven) {
  if (p.outcome !== "HIT") continue;
  const body = bodies.get(p.url) ?? "";
  if (!body) continue;
  const flat = flattenForEvidence(body);
  const office = officeEvidenceIn(flat);
  for (const c of ballot.candidacies) {
    if (c.id === p.candidacyId) continue;
    if (alreadyClaimed.has(`${c.id}|${p.siteUrl}`)) continue;
    const forms = matchNameForms(filedName(c), flat);
    const v = verdictFor("HIT", forms, office);
    if (v.outcome !== "HIT") continue;
    alreadyClaimed.add(`${c.id}|${p.siteUrl}`);
    propagated += 1;
    proven.push({
      ...p,
      candidacyId: c.id,
      subject: subjectOf(c),
      contestTitle: contests.get(c.contestId)?.title ?? "",
      formsSearched: forms,
      officeEvidence: office,
      outcome: "HIT",
      detail: `${v.detail} — reached by SLATE PROPAGATION from ${p.subject}'s proven site, same bytes, no new request`,
    });
  }
}
console.log(`  slate propagation: ${propagated} further candidacy(ies) named on a site already proven`);

const bySubject = new Map<string, Proven[]>();
for (const p of proven) {
  if (p.outcome !== "HIT") continue;
  if (!bySubject.has(p.candidacyId)) bySubject.set(p.candidacyId, []);
  bySubject.get(p.candidacyId)!.push(p);
}
console.log(`  distinct candidacies with a proven site: ${bySubject.size}\n`);
for (const [, rows] of bySubject) {
  console.log(`    ${rows[0].subject.padEnd(30)} ${[...new Set(rows.map((r) => r.siteUrl))].join(", ")}`);
}

mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, `nj-campaign-sites-${wanted.join("+")}.json`);
writeFileSync(
  outFile,
  `${JSON.stringify(
    {
      note:
        "The campaign-site hunt by BROAD route (RULING 84's tier order, RULING 90's meta-search). " +
        "Every row carries the page it was mined FROM, every name form searched whether it matched " +
        "or not (RULING 110), and the office evidence that decided HIT against LEAD (RULING 68). " +
        "A LEAD is never a find and never moves a field toward exhaustion. Written by " +
        "scripts/hunt-campaign-sites.mts.",
      walkedAt: stamp,
      routes: routeReports,
      prove: {
        leads: allLeads.length,
        distinctUrls: distinct.length,
        HIT: hits,
        LEAD: leadsOut,
        EMPTY: empties,
        REFUSED: refusals,
        outcome: proveAccount.outcome,
        accountedFor: proveAccount.accountedFor,
        distinctCandidaciesWithAProvenSite: bySubject.size,
      },
      rows: proven,
    },
    null,
    1,
  )}\n`,
);
console.log(`\nwrote ${outFile}`);
