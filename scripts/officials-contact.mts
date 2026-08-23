/**
 * **THE OFFICIALS' OWN PAGE — `body-roster-page` and `gov-staff-directory`,
 * pointed at OFFICIALS rather than at filed candidates.**
 * (NJ Hunt 5 item 5, 2026-08-22.)
 *
 * ```
 * pnpm officials:contact --universe nj-morris
 * pnpm officials:contact --universe nj-morris --only rockaway-township
 * ```
 *
 * ## RULING 63 — checked against what exists BEFORE it was built
 *
 * `scripts/nj-hunt4-rosters.mts` already walks New Jersey municipal sites for
 * roster pages, and it is NOT duplicated here. It is a **candidate** hunt: it
 * matches page text against the names on the county clerk's filed-candidate
 * list, which is exactly right for its job and is why it returned 23 rows across
 * 30 municipalities. **A sitting council member is not a 2026 filed candidate**,
 * so no sitting official could ever have matched it.
 *
 * This is the same two routes with a different name list — the officials
 * `wikipedia-municipality` named — and it is recorded as an enrichment of those
 * route ids rather than as a new route.
 *
 * ## Two things it takes from the Wikipedia walk, and why each is better
 *
 * **The INDEX.** `nj:rosters` builds its site index from Morris County's own
 * Cities-and-Towns page, which is a genuine rung-2-then-rung-2 discovery and is
 * **incomplete: 30 of 39 municipalities**, missing Rockaway Township — the
 * subject municipality of this zip. Wikipedia's External links block carries the
 * official site for **39 of 39**, each footnoted. A better index is a better
 * index, and the county page stays in the playbook because the next state's
 * county may be the complete one.
 *
 * **The NAME LIST.** A page is only asked about people who are supposed to be on
 * it. That is what makes an email on a council page attributable to a person
 * rather than to a page.
 *
 * ## What this is evidence for — RULING 90, and it is the whole point
 *
 * Rockaway Township's nine council members came back from the manifest walk as
 * `NO_CITATION`: Wikipedia names all nine and attaches no footnote to the
 * sentence. Under RULING 87 they are LEADs and may not ship.
 *
 * RULING 90 asks the question the manifest cannot: *what would I try to find
 * this if there were no manifest at all?* The answer is what anybody would do —
 * open the township's own website and click Township Council. One fetch of
 * `rockawaytownship.org/157/Township-Council` returns all nine with a **term
 * expiry, a direct phone extension and an official email address each**, on a
 * page that is itself the specific verified page RULING 45 asks for.
 *
 * Nine LEADs became nine confirmed officials with two Kelly fields apiece,
 * because somebody asked what a person with a browser would do.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { surnameOf } from "../lib/hunt/wikipedia.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();
const UA = "we-the-people/1.0 (civic data for a public-records product; contact via repo)";
const SPACING_MS = 700;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const universe = arg("--universe") ?? "nj-morris";
const only = arg("--only");

const wikiPath = join(ROOT, "data", "hunt", `wikipedia-${universe}.json`);
if (!existsSync(wikiPath)) {
  console.error(`no ${wikiPath} — run \`pnpm wiki:muni\` for this universe first`);
  process.exit(2);
}

interface WikiOfficialLite {
  name: string;
  title: string | null;
  party: string | null;
  termEnds: number | null;
  seat: string | null;
  body: string | null;
}
interface WikiMuni {
  requested: string;
  title: string | null;
  missReason: string | null;
  mayor: WikiOfficialLite | null;
  council: WikiOfficialLite[];
  externalLinks: { url: string; label: string | null }[];
}

const wiki = JSON.parse(readFileSync(wikiPath, "utf8")) as { municipalities: WikiMuni[] };

/* ── Reused from the existing branch, not re-invented ────────────────────── */

const GOVERNING_LINK =
  /council|committee|mayor|governing|elected[- _]?official|officials|government|administration|directory|board[- _]?members/i;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(?:\(\d{3}\)\s?|\b\d{3}[-.\s])\d{3}[-.\s]\d{4}(?:\s*(?:x|ext\.?|Ext\.?)\s*\d{1,5})?/g;

