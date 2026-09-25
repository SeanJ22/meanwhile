import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  WIKI_API_DISALLOWED,
  WIKI_RAW_BASE,
  fetchWikitext,
  wikiRawUrl,
} from "../lib/hunt/wikipedia.ts";

/**
 * **`/w/api.php` IS DISALLOWED, AND THIS PROJECT WAS USING IT.** (2026-09-01.)
 *
 * `https://en.wikipedia.org/robots.txt`, read 2026-09-01, `User-agent: *`:
 *
 * ```
 *   Allow: /w/api.php?action=mobileview&
 *   Allow: /w/load.php?
 *   Disallow: /w/
 * ```
 *
 * Two `Allow` lines, neither a content query. Every Wikipedia call this
 * repository made ran through `/w/api.php?action=query`, for weeks, while
 * `docs/sources.md` recorded the host as Tier A and WIRED.
 *
 * **The row was never checked against the host's own file.** That is the defect
 * class this guard exists for, and it is worth naming precisely: a permission
 * claim resting on our own paperwork rather than on the publisher's is not a
 * permission claim at all. It was found only because a lane registering a NEW
 * Wikipedia route read robots.txt before shipping it — the discipline caught it
 * one route later than it should have, and ten requests reached the disallowed
 * path first.
 *
 * **Since the owner decision of 2026-09-25 that Disallow is recorded, not
 * blocking** ("Robots.txt alone must not block acquisition"). The sweep that
 * refused any committed `/w/` URL enforced the old rule and is replaced by
 * `tests/robots-recorded-not-blocking.test.ts`. What stays true, and is held
 * here: the host's rule is recorded, and the `/wiki/` route in use works.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Wikipedia's Disallow: /w/ is recorded as evidence and no longer forbids a route (owner decision 2026-09-25)", () => {
  const src = readFileSync(join(ROOT, "lib/hunt/wikipedia.ts"), "utf8");
  assert.equal(WIKI_API_DISALLOWED, "https://en.wikipedia.org/w/api.php", "the recorded rule's path is kept");
  assert.match(src, /Disallow: \/w\//, "the host's operative line is quoted as read");
  assert.match(src, /recorded, not\s+\*?\s*blocking/, "and the module says it is recorded, not blocking");
});

test("the replacement route is under /wiki/, which carries no blanket Disallow", () => {
  assert.equal(WIKI_RAW_BASE, "https://en.wikipedia.org/wiki/");
  const url = wikiRawUrl("Tucson, Arizona");
  assert.equal(url, "https://en.wikipedia.org/wiki/Tucson%2C_Arizona?action=raw");
  assert.ok(!url.includes("/w/api.php"));
  /*
   * The colon in a template title encodes to %3A and the host accepts it —
   * verified live on 2026-09-01, HTTP 200 on
   * Template:NJ Morris County Commissioners.
   */
  assert.match(wikiRawUrl("Template:NJ Morris County Commissioners"), /Template%3ANJ_Morris/);
});

test("a redirect is followed exactly once, because the API's redirects=1 was load-bearing", async () => {
  /*
   * `Template:NJ Morris County Commissioners` redirects to the same title with
   * a lowercase `commissioners`, and the module that lost that follow would
   * record seven county commissioners as unreachable on the strength of a
   * capital letter. The raw route answers a redirect with its wikitext, so the
   * follow is explicit and has to be tested.
   */
  const served: Record<string, string> = {
    "https://en.wikipedia.org/wiki/Template%3AA?action=raw": "#REDIRECT [[Template:B]]",
    "https://en.wikipedia.org/wiki/Template%3AB?action=raw": "the real wikitext",
  };
  const asked: string[] = [];
  const page = await fetchWikitext(
    "Template:A",
    async (url) => {
      asked.push(url);
      return { status: url in served ? 200 : 404, body: served[url] ?? "" };
    },
    "2026-09-01",
  );

  assert.equal(page.wikitext, "the real wikitext");
  assert.equal(page.requested, "Template:A", "the row still says what was ASKED for");
  assert.equal(page.title, "Template:B", "and what was actually served");
  assert.equal(asked.length, 2);
});

test("a redirect chain deeper than one hop STOPS, and says so", async () => {
  const page = await fetchWikitext(
    "Loop",
    async () => ({ status: 200, body: "#REDIRECT [[Loop]]" }),
    "2026-09-01",
  );
  assert.equal(page.wikitext, null);
  assert.match(String(page.missReason), /deeper than one hop/);
});

test("404 is 'no such article', and a non-200 is reported as itself", async () => {
  const missing = await fetchWikitext(
    "Nope",
    async () => ({ status: 404, body: "" }),
    "2026-09-01",
  );
  assert.equal(missing.missReason, "no such article");

  const refused = await fetchWikitext(
    "Nope",
    async () => ({ status: 429, body: "" }),
    "2026-09-01",
  );
  assert.equal(refused.missReason, "HTTP 429");
  assert.notEqual(
    refused.missReason,
    "no such article",
    "a rate limit is a fact about us and must never read as a fact about the encyclopedia",
  );
});

test("an empty body is a FAILED extraction, never an empty article", async () => {
  const page = await fetchWikitext("Empty", async () => ({ status: 200, body: "" }), "2026-09-01");
  assert.equal(page.wikitext, null);
  assert.match(String(page.missReason), /returned no wikitext/);
});
