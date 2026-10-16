import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

import { normalizeWithDrops, publicVideoUrl, type LegistarEventWithClient } from "../lib/sources/legistar/index.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import { meetingCardSources } from "../lib/officials/card-sources.ts";

const EVENTS = JSON.parse(
  readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8"),
) as LegistarEvent[];
const NOW = new Date("2026-08-12T22:00:00.000Z");
const VIDEO = "https://pima.granicus.com/MediaPlayer.php?view_id=2&clip_id=1823";

function normalizeOne(overrides: Partial<LegistarEvent>) {
  const event = { ...EVENTS.find((e) => e.EventId === 1823)!, ...overrides };
  const raw: LegistarEventWithClient[] = [{ event, slug: "pima", collectedAt: NOW.toISOString(), items: null }];
  return normalizeWithDrops(raw, NOW).meetings[0]!;
}

test("BX-10: a public recording on the publisher's record becomes the meeting's videoUrl", () => {
  const meeting = normalizeOne({ EventVideoStatus: "Public", EventVideoPath: VIDEO });
  assert.equal(meeting.videoUrl, VIDEO);
  assert.equal(meeting.status, "CONCLUDED");
});

test("BX-10: no video, a video that is not public, or an unsafe address yields no videoUrl", () => {
  assert.equal("videoUrl" in normalizeOne({ EventVideoPath: null, EventVideoStatus: null }), false);
  assert.equal("videoUrl" in normalizeOne({ EventVideoPath: VIDEO, EventVideoStatus: "Not Viewable" }), false);
  assert.equal(publicVideoUrl({ ...EVENTS[0]!, EventVideoStatus: "Public", EventVideoPath: "javascript:alert(1)" }), null);
  assert.equal(publicVideoUrl({ ...EVENTS[0]!, EventVideoStatus: "Public", EventVideoPath: "http://pima.granicus.com/x" }), null);
  assert.equal(publicVideoUrl({ ...EVENTS[0]!, EventVideoStatus: "Public", EventVideoPath: "https://user:pw@pima.granicus.com/x" }), null);
  assert.equal(publicVideoUrl({ ...EVENTS[0]!, EventVideoStatus: "Public", EventVideoPath: "  " }), null);
});

test("BX-10: the meeting card's Sources names the publisher record the recording is linked from", () => {
  const meeting = normalizeOne({ EventVideoStatus: "Public", EventVideoPath: VIDEO });
  const sources = meetingCardSources(meeting, []);
  const minutes = meeting.publishedLinks!.find(link => link.kind === "MINUTES")!;
  assert.ok(minutes, "the publisher also links this sitting's minutes");
  assert.deepEqual(sources.map(source => source.provenance.sourceUrl).sort(),
    [meeting.provenance.sourceUrl, meeting.agendaUrl, minutes.href].sort(), "the recording shares its publisher record; agenda and minutes retain their own source URLs");
  const publisher = sources.find(source => source.provenance.sourceUrl === meeting.provenance.sourceUrl)!;
  assert.match(publisher.what, /The recording of this sitting/, "the recording's coverage is named behind its publisher record");
  assert.doesNotMatch(publisher.what, /and \d+ more from this source/);
  assert.match(sources.find(source => source.provenance.sourceUrl === minutes.href)!.what, /document contents not yet read/);
  const without = meetingCardSources(normalizeOne({ EventVideoPath: null }), []);
  assert.doesNotMatch(without[0]!.what, /recording/);
});

test("BX-10: the map's meeting row shows the recording link only on a concluded sitting that has one", async () => {
  const { MeetingRow } = await tsImport("../components/ui/meeting-row.tsx", import.meta.url) as typeof import("../components/ui/meeting-row.tsx");
  const meeting = normalizeOne({ EventVideoStatus: "Public", EventVideoPath: VIDEO });
  const concluded = renderToStaticMarkup(createElement(MeetingRow, { meeting }));
  assert.match(concluded, /href="https:\/\/pima\.granicus\.com\/MediaPlayer\.php\?view_id=2&amp;clip_id=1823"[^>]*>Watch the recording/);
  for (const status of ["SCHEDULED", "CANCELED"] as const) {
    assert.doesNotMatch(renderToStaticMarkup(createElement(MeetingRow, { meeting: { ...meeting, status } })), /Watch the recording/);
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(MeetingRow, { meeting: normalizeOne({ EventVideoPath: null, EventVideoStatus: null }) })), /Watch the recording/);
});

test("BX-10: Pima's shape (public, clip id in EventMedia, no path) links the sitting's own Legistar page", () => {
  const page = "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1823&GID=243";
  const meeting = normalizeOne({ EventVideoStatus: "Public", EventVideoPath: null, EventMedia: "2027", EventInSiteURL: page });
  assert.equal(meeting.videoUrl, page);
  assert.equal("videoUrl" in normalizeOne({ EventVideoStatus: "Not Available", EventVideoPath: null, EventMedia: "2027", EventInSiteURL: page }), false);
  assert.equal("videoUrl" in normalizeOne({ EventVideoStatus: "Public", EventVideoPath: null, EventMedia: null, EventInSiteURL: page }), false);
});
