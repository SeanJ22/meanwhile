import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import {
  makeSchedulePageSource,
  parseNextMeetingLine,
  parseNoticeFeed,
} from "../lib/sources/schedulepage/index.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", "schedulepage", name), "utf8");
const FEED = fixture("newbury-library-feed-2026-09-24.xml");
const ENERGY = fixture("newbury-energy-committee-home-2026-09-24.html");

test("the library's feed yields one sitting per trustees notice and counts every other post", () => {
  const { sittings, counts } = parseNoticeFeed(FEED, "Trustee");
  assert.deepEqual(
    sittings.map((s) => [s.date, s.time, s.place]),
    [
      ["2026-04-14", { hour: 17, minute: 0 }, "Newbury Public Library"],
      ["2026-05-12", { hour: 17, minute: 0 }, "Newbury Public Library"],
      ["2026-06-16", { hour: 17, minute: 0 }, "Newbury Public Library"],
      ["2026-07-14", { hour: 17, minute: 0 }, "Newbury Public Library"],
      ["2026-08-11", { hour: 17, minute: 0 }, "Newbury Public Library"],
      ["2026-09-08", { hour: 17, minute: 0 }, "Newbury Public Library"],
    ],
  );
  assert.deepEqual(counts, { notSittings: 4, undated: 0 }, "the scavenger hunt, summer reading, poetry winners and the job post");
  assert.ok(sittings.every((s) => !s.canceled));
});

test("a notice with no year takes the year after its own posting", () => {
  const item = (pubDate: string, text: string) =>
    `<item><title>PUBLIC NOTICE: Trustees Meeting</title><pubDate>${pubDate}</pubDate><content:encoded><![CDATA[<p>${text}</p>]]></content:encoded></item>`;
  const december = parseNoticeFeed(
    `<rss><channel>${item("Mon, 21 Dec 2026 15:00:00 +0000", "There will be a Board of Trustee Meeting on Tuesday January 12th, 5pm at the Newbury Public Library.")}</channel></rss>`,
    "Trustee",
  );
  assert.equal(december.sittings[0]?.date, "2027-01-12");
  const canceled = parseNoticeFeed(
    `<rss><channel>${item("Mon, 05 Oct 2026 15:00:00 +0000", "The Board of Trustee Meeting on Tuesday October 13th, 5pm at the Newbury Public Library is CANCELLED.")}</channel></rss>`,
    "Trustee",
  );
  assert.equal(canceled.sittings[0]?.canceled, true);
  const undated = parseNoticeFeed(
    `<rss><channel>${item("Mon, 05 Oct 2026 15:00:00 +0000", "The Trustees will meet next month.")}</channel></rss>`,
    "Trustee",
  );
  assert.deepEqual(undated.counts, { notSittings: 0, undated: 1 });
});

test("the Energy Committee's home page yields its next sitting in its own words", () => {
  const { sittings, counts } = parseNextMeetingLine(ENERGY);
  assert.equal(sittings.length, 1);
  const [next] = sittings;
  assert.equal(next!.date, "2026-10-21");
  assert.deepEqual(next!.time, { hour: 16, minute: 0 });
  assert.equal(next!.note, "(tentative date)");
  assert.match(next!.place ?? "", /^Town Offices Meeting Room/);
  assert.deepEqual(counts, { notSittings: 0, undated: 0 });
  assert.deepEqual(parseNextMeetingLine("<p>Next Meeting Date: to be announced</p>").counts, { notSittings: 0, undated: 1 });
  assert.deepEqual(parseNextMeetingLine("<p>No schedule here.</p>").sittings, []);
});

test("both rows reach readers as sittings of their registered bodies", async () => {
  const rows = SOURCE_WIRING.filter((row) =>
    row.config.slug === "newbury-library-trustees-notices" || row.config.slug === "newbury-energy-committee-page");
  assert.equal(rows.length, 2, "both rows are wired");
  const pages: Record<string, string> = {
    "https://newburynhlibrary.net/feed/": FEED,
    "https://www.newburyenergynh.org/": ENERGY,
  };
  const fetchImpl = (async (input: string | URL | Request) => {
    const body = pages[String(input)];
    if (body === undefined) throw new Error(`no recorded page for ${String(input)}`);
    return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }) as typeof fetch;
  const source = makeSchedulePageSource(rows, fetchImpl);
  // Neither shape walks month pages, so the query only has to be a valid one.
  const raw = await source.fetch({ lat: 43.32, lng: -72.03, radiusKm: 40 });
  const now = new Date("2026-09-24T18:30:00Z");
  const { meetings } = source.normalizeWithDrops(raw, now);

  const trustees = meetings.filter((m) => m.bodyId?.endsWith("#library-trustees"));
  assert.deepEqual(trustees.map((m) => m.id).slice(-2), [
    "schedulepage:newbury-library-trustees-notices:2026-08-11",
    "schedulepage:newbury-library-trustees-notices:2026-09-08",
  ]);
  const sept = trustees.find((m) => m.id.endsWith("2026-09-08"))!;
  assert.equal(sept.startsAt, "2026-09-08T17:00:00-04:00");
  assert.equal(sept.status, "CONCLUDED");
  assert.equal(sept.title, "Newbury Public Library Trustees");
  assert.equal(sept.provenance.sourceUrl, "https://newburynhlibrary.net/feed/");
  assert.equal(sept.provenance.sourceOrg, "Newbury Public Library Board of Trustees");
  if (!sept.location) {
    assert.deepEqual(sept.venueGap?.publishedText, "Newbury Public Library", "an unplaced room is named in the publisher's words");
  }

  const energy = meetings.filter((m) => m.bodyId?.endsWith("#energy-committee"));
  assert.equal(energy.length, 1);
  assert.equal(energy[0]!.id, "schedulepage:newbury-energy-committee-page:2026-10-21");
  assert.equal(energy[0]!.startsAt, "2026-10-21T16:00:00-04:00");
  assert.equal(energy[0]!.status, "SCHEDULED");
  assert.equal(energy[0]!.title, "Newbury Energy Committee", "a bare parenthetical is not a title");
  assert.equal(energy[0]!.provenance.sourceUrl, "https://www.newburyenergynh.org/");
});
