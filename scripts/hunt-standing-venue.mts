/**
 * **WHERE DOES THIS BOARD SAY IT MEETS?** (built 2026-08-21, NH Hunt 5 item 6;
 * RULING 60.)
 *
 * ```
 * pnpm venue:hunt                        # every body with no meeting source
 * pnpm venue:hunt --town sutton_town     # one division
 * pnpm venue:hunt --url <page>           # one page, for checking a find
 * ```
 *
 * ## The wall this climbs, and why it is not a wall
 *
 * A meeting with no venue is DROPPED. `lib/sources/ical/index.ts` says so in
 * its own words: an empty `LOCATION` falls through to the wiring row's
 * `venueMatch`, and with no `venueMatch` the row drops as `placeless` or
 * `unknownVenue`. That is the correct behaviour — a pin in the middle of New
 * Hampshire is a fabricated location, and pinning every board at the town
 * office because that is where boards usually meet is a guess about a specific
 * sitting dressed as a fact.
 *
 * The consequence, though, was that **Sutton's eighteen bodies had a live
 * calendar carrying 1,312 events and not one meeting in this product.** Every
 * event carried an empty `LOCATION`. NH Hunt 4 recorded that honestly and left
 * the venue hunt as a tracker row.
 *
 * The venue is not missing. It is in prose, on the board's own page, in the
 * board's own words:
 *
 *   "The Sutton Planning Board meets at the Pillsbury Memorial Hall, 93 Main
 *    Street, Sutton Mills, NH on the second Tuesday of the month at 7:00 pm."
 *
 * That is a SOURCED claim with a citation — the same standing on which the
 * Wilmot Selectboard's venue already ships. A calendar that omits the room is
 * not a body that meets nowhere; it is a feed that says nothing about where,
 * and the board's own page says it plainly.
 *
 * ## What this reports, and what it deliberately will not do
 *
 * It reports SENTENCES, with the URL and the rung that read them. It never
 * writes a wiring row, never writes a venue-cache entry, and never decides
 * that one board's published venue is another board's venue.
 *
 * That last refusal is the whole point. Of Sutton's boards, exactly ONE
 * publishes where it sits. Reading Pillsbury Memorial Hall off the Planning
 * Board's page and applying it to the Cemetery Commission would manufacture
 * seventeen sourced-looking claims from one source, and the citation would
 * point at a page that says nothing about the Cemetery Commission. A body
 * whose page states no venue is reported as STATES NO VENUE, which is a fact
 * about that page on that date and is the next hunt's starting point.
 */
import { readFileSync } from "node:fs";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const AS_OF = today();
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const ONE_URL = arg("url");
const TOWN = arg("town");

/**
 * The shapes a standing-venue sentence takes on a New Hampshire board page.
 *
 * Deliberately generous, and the false positives are left IN — the same
 * contract `pnpm bodies:enumerate` follows. A missed venue is invisible and
 * costs a body its whole calendar; a wrongly-included sentence is one line a
 * session reads and discards.
 */
const VENUE_PATTERNS = [
  /\bmeets?\s+(?:regularly\s+)?(?:at|in)\s+the\b/i,
  /\bmeetings?\s+(?:are|is)\s+(?:held|usually held)\b/i,
  /\bwill\s+meet\s+(?:at|in)\s+the\b/i,
  /\bmeeting\s+location\b/i,
  /\bconvenes?\s+(?:at|in)\b/i,
];

/** A sentence that names a building rather than merely a day. */
const BUILDING = /\b(hall|building|office|library|school|center|centre|station|house|room)\b/i;

interface Finding {
  body: string;
  ocdId: string | null;
  url: string;
  status: "STATES A VENUE" | "STATES NO VENUE" | "NOT READ";
  detail: string;
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#039;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function venueSentences(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (sentence.length > 400) continue;
    if (!VENUE_PATTERNS.some((p) => p.test(sentence))) continue;
    if (!BUILDING.test(sentence)) continue;
    out.push(sentence.trim());
  }
  return [...new Set(out)];
}

async function read(url: string): Promise<{ ok: boolean; text: string; note: string }> {
  try {
    const r = await politeGetText(url);
    return { ok: true, text: r.text, note: `HTTP ${r.status}, ${r.text.length} bytes` };
  } catch (error) {
    return { ok: false, text: "", note: (error as Error).message.split("\n")[0].slice(0, 150) };
  }
}

/**
 * THE BODY'S OWN PAGE, DERIVED FROM ITS SLUG.
 *
 * The first run of this instrument found all eighteen Sutton bodies sharing
 * ONE `homepageUrl` — the town's boards index — and that index answering 404.
 * Two separate problems in one line: a stale URL, and a shared page that could
 * never have carried eighteen different boards' meeting places anyway.
 *
 * Every town CMS this hunt has met gives each board its own page at a path
 * that is the board's name slugified: `/select-board`, `/planning-board`,
 * `/conservation-commission`. That is not a guess about content — it is a URL
 * shape, and the fetch either answers or it does not. What is read from the
 * page that answers is still the board's own prose.
 *
 * The recorded homepage is tried FIRST and always. This is a fallback for the
 * case where it fails or where one page is standing in for many bodies, and it
 * reports which URL actually answered so the finding cites the right page.
 */
function candidateUrlsFor(bodyName: string, recorded: string): string[] {
  const out = [recorded];
  try {
    const host = new URL(recorded).origin;
    const slug = bodyName
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) {
      out.push(`${host}/${slug}`);
      // The Census-and-CMS habit of dropping "of": `zoning-board-adjustment`
      // rather than `zoning-board-of-adjustment`, which is Sutton's own form.
      const noOf = slug.replace(/-of-/g, "-");
      if (noOf !== slug) out.push(`${host}/${noOf}`);
    }
  } catch {
    // A recorded homepage that is not a URL is itself the finding; the
    // recorded value still gets tried above and will report its own failure.
  }
  return [...new Set(out)];
}

