/**
 * **THE MUNICIPAL ROSTER BRANCH FOR NEW JERSEY.** (NJ Hunt 4 item 5,
 * 2026-08-22. RULING 52, RULING 60, RULING 63.)
 *
 * ```
 * pnpm nj:rosters --index     # rebuild the municipal-site index from the county
 * pnpm nj:rosters             # walk every site and extract every roster row
 * pnpm nj:rosters --only rockaway
 * ```
 *
 * ## Why this exists, and why it is not `nh:roster`
 *
 * RULING 60: **a branch proven in one place is proven for that SHAPE.** New
 * Hampshire's branch goes through the General Court — one state body publishing
 * one member index for a whole chamber. New Jersey has no equivalent: municipal
 * government is 564 separate publishers, each on its own vendor, and there is no
 * state roster of who sits on a borough council. So the NH branch does not
 * travel here at all, and this is the sub-branch that does.
 *
 * It was checked against `docs/branch-manifest.md` BEFORE it was built (RULING
 * 63) — it is not a new route id. It is `body-roster-page` and
 * `gov-staff-directory`, made mechanical for New Jersey, plus the index step
 * below, which is what makes those two reachable without guessing 39 hostnames.
 *
 * ## The index step, and why it is a rung rather than a guess
 *
 * RULING 68 forbids a guessed identifier being read as a hit, and the first
 * attempt at this DID guess: `morriscountynj.gov/Residents/Municipalities`,
 * `/Government/Municipalities` and `/municipalities` all answered **404**.
 *
 * The county publishes the index, and the way to it was in the county home
 * page's own `href`s — `/Residents/Community-Information/Cities-and-Towns`,
 * carrying the official website of every municipality in Morris County. That is
 * ladder rung 2 followed by rung 2, and it is the difference between a route and
 * a hostname somebody remembered.
 *
 * ## What it extracts, and what it refuses to
 *
 * A roster page is read for NAMES, EMAILS, PHONES and PORTRAIT URLs, and every
 * one is reported with the URL it came off and the date. **Nothing here decides
 * anything.** Whether a portrait is a clean solo portrait of the filed
 * candidate, whether an email belongs to the person or to the office (RULING
 * 64), whether a page is the specific verified page for a candidacy — each is a
 * claim about a real person, and each stays with the session. This reports.
 *
 * ## Manners
 *
 * Serialized, spaced, identified, through the shared polite client. A 403 is
 * recorded as a wall on its rung with the host named (RULING 72) and the walk
 * continues to the next municipality — one town's WAF is never evidence about
 * another town.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { searchableGiven, searchableSurname } from "../lib/ballot/name-case.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";
const ROOT = process.cwd();
const AS_OF = today();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const INDEX_URL =
  "https://www.morriscountynj.gov/Residents/Community-Information/Cities-and-Towns";
const INDEX_PATH = join(ROOT, "data", "states", "nj", "hunt", "nj-morris-municipal-sites.json");
const OUT_PATH = arg("--out") ?? join(ROOT, "data", "states", "nj", "hunt", "nj-hunt4-rosters.json");
const only = arg("--only");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SiteIndex {
  builtAt: string;
  sourceUrl: string;
  sourceOrg: string;
  /** Municipality label as the county writes it, to the official site it links. */
  sites: { municipality: string; url: string }[];
}

/** Hosts the index page carries that are not a municipality's own site. */
const NOT_A_MUNICIPAL_SITE =
  /smart911|constantcontact|gstatic|facebook|twitter|instagram|youtube|linkedin|adobe|google|r20\.|nixle|swiftreach|readyop|govdelivery/i;

async function get(url: string): Promise<{ status: number; text: string } | { wall: string }> {
  try {
    const r = await politeGetText(url, {});
    return { status: r.status, text: r.text };
  } catch (e) {
    return { wall: (e as Error).message };
  }
}

/* ── the index ───────────────────────────────────────────────────────────── */