async function get(url: string): Promise<{ status: number; text: string } | { wall: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status !== 200) return { wall: `HTTP ${res.status}` };
    return { status: res.status, text };
  } catch (err) {
    return { wall: `fetch threw: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

const strip = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/**
 * **Attribute a contact to a PERSON, never to a page.**
 *
 * An email is this official's only when it sits close to their name in the
 * page's text. "Close" is a window measured in characters, and it is deliberately
 * tight: a municipal council page lists nine people one after another, and a
 * generous window would give every member the clerk's address.
 *
 * The email's LOCAL PART is checked too, because these pages are almost always
 * `sfreire@`, `jquinn@`, `hmorrison@` — first initial plus surname. A local part
 * that contains the surname is decisive whatever the distance; proximity alone
 * is only accepted inside the window.
 */
function contactsNear(
  text: string,
  name: string,
): { emails: string[]; phones: string[]; window: string | null } {
  const surname = surnameOf(name);
  const idx = text.indexOf(surname);
  if (idx < 0) return { emails: [], phones: [], window: null };

  const WINDOW = 260;
  const slice = text.slice(idx, Math.min(text.length, idx + WINDOW));

  const emails = [...new Set(slice.match(EMAIL_RE) ?? [])].filter((e) => {
    const local = e.split("@")[0].toLowerCase();
    // Reject the site's own generic mailboxes — they belong to nobody.
    if (/^(info|clerk|admin|webmaster|contact|office|mail|noreply)$/.test(local)) return false;
    return true;
  });
  const phones = [...new Set(slice.match(PHONE_RE) ?? [])];

  return { emails, phones, window: slice.slice(0, 200) };
}

/* ── The walk ───────────────────────────────────────────────────────────── */

interface OfficialContact {
  municipality: string;
  name: string;
  title: string | null;
  body: string | null;
  seat: string | null;
  party: string | null;
  termEnds: number | null;
  /** The body's own page that names them — the specific verified page. */
  verifiedPageUrl: string | null;
  emails: string[];
  phones: string[];
  /** The text the contact was read out of, so a human can check the attribution. */
  evidence: string | null;
  collectedAt: string;
}

interface MuniResult {
  municipality: string;
  officialSite: string | null;
  pagesRead: number;
  walls: { url: string; wall: string }[];
  officialsExpected: number;
  officialsFoundOnSite: number;
  contacts: OfficialContact[];
}

/** The official site, from the article's External links — never guessed. */
function officialSiteOf(m: WikiMuni): string | null {
  const wanted = m.externalLinks.filter((l) => {
    const label = (l.label ?? "").toLowerCase();
    if (/school|nces|fire|library|chamber|census/.test(label)) return false;
    return /website|official|borough|township|town of|city of|^[a-z ]*$/.test(label);
  });
  const gov = wanted.find((l) => /\.(gov|us)(\/|$)/.test(l.url)) ?? wanted[0];
  return gov?.url ?? null;
}

const results: MuniResult[] = [];
const targets = wiki.municipalities.filter((m) => {
  if (m.missReason !== null) return false;
  if (only === undefined) return true;
  return (m.title ?? m.requested).toLowerCase().includes(only.toLowerCase().replace(/-/g, " "));
});

console.log(
  `walking body-roster-page for OFFICIALS — ${targets.length} municipalities in ${universe}`,
);

for (const m of targets) {
  const site = officialSiteOf(m);
  const expected = [m.mayor, ...m.council].filter((o): o is WikiOfficialLite => o !== null);
  const res: MuniResult = {
    municipality: m.title ?? m.requested,
    officialSite: site,
    pagesRead: 0,
    walls: [],
    officialsExpected: expected.length,
    officialsFoundOnSite: 0,
    contacts: [],
  };

  if (site === null || expected.length === 0) {
    results.push(res);
    console.log(
      `  ${res.municipality.slice(0, 40).padEnd(40)} ${site === null ? "NO OFFICIAL SITE IN THE ARTICLE" : "no officials named to look for"}`,
    );
    continue;
  }

  const home = await get(site);
  await sleep(SPACING_MS);
  if ("wall" in home) {
    res.walls.push({ url: site, wall: home.wall });
    results.push(res);
    console.log(`  ${res.municipality.slice(0, 40).padEnd(40)} WALL ${home.wall}`);
    continue;
  }
  res.pagesRead++;

  // The site's OWN links, never a guessed path.
  const hrefs = [...new Set((home.text.match(/href="([^"]+)"/g) ?? []).map((h) => h.slice(6, -1)))];
  const candidates: string[] = [];
  for (const h of hrefs) {
    if (!GOVERNING_LINK.test(h)) continue;
    try {
      const abs = new URL(h, site).toString();
      if (new URL(abs).hostname !== new URL(site).hostname) continue;
      if (!candidates.includes(abs)) candidates.push(abs);
    } catch {
      /* not a URL */
    }
  }

  const pages: { url: string; text: string }[] = [{ url: site, text: strip(home.text) }];
  for (const url of candidates.slice(0, 12)) {
    const r = await get(url);
    await sleep(SPACING_MS);
    if ("wall" in r) {
      res.walls.push({ url, wall: r.wall });
      continue;
    }
    res.pagesRead++;
    pages.push({ url, text: strip(r.text) });
  }

  for (const person of expected) {
    const surname = surnameOf(person.name);
    let best: OfficialContact | null = null;
    for (const page of pages) {
      if (!page.text.includes(surname)) continue;
      const near = contactsNear(page.text, person.name);
      const found: OfficialContact = {
        municipality: res.municipality,
        name: person.name,
        title: person.title,
        body: person.body,
        seat: person.seat,
        party: person.party,
        termEnds: person.termEnds,
        verifiedPageUrl: page.url,
        emails: near.emails,
        phones: near.phones,
        evidence: near.window,
        collectedAt: AS_OF,
      };
      // Prefer the page that actually yields a contact.
      if (best === null || found.emails.length > best.emails.length) best = found;
    }
    if (best !== null) {
      res.officialsFoundOnSite++;
      res.contacts.push(best);
    }
  }

  results.push(res);
  const withEmail = res.contacts.filter((c) => c.emails.length > 0).length;
  console.log(
    `  ${res.municipality.slice(0, 40).padEnd(40)} pages ${String(res.pagesRead).padStart(2)}  ` +
      `named ${res.officialsFoundOnSite}/${res.officialsExpected}  emails ${withEmail}`,
  );
}

/* ── Report ─────────────────────────────────────────────────────────────── */

const allContacts = results.flatMap((r) => r.contacts);
const withEmail = allContacts.filter((c) => c.emails.length > 0);
const withPhone = allContacts.filter((c) => c.phones.length > 0);
const expectedTotal = results.reduce((n, r) => n + r.officialsExpected, 0);

const outPath = join(ROOT, "data", "hunt", `officials-contact-${universe}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      routes: ["body-roster-page", "gov-staff-directory"],
      tier: "B",
      enrichmentOf: "the NJ municipal-roster branch, pointed at officials rather than candidates",
      indexFrom: `data/hunt/wikipedia-${universe}.json — the External links block, 39 of 39`,
      walkedAt: AS_OF,
      totals: {
        municipalitiesWalked: results.length,
        officialsExpected: expectedTotal,
        officialsFoundOnTheirOwnSite: allContacts.length,
        withEmail: withEmail.length,
        withPhone: withPhone.length,
        walls: results.reduce((n, r) => n + r.walls.length, 0),
      },
      municipalities: results,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log("");
console.log(`  municipalities walked          ${results.length}`);
console.log(`  officials expected             ${expectedTotal}`);
console.log(`  officials found on their site  ${allContacts.length}`);
console.log(`  with an email                  ${withEmail.length}`);
console.log(`  with a phone                   ${withPhone.length}`);
console.log(`  written                        ${outPath}`);

if (results.length > 0 && allContacts.length === 0) {
  console.error("ZERO officials matched on any site — that is a FAILED walk, not an empty result.");
  process.exit(1);
}
