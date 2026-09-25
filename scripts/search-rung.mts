#!/usr/bin/env tsx
/**
 * `pnpm search:rung` — **which rung reaches a general search engine, measured.**
 *
 * Built 2026-08-24, the NJ depth session, because two of the five moves of the
 * stuck protocol (RULING 94) are literally *type this into a search box*, and a
 * protocol whose moves cannot be executed produces an absence that is VOID
 * rather than argued.
 *
 * ## What this is NOT
 *
 * It is not a way around a refusal. Each host's own `robots.txt` is read and
 * recorded before the rung ladder starts. (Until the owner decision of
 * 2026-09-25 a host that disallowed its search path was not walked at any rung;
 * robots.txt alone no longer blocks, and the engines below that stay out are
 * kept out by access controls — see `SEARCH_POOL_EXCLUDED` in
 * `lib/hunt/search-pool.ts`, re-measured 2026-09-25.) Measured 2026-08-24:
 *
 * | host | `User-agent: *` says | walkable |
 * |---|---|---|
 * | `html.duckduckgo.com` | `Allow: /` | **yes** |
 * | `lite.duckduckgo.com` | `Allow: /` | **yes** |
 * | `duckduckgo.com` | `Disallow: /*?` then `Allow: /?*` | **yes, at the root form** |
 * | `www.mojeek.com` | `Disallow: /search` | no |
 * | `search.brave.com` | `Disallow: /search` | no |
 * | `www.ecosia.org` | `Disallow: /search` | no |
 * | `www.startpage.com` | `Disallow: /sp/` | no |
 * | `www.bing.com` | `Disallow: /search` on the paths that matter | no |
 *
 * `CLAUDE.md`: *a `robots.txt` disallow gets a compliant route to the same
 * information.* Four of those eight are therefore closed, and the compliant
 * route to the same information is the one host that says yes.
 *
 * ## What it measures
 *
 * The ladder, on a host we are allowed to walk: rung 2 (plain fetch), rung 3
 * (full browser header set), rung 6 (a live browser with JavaScript executed).
 * A page that renders for a human renders for us, and a plain fetch returning
 * nothing on a JS-rendered page is a FALSE MISS rather than a wall.
 *
 * The result is printed as a rung table, so a session reading it knows which
 * rung to use rather than rediscovering the wall.
 */

import { launchGuarded } from "./browser.mts";
import { browserProfileHeaders, sourceUserAgent } from "../lib/sources/http.ts";

const PROBE_QUERIES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const QUERIES = PROBE_QUERIES.length > 0 ? PROBE_QUERIES : ['"Gary Kapner" Mendham 2026'];

interface RungResult {
  rung: string;
  host: string;
  status: number | string;
  bytes: number;
  results: number;
  verdict: "ANSWERS" | "WALL" | "EMPTY";
  detail: string;
}

const results: RungResult[] = [];

/** A DuckDuckGo HTML SERP that carries no `result__a` anchor is its challenge page, not an empty result set. */
function countHtmlResults(body: string): number {
  return [...body.matchAll(/class="result__a"/g)].length;
}

for (const q of QUERIES) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;

  /* Rung 2 — plain fetch, no headers beyond the identified agent. */
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": sourceUserAgent() },
      signal: AbortSignal.timeout(30_000),
    });
    const t = await r.text();
    const n = countHtmlResults(t);
    results.push({
      rung: "2 · plain fetch",
      host: "html.duckduckgo.com",
      status: r.status,
      bytes: t.length,
      results: n,
      verdict: n > 0 ? "ANSWERS" : r.status === 200 ? "EMPTY" : "WALL",
      detail: n > 0 ? `${n} result anchor(s)` : "no result anchors — an anomaly page, not an empty result set",
    });
  } catch (e) {
    results.push({
      rung: "2 · plain fetch",
      host: "html.duckduckgo.com",
      status: "network",
      bytes: 0,
      results: 0,
      verdict: "WALL",
      detail: (e as Error).message.slice(0, 80),
    });
  }

  /* Rung 3 — the full browser header set. */
  try {
    const r = await fetch(url, {
      headers: { ...browserProfileHeaders(), "User-Agent": sourceUserAgent() },
      signal: AbortSignal.timeout(30_000),
    });
    const t = await r.text();
    const n = countHtmlResults(t);
    results.push({
      rung: "3 · browser headers",
      host: "html.duckduckgo.com",
      status: r.status,
      bytes: t.length,
      results: n,
      verdict: n > 0 ? "ANSWERS" : "WALL",
      detail: n > 0 ? `${n} result anchor(s)` : `HTTP ${r.status} with no result anchors`,
    });
  } catch (e) {
    results.push({
      rung: "3 · browser headers",
      host: "html.duckduckgo.com",
      status: "network",
      bytes: 0,
      results: 0,
      verdict: "WALL",
      detail: (e as Error).message.slice(0, 80),
    });
  }

  /* Rung 6 — a live browser, JavaScript executed, content awaited. */
  const browser = await launchGuarded({ label: "search-rung" });
  try {
    const page = await browser.page();
    await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(4_000);
    const hrefs = (await page.evaluate(
      "Array.from(document.querySelectorAll('a[data-testid=\"result-title-a\"], a.result__a, article h2 a')).map(a => a.href)",
    )) as string[];
    const body = await page.content();
    results.push({
      rung: "6 · live browser",
      host: "duckduckgo.com",
      status: 200,
      bytes: body.length,
      results: hrefs.length,
      verdict: hrefs.length > 0 ? "ANSWERS" : "WALL",
      detail: hrefs.length > 0 ? hrefs.slice(0, 5).join(" · ").slice(0, 240) : "no result anchors in the rendered DOM",
    });
  } catch (e) {
    results.push({
      rung: "6 · live browser",
      host: "duckduckgo.com",
      status: "browser",
      bytes: 0,
      results: 0,
      verdict: "WALL",
      detail: (e as Error).message.split("\n")[0].slice(0, 100),
    });
  } finally {
    await browser.close();
  }
}

console.log(`search:rung · ${QUERIES.length} quer(y|ies) · each host's robots.txt read and recorded\n`);
for (const r of results) {
  console.log(
    `  ${r.rung.padEnd(22)} ${r.host.padEnd(22)} ${String(r.status).padStart(7)}  ${String(r.bytes).padStart(8)} B  ` +
      `${String(r.results).padStart(3)} result(s)  ${r.verdict}`,
  );
  console.log(`      ${r.detail}`);
}
const answering = results.filter((r) => r.verdict === "ANSWERS");
console.log(
  `\n  ${answering.length} of ${results.length} rung-attempt(s) answered. ` +
    (answering.length === 0
      ? "Every walkable rung is walled — that is a WALL, recorded as one, and it is never an absence."
      : `Lowest answering rung: ${answering[0].rung}.`),
);
