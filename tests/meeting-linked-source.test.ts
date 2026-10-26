import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { linkedMeetingSourceInputs, linkedMeetingSourceIssue, meetingPageLinksTo } from "../lib/civic-data/meeting-linked-source.ts";
import { derivedSourceContentHash } from "../lib/civic-data/derived-source-hash.ts";
import type { DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import type { RetainedSourceResponse } from "../lib/civic-data/retained-meeting-bytes.ts";

const at = "2026-10-26T12:00:00.000Z", calendar = "https://city.example.gov/calendar", agenda = "https://documents.example.net/agenda.pdf";
const page = (url: string, body: string): RetainedSourceResponse => ({ source: "ical", requestedUrl: url, finalUrl: url, httpStatus: 200,
  rawHash: createHash("sha256").update(body).digest("hex"), bytes: new TextEncoder().encode(body), byteCount: Buffer.byteLength(body), retrievedAt: at, contentType: "text/html" });
const retained = (pages: readonly RetainedSourceResponse[]) => pages.map(({ bytes, ...metadata }) => ({ ...metadata, base64: Buffer.from(bytes).toString("base64") }));

test("a derived agenda host requires the exact official page's actual link and retained bytes", () => {
  const source = page(calendar, `<a href="${agenda}">Agenda</a>`), document = page(agenda, "Agenda version one");
  const root: Extract<DerivedInputRef, {kind:"MEMBER_ACQUISITION"}> = { kind: "MEMBER_ACQUISITION", memberKey: "one-body", requestedUrl: calendar,
    finalUrl: calendar, rawHash: source.rawHash, httpStatus: 200, retrievedAt: at };
  const linked = linkedMeetingSourceInputs({ memberKey: "one-body", officialHost: "city.example.gov", roots: [root], pages: [source, document], horizonDay: at.slice(0,10) });
  assert.deepEqual(linked.unlinked, []); assert.equal(linked.inputs.length, 1);
  const ref = linked.inputs[0]!;
  assert.equal(linkedMeetingSourceIssue(ref, "city.example.gov", [root, ref], retained([source, document])), null);
  assert.match(linkedMeetingSourceIssue(ref, "city.example.gov", [root, ref], retained([document]))!, /LINK_BYTES_MISSING/);
  const altered = { ...source, bytes: new TextEncoder().encode("No agenda link here") };
  assert.match(linkedMeetingSourceIssue(ref, "city.example.gov", [root, ref], retained([altered, document]))!, /LINK_BYTES_MISMATCH/);
  assert.notEqual(derivedSourceContentHash([root, ref]), derivedSourceContentHash([root, { ...ref, rawHash: page(agenda, "Agenda version two").rawHash }]));
  assert.equal(derivedSourceContentHash([root, ref]), derivedSourceContentHash([root, { ...ref, retrievedAt: "2026-10-26T12:30:00.000Z" }]));
});

test("an acquired foreign page or a self-referencing chain cannot authorize itself", () => {
  const source = page(calendar, "<p>No agenda published</p>"), document = page(agenda, "Agenda");
  const root: Extract<DerivedInputRef, {kind:"MEMBER_ACQUISITION"}> = { kind: "MEMBER_ACQUISITION", memberKey: "one-body", requestedUrl: calendar,
    finalUrl: calendar, rawHash: source.rawHash, httpStatus: 200, retrievedAt: at };
  assert.deepEqual(linkedMeetingSourceInputs({ memberKey: "one-body", officialHost: "city.example.gov", roots: [root], pages: [source, document], horizonDay: at.slice(0,10) }).unlinked, [agenda]);
  const circular = { ...root, requestedUrl: agenda, finalUrl: agenda, rawHash: document.rawHash,
    linkedFrom: { requestedUrl: agenda, finalUrl: agenda, rawHash: document.rawHash } };
  assert.match(linkedMeetingSourceIssue(circular, "city.example.gov", [circular], retained([document]))!, /HOST_NOT_ATTESTED/);
  assert.ok(meetingPageLinksTo(new TextEncoder().encode('<a href="/agenda?id=1&amp;body=2">Agenda</a>'), calendar, "https://city.example.gov/agenda?id=1&body=2"));
});
