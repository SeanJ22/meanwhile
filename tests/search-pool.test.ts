/**
 * **PERMISSION BEFORE REACHABILITY — the search pool, guarded.**
 *
 * This module was first written with Mojeek and Brave in the pool. Both answer,
 * both pass a control query, and **both carry `Disallow: /search` in their
 * `robots.txt` — which is exactly the path a query goes to.** They were removed
 * the same session.
 *
 * `CLAUDE.md` names four limits on an otherwise unrestricted mandate, and one is
 * that an access control is never circumvented. RULING 52 puts it in the tree's
 * vocabulary: a `robots.txt` disallow gets a COMPLIANT ROUTE to the same
 * information. And `docs/sources.md` had already recorded both hosts as *not
 * walked at any rung* on 2026-08-24, for this exact reason — the record was
 * right and a later session walked them anyway.
 *
 * A guard, therefore, rather than a memory.
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

describe("the search pool asks permission before it asks anything else", () => {
  it("no engine in the pool is one this project recorded as DISALLOWED", () => {
    const disallowed = SEARCH_POOL_EXCLUDED.filter((e) => e.kind === "DISALLOWED").map((e) => e.id);
    const offenders = SEARCH_POOL.filter((e) => disallowed.includes(e.id)).map((e) => e.id);
    assert.deepEqual(
      offenders,
      [],
      "an engine whose robots.txt disallows the query path is in the pool. A disallow is a host " +
        "telling us not to ask, and it is honoured — it is not a wall to be re-walked on a clock.",
    );
  });

  it("mojeek and brave are named as DISALLOWED, not as walls — they answered fine", () => {
    /*
     * The distinction this whole file is about. Both hosts return 200 and name
     * the subject; recording them as walls would put them on RULING 53's
     * fourteen-day clock, and a future session would re-walk them as a matter
     * of course. A disallow gets the opposite treatment.
     */
    for (const id of ["mojeek", "brave"]) {
      const row = SEARCH_POOL_EXCLUDED.find((e) => e.id === id);
      if (!row) {
        assert.fail(`${id} must stay in the record rather than being deleted`);
        return;
      }
      assert.equal(row.kind, "DISALLOWED", `${id} is recorded as ${row.kind}, which invites a re-walk`);
      assert.match(row.why, /Disallow/, `${id}'s reason must quote the robots.txt line`);
      assert.match(row.measuredOn, /^\d{4}-\d{2}-\d{2}$/, `${id} carries no measurement date`);
    }
  });

  it("every engine in the pool quotes the robots.txt line that permits its path", () => {
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
