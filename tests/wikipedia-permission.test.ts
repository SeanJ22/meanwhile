import assert from "node:assert/strict";
import test from "node:test";

import {
  WIKI_API_DISALLOWED,
  WIKI_RAW_BASE,
  fetchWikitext,
  wikiRawUrl,
} from "../lib/hunt/wikipedia.ts";

test("Wikipedia's Disallow: /w/ is recorded as evidence and no longer forbids a route (owner decision 2026-09-25)", () => {
  assert.equal(WIKI_API_DISALLOWED, "https://en.wikipedia.org/w/api.php", "the recorded rule's path is kept");
});

test("the replacement route is under /wiki/, which carries no blanket Disallow", () => {
  assert.equal(WIKI_RAW_BASE, "https://en.wikipedia.org/wiki/");
  const url = wikiRawUrl("Tucson, Arizona");
  assert.equal(url, "https://en.wikipedia.org/wiki/Tucson%2C_Arizona?action=raw");
  assert.ok(!url.includes("/w/api.php"));
  assert.match(wikiRawUrl("Template:NJ Morris County Commissioners"), /Template%3ANJ_Morris/);
});

test("a redirect is followed exactly once, because the API's redirects=1 was load-bearing", async () => {
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
