import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
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
 * `docs/sources.md`'s reachability rule already says a disallow is honoured and
 * never re-walked on a clock. Nothing here is about a wall or about transport
 * (RULING 182): the host answers `/w/api.php` with 200 all day. It is about
 * permission, and permission is not something a 200 can grant.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The exact operative lines, quoted from the host on 2026-09-01. */
const ALLOWED_UNDER_W = ["/w/api.php?action=mobileview&", "/w/load.php?"];

test("no committed source composes a URL on Wikipedia's disallowed /w/ path", () => {
  /*
   * Read over what WOULD BE COMMITTED rather than over `git ls-files`: a new
   * file is invisible to a tracked-only sweep until the very `git add` that
   * ships it, which is the ordering defect `tests/asset-store.test.ts` already
   * records for binaries.
   */
  const offenders: string[] = [];
  for (const rel of filesThatWouldBeCommitted({ cwd: ROOT })) {
    if (!/\.(ts|tsx|mts|mjs|js)$/.test(rel)) continue;
    if (rel === "tests/wikipedia-permission.test.ts") continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    if (!text.includes("wikipedia.org/w/")) continue;

    /*
     * `lib/hunt/wikipedia.ts` holds the literal ON PURPOSE, as
     * `WIKI_API_DISALLOWED`, so this guard has something to look at. A guard
     * that passes because the thing it hunts was deleted is a guard about
     * nothing — the same reason `tests/asset-store.test.ts` asserts its own
     * sweep reaches the portraits.
     */
    for (const line of text.split("\n")) {
      if (!/wikipedia\.org\/w\//.test(line)) continue;
      if (/^\s*[/*]/.test(line.trim())) continue; // a comment quoting the rule
      if (rel === "lib/hunt/wikipedia.ts" && line.includes("WIKI_API_DISALLOWED =")) continue;
      if (ALLOWED_UNDER_W.some((a) => line.includes(a))) continue;
      offenders.push(`${rel}: ${line.trim().slice(0, 120)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "en.wikipedia.org/robots.txt says `Disallow: /w/`, and allows exactly " +
      `${ALLOWED_UNDER_W.join(" and ")} under it. Use /wiki/<Title>?action=raw, which is the ` +
      "same record by another representation (RULING 206) and carries no Disallow.",
  );
});

test("the guard is looking at something — the disallowed literal is still in the tree", () => {
  const src = readFileSync(join(ROOT, "lib/hunt/wikipedia.ts"), "utf8");
  assert.ok(
    src.includes('WIKI_API_DISALLOWED = "https://en.wikipedia.org/w/api.php"'),
    "the literal is kept, exported and unused so the sweep above has a subject",
  );
  assert.equal(WIKI_API_DISALLOWED, "https://en.wikipedia.org/w/api.php");
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
