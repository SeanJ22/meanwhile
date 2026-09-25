import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SourceHttpError, notADocument, politeGetText } from "../lib/sources/http.ts";
import { accountedNormalize } from "../lib/sources/normalize-account.ts";

/**
 * **RULING 43, ONE LAYER DOWN — A STATUS IS NOT A DOCUMENT.**
 * (NH Hunt 3, 2026-08-21.)
 *
 * `tests/zero-row-contract.test.ts` holds the NORMALIZE layer: an adapter may
 * not report success with zero rows from a non-zero fetch. RULING 43 states in
 * as many words that the FETCH layer remains uncovered, and on
 * 2026-08-21T13:12Z a scheduled job fell into precisely that gap:
 *
 *     ical: fetched 3 document(s) and extracted 0 meeting(s), with no drop
 *     recorded to account for one
 *
 * `Refresh meetings snapshot` went red. The zero-row contract was working
 * exactly as designed and the defect was upstream of it — `politeGetText`
 * had returned an HTTP 200 whose body carried no `VEVENT`, so `parseIcs`
 * yielded nothing, the drop loop never executed, and there was nothing to
 * count. `challengeIn` catches a 200 that is a KNOWN interstitial; it cannot
 * catch a blank body, a truncated transfer, or an error page this repo has
 * not met.
 *
 * This file holds the two halves of the close:
 *
 * 1. the fetch layer refuses a 200 that is not a document (since 2026-09-25
 *    there is one return path, the identified client; the curl rung is gone);
 * 2. an honest empty — a real calendar with nothing in the served window — is
 *    still allowed through, because turning a quiet town into a red nightly
 *    job would be the WALL-versus-JOB confusion RULING 12 names, pointed at
 *    ourselves.
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
      // The rung is recorded so the next session starts above it rather than
      // re-walking what is already known to fail.
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

/**
 * The other half, and it is not symmetrical decoration.
 *
 * A town whose calendar genuinely holds no sitting in the next sixty days is
 * an honest empty result. Before `outOfWindow` existed, the window filter's
 * `continue` incremented nothing, so that town produced zero meetings and zero
 * drops and the zero-row contract refused it — turning a quiet town into a
 * failed nightly job across every source in the run.
 */
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
 * **THE CLASS, SWEPT.** A named instance is an example of a class-wide defect.
 *
 * The defect was found in `ical`, which reaches the network through the shared
 * client — so the fix went in the shared client and every one of its callers
 * inherited it. That left the adapters that do NOT use it, and the sweep found
 * two: `congress` and `plural` each hand-roll a backoff loop around a bare
 * `fetch`, because each downloads one bulk file rather than walking a portal.
 * Both were accepting a 200 with a blank body as a complete roster — every
 * member of Congress, or a state's whole legislature, reading as absent.
 * Neither is on the meetings path, so neither would have surfaced through the
 * nightly refresh at all. Both are now checked by hand with the same function.
 *
 * So the invariant this asserts is not "everyone uses the shared client" — the
 * first draft of this test claimed that and was wrong, because a bulk download
 * with its own retry policy is a legitimate second shape. It is the narrower
 * and truer one: **a file that reads a network response checks that what came
 * back is a document.**
 *
 * The walk is a filesystem walk rather than ripgrep for the reason recorded in
 * `tests/zero-row-contract.test.ts`: ripgrep skips NUL-byte files and hidden
 * paths and reports nothing found without having looked. It counts what it
 * read, because an operation that can return nothing must be asked what it
 * returned.
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
      /*
       * `await fetch(` is what an actual network call looks like. The first
       * version of this sweep matched `fetch(` and flagged every adapter in
       * the tree, because `ReportingMeetingSource` REQUIRES each one to export
       * a method of that name — a guard that fires on everything says nothing,
       * so it is narrowed to the invocation form and the paths are reported in
       * full rather than as nineteen files all called `index.ts`.
       */
      if (!/await\s+fetch\s*\(/.test(body)) continue;
      direct++;
      if (!body.includes("notADocument")) offenders.push(relative(ROOT, full));
    }
  };
  walk(adapters);

  assert.ok(read > 10, `the sweep must actually read adapters — read ${read}`);
  // The sweep has to FIND the shape it is guarding, or an allowlist that
  // silently matches nothing reads as a clean board. Both known bulk adapters
  // are expected here; a third arriving is fine and simply has to be checked.
  assert.ok(
    direct >= 2,
    `the sweep must find the direct-fetch shape it guards — found ${direct}`,
  );
  assert.deepEqual(
    offenders,
    [],
    `direct network reads with no document check: ${offenders.join(", ")}`,
  );
});

