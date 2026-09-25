/**
 * **THE SEARCH POOL, GUARDED: ROBOTS.TXT IS RECORDED, AN ACCESS CONTROL KEEPS AN
 * ENGINE OUT.**
 *
 * Mojeek and Brave were kept out of the pool from 2026-08-25 for their
 * `Disallow: /search` alone. Since the owner decision of 2026-09-25 robots.txt
 * alone never excludes a route; each engine's robots reading is recorded, and an
 * exclusion names a real reason — an access control on the query page (never
 * bypassed) or a failed control. Re-measured 2026-09-25: Mojeek answers a
 * CAPTCHA, Brave a 429.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  SEARCH_CONTROL_QUERY,
  SEARCH_POOL,
  SEARCH_POOL_EXCLUDED,
  namesSubject,
  stripQueryEcho,
} from "../lib/hunt/search-pool.ts";

const ROOT = join(import.meta.dirname, "..");

describe("the search pool records robots.txt and excludes only for an access control or a failed control", () => {
  it("no engine is excluded for robots.txt alone, and none in the pool is one this project recorded as excluded", () => {
    for (const e of SEARCH_POOL_EXCLUDED) {
      assert.ok(["WALLED", "FAILS_CONTROL"].includes(e.kind), `${e.id} is excluded as ${e.kind}; robots.txt alone never excludes (owner decision 2026-09-25)`);
    }
    const excluded = SEARCH_POOL_EXCLUDED.map((e) => e.id);
    assert.deepEqual(SEARCH_POOL.filter((e) => excluded.includes(e.id)).map((e) => e.id), []);
  });

  it("mojeek and brave are walled by access controls, re-measured 2026-09-25 — their robots.txt lines are recorded, not the reason", () => {
    for (const [id, control] of [["mojeek", /CAPTCHA/], ["brave", /HTTP 429/]] as const) {
      const row = SEARCH_POOL_EXCLUDED.find((e) => e.id === id);
      if (!row) {
        assert.fail(`${id} must stay in the record rather than being deleted`);
        return;
      }
      assert.equal(row.kind, "WALLED", `${id} is kept out by an access control`);
      assert.match(row.why, control, `${id}'s reason names the access control measured`);
      assert.match(row.why, /never|honoured/, `${id}'s reason says the access control is not bypassed`);
      assert.match(row.why, /Disallow: \/search` is recorded and is not the reason/, `${id} records its robots line as evidence`);
      assert.equal(row.measuredOn, "2026-09-25");
    }
  });

  it("every engine in the pool records its robots.txt reading with a date", () => {
    assert.ok(SEARCH_POOL.length > 0, "an empty pool would pass every other test here");
    for (const e of SEARCH_POOL) {
      assert.match(e.robots, /robots|Disallow|Allow/i, `${e.id} does not quote its robots.txt`);
      assert.match(e.robots, /\d{4}-\d{2}-\d{2}/, `${e.id}'s robots reading carries no date`);
      assert.ok(e.index.length > 5, `${e.id} does not say whose index it queries`);
    }
  });

  it("every exclusion says WHY and carries a date, and none is a placeholder", () => {
    for (const e of SEARCH_POOL_EXCLUDED) {
      assert.ok(e.why.length > 40, `${e.id}'s reason is too short to be one`);
      assert.match(e.measuredOn, /^\d{4}-\d{2}-\d{2}$/, `${e.id} carries no measurement date`);
    }
  });

  it("a 202 is a refusal — DuckDuckGo's challenge is not a search that found nothing", () => {
    for (const e of SEARCH_POOL) {
      assert.equal(e.refuses(202), true, `${e.id} would read a 202 challenge as an answer`);
      assert.equal(e.refuses(429), true);
      assert.equal(e.refuses(200), false);
    }
  });

  it("the content control catches a shell that answers identically to an impossible query", () => {
    const shell = "<html><body>Search</body></html>";
    assert.equal(namesSubject(shell, shell, "verga"), false, "a shell names nobody either way");
    assert.equal(namesSubject("… Nancy Verga, Morris Plains …", shell, "verga"), true);
    /*
     * And the half that matters more: an engine that echoes the query back into
     * its own no-results page would name the subject in BOTH bodies, and must
     * not read as a result.
     */
    assert.equal(namesSubject("no results for verga", "no results for verga", "verga"), false);
  });

  it("docs/sources.md records the same verdict as the module, for the same hosts", () => {
    /*
     * The register is the source of record for what exists (CLAUDE.md), and a
     * module that disagreed with it would be two authorities on one question.
     */
    const sources = readFileSync(join(ROOT, "docs", "sources.md"), "utf8");
    for (const id of ["mojeek", "brave"]) {
      const row = SEARCH_POOL_EXCLUDED.find((e) => e.id === id);
      if (!row) {
        assert.fail(`${id} is not in the exclusion record`);
        return;
      }
      assert.ok(
        sources.includes(row.id) || sources.includes(`${row.id}.com`),
        `docs/sources.md does not mention ${id}, so the register and the module disagree`,
      );
    }
  });

  it("the control query is an identifier nothing could match", () => {
    assert.match(SEARCH_CONTROL_QUERY, /zzqxwv/, "the control must be an invented token, not a rare word");
  });
});

