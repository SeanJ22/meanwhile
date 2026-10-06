import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { normalizeWithDrops, publicVideoUrl, type LegistarEventWithClient } from "../lib/sources/legistar/index.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import { meetingCardSources } from "../lib/officials/card-sources.ts";

/** BX-10: a concluded meeting links the recording its publisher's own record gives. */

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
  assert.equal(sources.length, 2, "the recording and sitting share one publisher record; the agenda has its own source URL");
  assert.equal(sources[1]!.provenance.sourceUrl, meeting.agendaUrl);
  assert.equal(sources[0]!.provenance.sourceUrl, meeting.provenance.sourceUrl);
  assert.match(sources[0]!.what, /and 1 more from this source/, "the recording is counted behind that record");
  const without = meetingCardSources(normalizeOne({ EventVideoPath: null }), []);
  assert.doesNotMatch(without[0]!.what, /more from this source/);
});

test("BX-10: the map's meeting row shows the recording link only on a concluded sitting that has one", () => {
  const source = readFileSync(new URL("../components/ui/meeting-row.tsx", import.meta.url), "utf8");
  assert.match(source, /meeting\.status === "CONCLUDED" && meeting\.videoUrl[\s\S]{0,200}href=\{meeting\.videoUrl\}/);
  assert.match(source, /Watch the recording/);
});