/* ======================================================================== *
 *  A-003 · ONE FINALIZER, AND EVERY RUNG GOES THROUGH IT
 * ======================================================================== */

/**
 * **DOCUMENT VALIDITY USED TO DEPEND ON WHICH RUNG SUCCEEDED.**
 *
 * External correctness audit of `336a3eb`, remediated 2026-08-24. The 403
 * escalation had two return paths that never met `notADocument`: a rung-3
 * browser-header 200 was checked only with `challengeIn`, and the rung-4 curl
 * fallback was returned raw with neither check. The same bytes were refused on
 * rung 2 and accepted on rung 3.
 *
 * **And no test in this repo could reach either**, because the escalation is
 * gated on `!options.fetchImpl` — correctly, so a fake fetch is not routed
 * around, but the effect was a production path that nothing could observe.
 * `options.ladder` is the declared seam: supplying it says *drive the
 * escalation with these doubles*, and omitting it leaves every existing caller
 * exactly where it was.
 */

const html404 = "<html><body><h1>404 Not Found</h1></body></html>";

/** A 403 on the first call — the trigger for the whole escalation. */
const refuse403 = (): Promise<Response> =>
  Promise.resolve(new Response("forbidden", { status: 403 }));

test("A-003 · a 403 is a WALL on rung 2 and nothing escalates: no browser header set, no name-dropping client, no curl (2026-09-25)", async () => {
  let calls = 0;
  const refusing = (async () => {
    calls += 1;
    return new Response("forbidden", { status: 403 });
  }) as unknown as typeof fetch;
  await assert.rejects(
    politeGetText("https://town.example/export.ics", {
      fetchImpl: refusing,
      expect: { label: "an .ics feed", marker: "BEGIN:VCALENDAR" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SourceHttpError);
      assert.equal(error.status, 403);
      assert.equal(error.rung, 2);
      assert.match(error.message, /access control/);
      return true;
    },
  );
  assert.equal(calls, 1, "asked once; an access control is never re-asked under another identity");
});

test("A-003 · injecting a fetchImpl alone still does NOT walk the ladder", async () => {
  // The original guard's purpose, preserved: a test's fake fetch is the thing
  // under test. Without `ladder`, a 403 is a 403 and nothing escalates.
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

/**
 * The structural half. Counting the return sites is what stops a future rung
 * being added with its own `return {status, contentType, text}` beside the
 * finalizer rather than through it — which is exactly how A-003 arrived.
 */
test("A-003 · politeGetText has exactly ONE place a body becomes a return value", () => {
  const source = readFileSync(join(HERE, "..", "lib", "sources", "http.ts"), "utf8");
  const body = source.slice(
    source.indexOf("export async function politeGetText"),
    source.indexOf("/** One polite GET returning parsed JSON. */"),
  );
  assert.ok(body.length > 500, "the slice missed politeGetText — this guard is stale");

  const finalized = body.match(/return readValidatedResponse\(/g) ?? [];
  assert.equal(finalized.length, 1, "the one identified request routes through the finalizer, and there is no other rung");
  assert.doesNotMatch(source, /child_process|"curl"|Mozilla\/5\.0|Chrome\//, "no second client and no borrowed browser identity");

  // A bare object return of the transport triple is the shape that was wrong.
  const bare = body.match(/return\s*\{\s*\n?\s*status:/g) ?? [];
  assert.deepEqual(
    bare,
    [],
    "a rung returns a body without passing the finalizer — that is A-003 returning",
  );
});
