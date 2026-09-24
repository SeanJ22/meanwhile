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
 * A meeting with no reviewed venue is never PLACED. `lib/sources/ical/index.ts`
 * says so in its own words: an empty `LOCATION` falls through to the wiring
 * row's `venueMatch`, and with no `venueMatch` there is nothing to pin. That is
 * the correct behaviour — a pin in the middle of New Hampshire is a fabricated
 * location, and pinning every board at the town office because that is where
 * boards usually meet is a guess about a specific sitting dressed as a fact.
 *
 * (Until the venue-gap class, 2026-09-23, such a sitting was also DROPPED. It
 * is now published with no pin and its gap named, and still counted as
 * `unknownVenue` — which is the count this hunt exists to drive to zero, one
 * sourced venue at a time.)
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
/** Case-insensitive, because the argument is typed by a person and the id is not. */
const matchesTown = (ocdId: string) => ocdId.toLowerCase().includes((TOWN ?? "").toLowerCase());

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

/**
 * ── RULING 65, THE FOOTER-ADDRESS ROUTE (adopted 2026-08-21; built here
 * 2026-08-22, NJ Hunt item 2.1) ──────────────────────────────────────────────
 *
 * **This ruling REVERSES a decision NH Hunt 6 made deliberately, and the
 * reversal is named here so a later session reads it as a ruling rather than as
 * drift.**
 *
 * `lib/meetings/venue-cache.ts` carries NH Hunt 6's reasoning verbatim: *"The
 * other fifteen board pages carry '93 Main Street | Sutton Mills' in the SITE
 * FOOTER — the town's own postal address, not a statement about where that
 * board sits. Reading a footer as a venue would pin fifteen bodies at a
 * building on the strength of a template."* That session refused the footer and
 * wired one body of sixteen.
 *
 * The author ruled the other way on 2026-08-21: **one address hosting several
 * bodies is normal in small and large towns alike**, and a town that publishes
 * one municipal address is telling a reader where to go. Fifteen bodies dark
 * because the town uses a site template is a worse answer for the reader than
 * fifteen bodies pinned at the address the town itself publishes.
 *
 * **What the ruling does NOT license, and this is why the route is separate
 * rather than folded into `STATES A VENUE`:** a footer address is NOT that
 * board's own statement about itself, and it may never be cited as though it
 * were. So it gets its own status, its own provenance sentence, and its own
 * `addressSourceUrl` pointing at the footer that carried it. A reader — and the
 * next session — can always tell which of the two kinds of claim a pin rests
 * on. That is the whole of what NH Hunt 6 was protecting, and it survives.
 */
const FOOTER_ADDRESS =
  /(\d{1,5}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Highway|Hwy|Route|Rte|Way|Square|Sq|Place|Pl)\b[^|]{0,60}?(?:NH|New Hampshire|NJ|New Jersey|AZ|Arizona)\s+\d{5}(?:-\d{4})?)/;

/**
 * **THE FOOTER IS AN ELEMENT, NOT A CHARACTER OFFSET.**
 *
 * The first build of this route took "the footer" to mean the last 1,500
 * characters of the stripped text, and on Sutton that produced four matches out
 * of nine pages that all share one template — which is impossible, and was the
 * tell. These pages carry long bodies (a select-board page ends in twelve years
 * of town reports), so the real footer sits at 95% of the document rather than
 * at the end of it, and any offset that reached it on one page overshot the body
 * prose on another. An address picked out of body prose is a property under
 * discussion or somebody's hearing notice, and pinning a board there is the
 * fabricated-location defect this whole instrument exists to avoid.
 *
 * `<footer>` is unambiguous, is what every CMS in this hunt emits, and cannot
 * drift with page length. Where a page has no `<footer>`, the route returns
 * nothing rather than falling back to an offset — a missing footer is an honest
 * empty, and a guess dressed as a footer is not.
 */
