import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SourceHttpError, notADocument, politeGetText } from "../lib/sources/http.ts";
import { accountedNormalize } from "../lib/sources/normalize-account.ts";

/**
 * The fetch layer refuses a 200 that is not a document, on both return paths (the in-process client and
 * the curl rung), while an honest empty calendar with nothing in the served window still passes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** A 200 with the given body, from a fetch this test controls entirely. */
const serving = (body: string, status = 200): typeof fetch =>
  (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "text/calendar" },
    })) as unknown as typeof fetch;

test("an empty 200 is a WALL, not an empty source", async () => {
  await assert.rejects(
    () => politeGetText("https://example.test/x.ics", { fetchImpl: serving("   \n\t ") }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError, "refused as a source HTTP error");
      assert.match(error.message, /an empty body/);
      assert.match(error.message, /WALL/);
      assert.equal(error.rung, 2);
      return true;
    },
  );
});

test("a 200 in the wrong format is a WALL, and the wall names the format", async () => {
  await assert.rejects(
    () =>
      politeGetText("https://example.test/x.ics", {
        fetchImpl: serving("<html><body>Service temporarily unavailable</body></html>"),
        expect: { label: "a calendar feed", marker: "BEGIN:VCALENDAR" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.match(error.message, /a calendar feed carrying no BEGIN:VCALENDAR/);
      return true;
    },
  );
});

test("a real document still passes, and is returned untouched", async () => {
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Selectboard\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const result = await politeGetText("https://example.test/x.ics", {
    fetchImpl: serving(ics),
    expect: { label: "a calendar feed", marker: "BEGIN:VCALENDAR" },
  });
  assert.equal(result.text, ics);
  assert.equal(result.status, 200);
});

test("a caller that declares no format still gets the blank check", () => {
  // The universal half needs no configuration: a whitespace-only 200 is never
  // a document, for any caller, in any format.
  assert.equal(notADocument(""), "an empty body");
  assert.equal(notADocument("\n\n  \t"), "an empty body");
  assert.equal(notADocument("<html>anything at all</html>"), null);
});

test("notADocument reads the marker, not the content type", () => {
  assert.equal(notADocument("BEGIN:VCALENDAR\nEND:VCALENDAR", {
    label: "a calendar feed",
    marker: "BEGIN:VCALENDAR",
  }), null);
  assert.equal(
    notADocument("nope", { label: "a calendar feed", marker: "BEGIN:VCALENDAR" }),
    "a calendar feed carrying no BEGIN:VCALENDAR",
  );
});

/** A calendar with no sitting in the window is an honest empty result, not a failure. */
test("an honest empty — everything parsed, everything out of window — is allowed", () => {
  assert.doesNotThrow(() =>
    accountedNormalize(
      "ical",
      [{ doc: 1 }, { doc: 2 }],
      { meetings: [], drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } },
      { outOfWindow: 11 },
    ),
  );
});

test("the exemption cannot be claimed by a pass that set nothing aside", () => {
  assert.throws(
    () =>
      accountedNormalize(
        "ical",
        [{ doc: 1 }],
        {
          meetings: [],
          drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        },
        { outOfWindow: 0 },
      ),
    /zero-row extraction is a failed extraction/,
  );
});

/**
 * A file that reads a network response checks that what came back is a document. The walk is a filesystem
 * walk because ripgrep skips NUL-byte files and hidden paths and reports nothing found without having looked.
 */
test("every direct network read in a source adapter checks it got a document", () => {
  const adapters = join(ROOT, "lib", "sources");
  const offenders: string[] = [];
  let read = 0;
  let direct = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      // The shared client is the one place a bare fetch belongs.
      if (full.endsWith(join("lib", "sources", "http.ts"))) continue;
      read++;
      const body = readFileSync(full, "utf8");
      /* `await fetch(` is the invocation form; every adapter exports a method named `fetch`. */
      if (!/await\s+fetch\s*\(/.test(body)) continue;
      direct++;
      if (!body.includes("notADocument")) offenders.push(relative(ROOT, full));
    }
  };
  walk(adapters);

  assert.ok(read > 10, `the sweep must actually read adapters — read ${read}`);
  // The sweep has to find the shape it is guarding, or an allowlist that
  // silently matches nothing reads as a clean board.
  assert.ok(
    direct >= 1,
    `the sweep must find the direct-fetch shape it guards — found ${direct}`,
  );
  assert.deepEqual(
    offenders,
    [],
    `direct network reads with no document check: ${offenders.join(", ")}`,
  );
});

/** Every rung's 200 goes through the one finalizer. `options.ladder` drives the escalation with doubles; without it nothing escalates. */

