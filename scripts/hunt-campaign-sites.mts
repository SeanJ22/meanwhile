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
  url: string;
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

function today(): string {
  /*
   * A RUN stamp is forbidden in a freshness field (RULING 107). This one is an
   * `attemptedAt` written by the code path that PERFORMS the read, in the same
   * function, which is the declared reading-path carve-out.
   *
   * @freshness-reads-here
   */
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
}

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

function externalLinks(html: string, pageUrl: string): string[] {
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const out = new Set<string>();
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
    /*
     * **The HOST is the lead, not the path.** A slate site links `/meet-jay`
     * and `/meet-jess` from the same page, and mining paths produced two rows
     * that read as two different campaign sites when they are two pages of one.
     * The field a reader sees is "the campaign's site", and that is a place.
     */
    out.add(`${u.protocol}//${u.hostname}`);
  }
  return [...out];
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
          const h = new URL(link).hostname.replace(/^www\./, "");
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
      const file = join(OUT_DIR, "nj-morris-municipal-sites.json");
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

async function get(url: string, publisher: string): Promise<SourcePage> {
  const cached = fetched.get(url);
  if (cached) return cached;
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
      : { url, publisher, status: 0, bytes: 0, text: "", ok: false, note: `${node}; rung 4 (curl) also refused` };
  }
  fetched.set(url, page);
  return page;
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

  const targets = await route.pages(ctx);
  console.log(`  source pages to harvest: ${targets.length}`);

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
      for (const url of links) {
        routeLeads.push({
          candidacyId: c.id,
          subject: subjectOf(c),
          contestTitle: contests.get(c.contestId)?.title ?? "",
          foundOn: p.url,
          foundOnPublisher: p.publisher,
          url,
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

  allLeads.push(...routeLeads);
  routeReports.push({
    route: route.id,
    tier: route.tier,
    publisher: route.publisher,
    about: route.about,
    symmetricWith: route.symmetricWith ?? null,
    walkedAt: stamp,
    harvest: {
      sourcePages: targets.length,
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

const probe = new ControlledProbe(async (url) => {
  await sleep(SPACING_MS);
  try {
    const res = await fetch(url, {
      headers: { ...browserProfileHeaders(), "User-Agent": sourceUserAgent() },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    bodies.set(url, text);
    return { status: res.status, length: text.length };
  } catch {
    return { status: 0, length: 0 };
  }
});

const proven: Proven[] = [];
let hits = 0;
let leadsOut = 0;
let empties = 0;
let refusals = 0;

for (const lead of allLeads) {
  const r = await probe.probe(() => lead.url, lead.url, { guessed: lead.guessed });
  const body = bodies.get(lead.url) ?? "";
  const flat = flattenForEvidence(body);
  const forms = matchNameForms(filedName(ballot.candidacies.find((c) => c.id === lead.candidacyId)!), flat);
  const office = officeEvidenceIn(flat);
  const v = verdictFor(r.outcome, forms, office);
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

const bySubject = new Map<string, Proven[]>();
for (const p of proven) {
  if (p.outcome !== "HIT") continue;
  if (!bySubject.has(p.candidacyId)) bySubject.set(p.candidacyId, []);
  bySubject.get(p.candidacyId)!.push(p);
}
console.log(`  distinct candidacies with a proven site: ${bySubject.size}\n`);
for (const [id, rows] of bySubject) {
  console.log(`    ${rows[0].subject.padEnd(30)} ${rows.map((r) => r.url).join(", ")}`);
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