/* -------------------------------------------------------------------------- */
/* THE ECHO STRIPPER (2026-08-26) — the control was counting the query back    */
/* -------------------------------------------------------------------------- */

it("a search page that echoes the query and returns nothing does NOT name the subject", () => {
  // Captured from `4get.ca/web?s=Karen+Ebel+New+Hampshire` on 2026-08-26. The
  // real page was 7,154 bytes, the control 7,274 — the "answer" was SMALLER
  // than the answer to an impossible query — and the surname appeared eight
  // times, every one of them an echo.
  const echoed =
    '<html lang="en"><head><meta http-equiv="Content-Type" content="text/html;charset=utf-8">' +
    "<title>Karen Ebel New Hampshire (web)</title>" +
    '<meta name="description" content="4get: Web search results for &quot;Karen Ebel New Hampshire&quot;"></head>' +
    '<body><input type="text" value="Karen Ebel New Hampshire" name="s">' +
    '<div class="tabs"><a href="/web?s=Karen+Ebel+New+Hampshire" class="tab selected">Web</a>' +
    '<a href="/images?s=Karen+Ebel+New+Hampshire" class="tab">Images</a>' +
    '<a href="/videos?s=Karen+Ebel+New+Hampshire" class="tab">Videos</a>' +
    '<a href="/news?s=Karen+Ebel+New+Hampshire" class="tab">News</a>' +
    '<a href="/music?s=Karen+Ebel+New+Hampshire" class="tab">Music</a></div>' +
    "<div class=\"results\"></div></body></html>";
  const control = '<html lang="en"><head><title>zzq (web)</title></head><body><div class="results"></div></body></html>';

  assert.equal(
    (echoed.match(/Ebel/g) ?? []).length,
    8,
    "precondition: the captured page really does carry the surname eight times",
  );
  assert.equal(
    namesSubject(echoed, control, "Ebel", "Karen Ebel New Hampshire"),
    false,
    "eight echoes of the query is not a page about the subject — this is the measurement " +
      "docs/sources.md recorded on 2026-08-25 as the engine working",
  );
});

it("a page with the subject in RESULT TEXT still names the subject", () => {
  // The direction that matters more: stripping the echo must not have blinded
  // the control to a real result.
  const real =
    '<html><head><title>Karen Ebel New Hampshire (web)</title></head><body>' +
    '<input value="Karen Ebel New Hampshire" name="s">' +
    '<div class="results"><a href="https://gc.nh.gov/house/members/member.aspx?member=377093">' +
    "Representative Karen Ebel (D) Merrimack - District 7</a>" +
    "<p>Ebel serves on the Finance committee.</p></div></body></html>";
  const control = "<html><head><title>zzq (web)</title></head><body></body></html>";
  assert.equal(namesSubject(real, control, "Ebel", "Karen Ebel New Hampshire"), true);
});

it("stripQueryEcho removes the metadata and the attribute echoes and nothing else", () => {
  const body = '<title>Foo Bar</title><a href="/web?s=Foo+Bar">tab</a><p>Foo Bar appears here too</p>';
  const stripped = stripQueryEcho(body, "Foo Bar");
  assert.ok(!stripped.includes("<title>"), "the title is gone");
  assert.ok(!/href="[^"]*Foo\+Bar/.test(stripped), "the echoing attribute is gone");
  assert.ok(stripped.includes("Foo Bar appears here too"), "body text survives");
});