const html404 = "<html><body><h1>404 Not Found</h1></body></html>";

/** A 403 on the first call — the trigger for the whole escalation. */
const refuse403 = (): Promise<Response> =>
  Promise.resolve(new Response("forbidden", { status: 403 }));

test("A-003 · a rung-4 200 carrying the wrong format is a WALL, not a document", async () => {
  await assert.rejects(
    politeGetText("https://town.example/export.ics", {
      fetchImpl: refuse403 as unknown as typeof fetch,
      expect: { label: "an .ics feed", marker: "BEGIN:VCALENDAR" },
      ladder: {
        // Rung 4 answers 200 with an HTML error page.
        curl: async () => ({ status: 200, contentType: "text/html", text: html404 }),
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.match(error.message, /carrying no BEGIN:VCALENDAR/);
      assert.match(error.message, /a status is not a document/);
      return true;
    },
  );
});

test("A-003 · a rung-4 200 with an EMPTY body is a WALL — the case challengeIn cannot see", async () => {
  await assert.rejects(
    politeGetText("https://town.example/export.ics", {
      fetchImpl: refuse403 as unknown as typeof fetch,
      ladder: {
        curl: async () => ({ status: 200, contentType: "", text: "   \n  " }),
      },
    }),
    /an empty body/,
  );
});

test("A-003 · the rung-4 curl fallback is validated too — it used to be returned raw", async () => {
  await assert.rejects(
    politeGetText("https://town.example/export.ics", {
      fetchImpl: refuse403 as unknown as typeof fetch,
      expect: { label: "an .ics feed", marker: "BEGIN:VCALENDAR" },
      ladder: {
        // Node's client is refused, so the same identity is asked through
        // curl — which answers 200 with a page that is not the feed.
        curl: async () => ({ status: 200, contentType: "text/html", text: html404 }),
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.equal(error.rung, 4, "the refusal has to name the rung that produced it");
      assert.match(error.message, /WALL on rung 4/);
      return true;
    },
  );
});

test("A-003 · a rung-4 200 that IS the document still succeeds, and reports rung 4's bytes", async () => {
  const feed = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Selectboard\nEND:VEVENT\nEND:VCALENDAR";
  const got = await politeGetText("https://town.example/export.ics", {
    fetchImpl: refuse403 as unknown as typeof fetch,
    expect: { label: "an .ics feed", marker: "BEGIN:VCALENDAR" },
    ladder: {
      curl: async () => ({ status: 200, contentType: "text/calendar", text: feed }),
    },
  });
  assert.equal(got.text, feed);
  assert.equal(got.contentType, "text/calendar");
});

test("A-003 · injecting a fetchImpl alone still does NOT walk the ladder", async () => {
  // A test's fake fetch is the thing under test: without `ladder`, a 403 is a 403.
  await assert.rejects(
    politeGetText("https://town.example/export.ics", {
      fetchImpl: refuse403 as unknown as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.equal(error.status, 403);
      assert.equal(error.rung, 2, "no rung above 2 was walked, and the error says so");
      return true;
    },
  );
});

/** Counting the return sites stops a future rung returning the transport triple beside the finalizer rather than through it. */
test("A-003 · politeGetText has exactly ONE place a body becomes a return value", () => {
  const source = readFileSync(join(HERE, "..", "lib", "sources", "http.ts"), "utf8");
  const body = source.slice(
    source.indexOf("export async function politeGetText"),
    source.indexOf("/** One polite GET returning parsed JSON. */"),
  );
  assert.ok(body.length > 500, "the slice missed politeGetText — this guard is stale");

  const finalized = body.match(/return readValidatedResponse\(/g) ?? [];
  assert.ok(finalized.length >= 1, "the identified request routes through the finalizer");
  const rung4 = source.slice(source.indexOf("async function curlRung"), source.indexOf("export async function politeGetText"));
  assert.match(rung4, /return readValidatedResponse\(url, 4,/, "rung 4 returns only through the finalizer");
  assert.equal((body.match(/return await curlRung\(/g) ?? []).length >= 1, true, "and politeGetText reaches rung 4 only through curlRung");
  assert.doesNotMatch(source, /Mozilla\/5\.0|Chrome\/\d/, "no borrowed browser identity on any rung (2026-09-25)");

  // A bare object return of the transport triple is the shape that was wrong.
  const bare = body.match(/return\s*\{\s*\n?\s*status:/g) ?? [];
  assert.deepEqual(
    bare,
    [],
    "a rung returns a body without passing the finalizer — that is A-003 returning",
  );
});