function footerOf(html: string): string | null {
  const m = /<footer[\s\S]*?<\/footer>/i.exec(html);
  if (!m) return null;
  return (
    m[0]
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      /*
       * **The pipe is a SEPARATOR here, and it has to go before matching.**
       * Sutton's footer reads `93 Main Street | Sutton Mills, NH 03221 | (603)
       * 927-2408`, and the address pattern's `[^|]` guard — there to stop a
       * match running across two unrelated footer fields — refuses to cross it,
       * so the whole route returned zero on nine pages that plainly carry an
       * address. Normalising the separator to a comma keeps the guard's purpose
       * (a match still cannot run past a field boundary that is a real newline
       * or a bullet) while letting the address read as the one field it is.
       */
      .replace(/\s*[|•·]\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** A phone in the footer is the municipality's published line — Kelly-standard contact. */
const FOOTER_PHONE = /\(?\b(\d{3})\)?[.\s-]?(\d{3})[.\s-](\d{4})\b/;

function footerAddress(html: string): { address: string; phone: string | null } | null {
  const foot = footerOf(html);
  if (!foot) return null;
  const m = FOOTER_ADDRESS.exec(foot);
  if (!m) return null;
  const phone = FOOTER_PHONE.exec(foot);
  return {
    address: m[1]!
      .replace(/\s*\|\s*/g, ", ")
      .replace(/\s+,/g, ",")
      .replace(/\s+/g, " ")
      .trim(),
    phone: phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : null,
  };
}

interface Finding {
  body: string;
  ocdId: string | null;
  url: string;
  status: "STATES A VENUE" | "FOOTER ADDRESS" | "STATES NO VENUE" | "NOT READ";
  detail: string;
  /** The footer address, where the RULING 65 route produced one. */
  footer?: string;
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
  const text = textOf(r.text);
  const hits = venueSentences(text);
  if (hits.length > 0) {
    return { body, ocdId, url, status: "STATES A VENUE", detail: hits.join("  ||  ") };
  }
  /*
   * RULING 65. The board's own page said nothing, so ask the site footer for
   * the municipal address — and report it as a DIFFERENT KIND OF CLAIM, never
   * as the board's own statement.
   */
  const foot = footerAddress(r.text);
  if (foot) {
    return {
      body,
      ocdId,
      url,
      status: "FOOTER ADDRESS",
      footer: foot.address + (foot.phone ? ` · ${foot.phone}` : ""),
      detail:
        `${r.note} — the page states no meeting place of its own; the SITE FOOTER carries "${foot.address}"${foot.phone ? ` and the line ${foot.phone}` : ""}. ` +
        "RULING 65: this is the municipality's published address, cited as the site footer and never as this board's own statement about itself.",
    };
  }
  return {
        body,
        ocdId,
        url,
        status: "STATES NO VENUE",
        detail:
          `${r.note} — the page was read and states no standing meeting place, and its footer carries no address either. ` +
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
    (b) => b.coverageStatus !== "LIVE" && (TOWN ? matchesTown(String(b.ocdId)) : true),
  );

  /*
   * ── AN ARGUMENT THAT MATCHES NOTHING IS NOT AN EMPTY TOWN ────────────────
   * (NJ Hunt 2, 2026-08-22.)
   *
   * The filter was `String(b.ocdId).includes(TOWN)` — case-SENSITIVE. This
   * file's own header documents `--town sutton_town`, and `--town Sutton`
   * therefore matched none of Sutton's nineteen bodies and printed
   *
   *     0 body(ies) not LIVE under Sutton
   *
   * which is a sentence about Sutton and is false. The run did exit non-zero,
   * which is the only reason this was caught rather than believed.
   *
   * So the match is case-insensitive, and an argument matching NO body at all
   * — before the LIVE filter is applied — stops the run naming the argument.
   * "Your filter matched nothing" and "this town has nothing owed a hunt" are
   * different answers and may never print as the same one.
   */
  if (TOWN) {
    const anyBody = registry.bodies.filter((b) => matchesTown(String(b.ocdId)));
    if (anyBody.length === 0) {
      console.error(
        `\n  --town ${JSON.stringify(TOWN)} matches NO body in this registry, of ${registry.bodies.length}. ` +
          "That is a fact about the argument, not about the town. Division ids look like " +
          "`ocd-division/country:us/state:nh/county:merrimack/place:sutton_town`, so a fragment of one — " +
          "`sutton_town`, `sutton`, `merrimack` — is what this expects.\n",
      );
      process.exit(2);
    }
  }
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
      const pageText = textOf(r.text);
      const hits = venueSentences(pageText);
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
      /*
       * RULING 65 — the footer route, ranked BELOW the board's own words and
       * ABOVE nothing. A `break` here would stop the walk at a footer while a
       * later candidate URL still had the board's own statement on it, and the
       * board's own words must always win, so this records and keeps walking.
       */
      const foot = footerAddress(r.text);
      if (foot) {
        finding = {
          body: name,
          ocdId: b.ocdId,
          url,
          status: "FOOTER ADDRESS",
          footer: foot.address + (foot.phone ? ` · ${foot.phone}` : ""),
          detail:
            `${r.note} — states no meeting place of its own; SITE FOOTER carries "${foot.address}"${foot.phone ? ` and the line ${foot.phone}` : ""}. ` +
            "RULING 65: the municipality's published address, cited as the footer and never as this board's own words.",
        };
        continue;
      }
      finding = {
        body: name,
        ocdId: b.ocdId,
        url,
        status: "STATES NO VENUE",
        detail:
          `${r.note} — read, and states no standing meeting place, and its footer carries no address either. A fact ` +
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
const footed = findings.filter((f) => f.status === "FOOTER ADDRESS");
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
if (footed.length) {
  console.log(
    `\n  FOOTER ADDRESS (${footed.length}) — RULING 65: the municipality's own published address,\n` +
      "  cited as the SITE FOOTER and never as this board's own statement about itself:\n",
  );
  for (const f of footed) {
    console.log(`    ${f.body}`);
    console.log(`      ${f.url}`);
    console.log(`      ${f.footer}\n`);
  }
}
if (unread.length) {
  console.log(`\n  NOT READ (${unread.length}) — a wall, not an absence:\n`);
  for (const f of unread) console.log(`    ${f.body}\n      ${f.url} — ${f.detail}`);
}

// The PAIR, always, and the denominator with it.
console.log(
  `\n  READ ${findings.length} page(s) · STATES A VENUE ${stated.length} · ` +
    `FOOTER ADDRESS ${footed.length} · STATES NO VENUE ${silent.length} · NOT READ ${unread.length}`,
);
const sum = stated.length + footed.length + silent.length + unread.length;
console.log(
  `  ${stated.length} + ${footed.length} + ${silent.length} + ${unread.length} = ${sum}` +
    (sum === findings.length ? "  (reconciles)" : "  *** DOES NOT RECONCILE ***"),
);

if (findings.length === 0) {
  console.error(
    "\nread ZERO pages. That is an error state, not an empty queue: bodies " +
      "exist that are not LIVE, and this run reached none of their pages.",
  );
  process.exit(1);
}