async function hunt(body: string, ocdId: string | null, url: string): Promise<Finding> {
  const r = await read(url);
  if (!r.ok) return { body, ocdId, url, status: "NOT READ", detail: r.note };
  const hits = venueSentences(textOf(r.text));
  return hits.length > 0
    ? { body, ocdId, url, status: "STATES A VENUE", detail: hits.join("  ||  ") }
    : {
        body,
        ocdId,
        url,
        status: "STATES NO VENUE",
        detail:
          `${r.note} — the page was read and states no standing meeting place. ` +
          "A fact about THIS page on this date, never about the body.",
      };
}

/* -------------------------------------------------------------------------- */

const findings: Finding[] = [];

if (ONE_URL) {
  findings.push(await hunt("(--url)", null, ONE_URL));
} else {
  const registry = JSON.parse(
    readFileSync("lib/registry/registry.json", "utf8"),
  ) as {
    bodies: {
      name: string | null;
      ocdId: string | null;
      homepageUrl: string | null;
      coverageStatus: string;
    }[];
  };

  /*
   * The queue is every body this product NAMES but cannot yet show a sitting
   * for, that has a page of its own to read. A body with no homepage is not in
   * scope for this instrument and is reported as out of scope rather than
   * silently skipped — a queue that quietly shrinks is the zero-row shape.
   */
  const named = registry.bodies.filter(
    (b) => b.coverageStatus !== "LIVE" && (TOWN ? String(b.ocdId).includes(TOWN) : true),
  );
  const withPage = named.filter((b) => b.homepageUrl);
  console.log(`\nstanding-venue hunt — RULING 60, ${AS_OF}\n`);
  console.log(
    `  ${named.length} body(ies) not LIVE${TOWN ? ` under ${TOWN}` : ""}; ` +
      `${withPage.length} have a page to read, ${named.length - withPage.length} do not ` +
      "(out of scope for this instrument, and owed a page hunt first)\n",
  );

  /*
   * ONE HUNT PER BODY, not one per recorded URL.
   *
   * The first version deduped by `homepageUrl` and asked each distinct page
   * once — which collapsed all eighteen Sutton bodies into a single question,
   * because they share one boards index. A board's meeting place is a fact
   * about that board; asking a shared index for it can only ever return one
   * answer or none, and it returned none.
   *
   * The per-URL cache below keeps the request count honest: distinct bodies
   * whose candidate paths collide are still only fetched once.
   */
  const cache = new Map<string, { ok: boolean; text: string; note: string }>();
  const cachedRead = async (u: string) => {
    const hit = cache.get(u);
    if (hit) return hit;
    const r = await read(u);
    cache.set(u, r);
    return r;
  };

  console.log(`  ${withPage.length} body(ies) to hunt\n`);
  let n = 0;
  for (const b of withPage) {
    const name = b.name ?? "(unnamed)";
    const candidates = candidateUrlsFor(name, b.homepageUrl!);
    let finding: Finding | null = null;
    const tried: string[] = [];
    for (const url of candidates) {
      const r = await cachedRead(url);
      tried.push(`${url} (${r.ok ? "read" : r.note})`);
      if (!r.ok) continue;
      const hits = venueSentences(textOf(r.text));
      if (hits.length > 0) {
        finding = {
          body: name,
          ocdId: b.ocdId,
          url,
          status: "STATES A VENUE",
          detail: hits.join("  ||  "),
        };
        break;
      }
      finding = {
        body: name,
        ocdId: b.ocdId,
        url,
        status: "STATES NO VENUE",
        detail:
          `${r.note} — read, and states no standing meeting place. A fact ` +
          "about THIS page on this date, never about the body.",
      };
    }
    findings.push(
      finding ?? {
        body: name,
        ocdId: b.ocdId,
        url: b.homepageUrl!,
        // Every candidate refused. A wall, and every rung is named.
        status: "NOT READ",
        detail: `no candidate answered — ${tried.join("; ")}`,
      },
    );
    if (++n % 10 === 0) console.log(`  … ${n} of ${withPage.length}`);
  }
}

const stated = findings.filter((f) => f.status === "STATES A VENUE");
const silent = findings.filter((f) => f.status === "STATES NO VENUE");
const unread = findings.filter((f) => f.status === "NOT READ");

if (stated.length) {
  console.log(`\n  STATES A VENUE (${stated.length}) — quote it, cite it, wire it:\n`);
  for (const f of stated) {
    console.log(`    ${f.body}`);
    console.log(`      ${f.url}`);
    console.log(`      "${f.detail.slice(0, 400)}"\n`);
  }
}
if (unread.length) {
  console.log(`\n  NOT READ (${unread.length}) — a wall, not an absence:\n`);
  for (const f of unread) console.log(`    ${f.body}\n      ${f.url} — ${f.detail}`);
}

// The PAIR, always, and the denominator with it.
console.log(
  `\n  READ ${findings.length} page(s) · STATES A VENUE ${stated.length} · ` +
    `STATES NO VENUE ${silent.length} · NOT READ ${unread.length}`,
);
const sum = stated.length + silent.length + unread.length;
console.log(
  `  ${stated.length} + ${silent.length} + ${unread.length} = ${sum}` +
    (sum === findings.length ? "  (reconciles)" : "  *** DOES NOT RECONCILE ***"),
);

if (findings.length === 0) {
  console.error(
    "\nread ZERO pages. That is an error state, not an empty queue: bodies " +
      "exist that are not LIVE, and this run reached none of their pages.",
  );
  process.exit(1);
}
