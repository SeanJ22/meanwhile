import assert from "node:assert/strict";
import test from "node:test";

import { SourceHttpError, notADocument, politeGetText } from "../lib/sources/http.ts";
import { accountedNormalize } from "../lib/sources/normalize-account.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { isSourceAcquisitionFailure, sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";

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

test("shared release acquisition refuses empty and wrong-format documents before retaining source evidence", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const acquire = (body: string) => acquireKnownRelease({
    sourceId: "fixture-calendar", releaseId: "current", parserVersion: "ical/1",
    url: "https://publisher.example/calendar.ics", signal: AbortSignal.timeout(10_000),
    maxBytes: 1024, checkAfterMs: 86_400_000, store, locks, fetchImpl: serving(body),
    validate(bytes) {
      const invalid = notADocument(new TextDecoder().decode(bytes), { label: "a calendar feed", marker: "BEGIN:VCALENDAR" });
      if (invalid) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", invalid);
    },
  });
  for (const body of ["", " \n\t ", "<html>temporarily unavailable</html>"]) {
    await assert.rejects(acquire(body), (error: unknown) => {
      assert.ok(isSourceAcquisitionFailure(error));
      assert.equal(error.code, "PUBLISHER_DOCUMENT_INVALID");
      return true;
    });
    assert.deepEqual(await store.list("project/"), [], "an HTTP 200 wall creates no source body or current release pointer");
  }
  const calendar = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";
  assert.equal(new TextDecoder().decode((await acquire(calendar)).bytes), calendar,
    "a real calendar with no events is still valid source evidence");
});