async function buildIndex(): Promise<SiteIndex> {
  const got = await get(INDEX_URL);
  if ("wall" in got) throw new Error(`the county index is walled: ${got.wall}`);
  const { text } = got;

  /*
   * The county writes each municipality as a heading followed by its links.
   * Rather than parse its layout — which is a vendor template that will change —
   * the host is matched back to the municipality by NAME, and a host that
   * matches no municipality is dropped and counted. A name join is normally
   * forbidden here; it is safe in this direction because the SET of
   * municipalities is known exactly from the ballot file, and an unmatched host
   * is discarded rather than attached to a guess.
   */
  const ballot = JSON.parse(
    readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8"),
  ) as { contests: { ocdId: string }[] };
  const municipalities = [
    ...new Set(
      ballot.contests
        .map((c) => /\/place:([a-z_]+)/.exec(c.ocdId)?.[1])
        .filter((s): s is string => Boolean(s)),
    ),
  ];

  const urls = [...new Set([...text.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))]
    .filter((u) => !NOT_A_MUNICIPAL_SITE.test(u))
    .filter((u) => !/morriscountynj\.gov/i.test(u));

  /*
   * **THE MATCH IS TYPE-AWARE, AND THE FIRST VERSION WAS NOT.**
   *
   * New Jersey puts a borough and a township of the SAME NAME in the same
   * county — Chester borough and Chester township, Mendham borough and Mendham
   * township, Boonton town and Boonton township, Rockaway borough and Rockaway
   * township. That is thirty of New Jersey's 564 municipalities, and it is
   * already why `subdivisionIdentity` slugs from `NAMELSAD` rather than `NAME`.
   *
   * A first version matched on the longest name a host contained, and produced
   * exactly the collapse the distinctness rule exists to catch: Boonton town's
   * site assigned to Boonton TOWNSHIP, Chatham borough's to Chatham TOWNSHIP,
   * Chester borough's to Chester TOWNSHIP. Four of twenty-four rows were the
   * wrong government, and the four it took the seats from read as having no
   * site at all.
   *
   * So both sides declare their TYPE and the types must agree:
   *
   * - the municipality's type comes from its OCD slug (`_township` / `_borough`
   *   / `_town`, or none for a flat place row);
   * - the host's type comes from the host string (`township`/`twp`,
   *   `borough`/`boro`, `town` where it is not part of `township`);
   * - a host that declares NO type may serve a municipality of any type, but
   *   only after every typed host has been assigned, and only if nothing else
   *   claims it.
   *
   * Assignment is global and greedy on the score, so a typed match always beats
   * an untyped one no matter what order the county's page lists them in.
   */
  /*
   * NO WORD BOUNDARIES — a hostname has no words in it.
   *
   * The first version used `\btown\b`, which matches nothing inside
   * `townofmorristown.org`, so Morristown's own site and Morris Township's
   * `morristwp.com` both came out UNTYPED and were assigned to each other's
   * government. Two wrong rows, and the give-away was that both were wrong in
   * the same swap. Substring, longest type first.
   */
  const typeOf = (text: string): "township" | "borough" | "town" | null =>
    /township|twp/.test(text)
      ? "township"
      : /borough|boro/.test(text)
        ? "borough"
        : /town/.test(text)
          ? "town"
          : null;

  const pairs: { municipality: string; url: string; score: number }[] = [];
  const seenHosts = new Set<string>();
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    const bare = host.replace(/[^a-z]/g, "");
    const hostType = typeOf(host);
    for (const m of municipalities) {
      const muniType = typeOf(m);
      const stem = m.replace(/_/g, "").replace(/township|borough|town$/g, "");
      if (stem.length < 4 || !bare.includes(stem)) continue;
      if (hostType && muniType && hostType !== muniType) continue;
      /*
       * A host with no type word cannot serve a TOWNSHIP while a borough of the
       * same name exists — `boonton.org` is Boonton town's site, not Boonton
       * township's, and the township publishes `boontontownship.com`.
       */
      const score = hostType && muniType && hostType === muniType ? 3 : hostType || muniType ? 1 : 2;
      pairs.push({ municipality: m, url: u.replace(/^http:/, "https:"), score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const sites: { municipality: string; url: string }[] = [];
  const claimed = new Set<string>();
  const takenUrls = new Set<string>();
  for (const pair of pairs) {
    if (claimed.has(pair.municipality) || takenUrls.has(pair.url)) continue;
    claimed.add(pair.municipality);
    takenUrls.add(pair.url);
    sites.push({ municipality: pair.municipality, url: pair.url });
  }
  const unmatched = seenHosts.size - takenUrls.size;

  console.log(
    `county index: ${urls.length} external link(s) read, ${sites.length} matched to a municipality, ` +
      `${unmatched} matched none and were dropped.`,
  );
  console.log(
    `  ${municipalities.length} municipalities appear in the ballot file; ` +
      `${municipalities.filter((m) => !claimed.has(m)).length} have no site from this index: ` +
      `${municipalities.filter((m) => !claimed.has(m)).join(", ") || "none"}`,
  );
  if (sites.length === 0) {
    throw new Error(
      "The county index yielded zero municipal sites. That is a FAILED read of the " +
        "index, not a county with no municipalities.",
    );
  }

  const index: SiteIndex = {
    builtAt: AS_OF,
    sourceUrl: INDEX_URL,
    sourceOrg: "Morris County, New Jersey",
    sites: sites.sort((a, b) => a.municipality.localeCompare(b.municipality)),
  };
  mkdirSync(dirname(INDEX_PATH), { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
  console.log(`written ${INDEX_PATH}`);
  return index;
}

/* ── the roster walk ─────────────────────────────────────────────────────── */

/** Link text and paths that name a governing body on a municipal site. */
const GOVERNING_LINK =
  /council|committee|mayor|governing|borough[- _]?board|township[- _]?board|elected[- _]?official|officials|government|administration|directory|board[- _]?of[- _]?education|school[- _]?board|board[- _]?members/i;

interface RosterRow {
  municipality: string;
  pageUrl: string;
  /** Names the page carries that match a filed candidate. */
  names: string[];
  emails: string[];
  phones: string[];
  images: string[];
}

interface WalkResult {
  municipality: string;
  siteUrl: string;
  pagesRead: number;
  walls: { url: string; wall: string }[];
  rows: RosterRow[];
}

const EMAIL = /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE = /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g;
const IMG = /<img[^>]+src="([^"]+)"/g;

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function walkMunicipality(
  municipality: string,
  siteUrl: string,
  filedNames: { given: string; family: string }[],
): Promise<WalkResult> {
  const result: WalkResult = {
    municipality,
    siteUrl,
    pagesRead: 0,
    walls: [],
    rows: [],
  };

  const home = await get(siteUrl);
  if ("wall" in home) {
    result.walls.push({ url: siteUrl, wall: home.wall });
    return result;
  }
  result.pagesRead++;

  /*
   * The site's OWN links, never a guessed path. A municipal site is on one of a
   * dozen vendors and every one of them uses a different URL shape; the one
   * thing they all do is link their governing body from the home page.
   */
  const links = [...new Set([...home.text.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,200}?)<\/a>/g)])]
    .filter(([, href, label]) => GOVERNING_LINK.test(href) || GOVERNING_LINK.test(label))
    .map(([, href]) => absolute(href, siteUrl))
    .filter((u): u is string => Boolean(u))
    .filter((u) => {
      try {
        return new URL(u).hostname === new URL(siteUrl).hostname;
      } catch {
        return false;
      }
    });

  const pages = [...new Set(links)].slice(0, 8);
  for (const url of pages) {
    await sleep(700);
    const got = await get(url);
    if ("wall" in got) {
      result.walls.push({ url, wall: got.wall });
      continue;
    }
    result.pagesRead++;
    const text = got.text;
    const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    const names = filedNames
      .filter((n) => {
        const fam = searchableSurname(n.family);
        const giv = searchableGiven(n.given);
        if (fam.length < 3) return false;
        const famRe = new RegExp(`\\b${fam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const givRe = new RegExp(`\\b${giv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return famRe.test(plain) && givRe.test(plain);
      })
      .map((n) => `${searchableGiven(n.given)} ${searchableSurname(n.family)}`);

    if (names.length === 0) continue;

    result.rows.push({
      municipality,
      pageUrl: url,
      names,
      emails: [...new Set([...text.matchAll(EMAIL)].map((m) => m[1].toLowerCase()))],
      phones: [...new Set(plain.match(PHONE) ?? [])],
      images: [...new Set([...text.matchAll(IMG)].map((m) => absolute(m[1], url)))].filter(
        (u): u is string => Boolean(u) && !/logo|banner|icon|seal|spacer|header|footer/i.test(u!),
      ),
    });
  }

  return result;
}

/* ── main ────────────────────────────────────────────────────────────────── */

const index: SiteIndex = process.argv.includes("--index")
  ? await buildIndex()
  : existsSync(INDEX_PATH)
    ? (JSON.parse(readFileSync(INDEX_PATH, "utf8")) as SiteIndex)
    : await buildIndex();

if (process.argv.includes("--index")) {
  /*
   * `process.exit` here raced libuv's teardown on Windows and aborted the
   * process AFTER the file was written — exit code 3221226505 on a run that had
   * succeeded. A script that reports failure on a successful run is the
   * operation-count rule pointed at the exit code.
   */
  process.exitCode = 0;
} else {

const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8"),
) as {
  contests: { id: string; ocdId: string }[];
  candidacies: { id: string; contestId: string; familyName: string; givenName: string }[];
};
const contestPlace = new Map(
  ballot.contests.map((c) => [c.id, /\/place:([a-z_]+)/.exec(c.ocdId)?.[1] ?? null]),
);

const results: WalkResult[] = [];
const sites = index.sites.filter((s) => !only || s.municipality.includes(only));
console.log(`\nwalking ${sites.length} municipal site(s), read ${AS_OF}\n`);

for (const site of sites) {
  /* Only the people actually filed in that municipality — a name join across
   * the whole county would match the wrong Smith. */
  const filed = ballot.candidacies
    .filter((c) => contestPlace.get(c.contestId) === site.municipality)
    .map((c) => ({ given: c.givenName, family: c.familyName }));
  const r = await walkMunicipality(site.municipality, site.url, filed);
  results.push(r);
  console.log(
    `  ${site.municipality.padEnd(34)} ${r.pagesRead} page(s) read · ` +
      `${r.rows.length} carrying a filed name · ${r.walls.length} wall(s)`,
  );
  for (const w of r.walls) console.log(`      WALL ${w.url} — ${w.wall.slice(0, 90)}`);
  await sleep(900);
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    { route: "body-roster-page", branch: "nj-municipal-roster", walkedAt: AS_OF, index: INDEX_URL, results },
    null,
    2,
  ),
  "utf8",
);

const pages = results.reduce((a, r) => a + r.pagesRead, 0);
const rows = results.reduce((a, r) => a + r.rows.length, 0);
const walls = results.reduce((a, r) => a + r.walls.length, 0);
const named = new Set(results.flatMap((r) => r.rows.flatMap((x) => x.names)));
console.log(
  `\n${sites.length} municipality/ies walked · ${pages} page(s) read · ${rows} page(s) carrying a ` +
    `filed candidate's name · ${named.size} distinct filed candidate(s) named · ${walls} wall(s).`,
);
if (pages === 0) {
  console.error("ZERO PAGES READ — that is a failed walk, not a county with no websites.");
  process.exit(1);
}
console.log(`written ${OUT_PATH}`);
}
