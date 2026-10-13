import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeEscribeSource, parseEscribeMeetings, escribeCalendarUrl } from "../lib/sources/escribe/index.ts";
import { dataDoorConfig } from "../lib/civic-data/derived-door-kinds.ts";
import { meetingAcquisitionFailureDomain } from "../lib/civic-data/meeting-partitions.ts";
import { buildCompositeSource } from "../lib/sources/composite/wiring.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { reviewDiscoveryWalk, type HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { wiringShapeFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

const NOW = "2026-10-13T12:00:00Z";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/escribe/${name}`, import.meta.url), "utf8");
const wiring = (slug: string, types: string): BodySourceWiring => {
  const meta = JSON.parse(fixture(`${slug}.meta.json`));
  return { bodyId: `fixture:${slug}:${types}`, ocdId: `ocd-division/country:us/state:${meta.state.toLowerCase()}/place:${slug}`,
    agendaSourceType: "ESCRIBE", jurisdiction: `${slug}, ${meta.state}`, publishingOrg: slug, timeZone: meta.timeZone,
    config: { portalUrl: new URL(meta.sourceUrl).origin, slug: `${slug}-${types}`, bodyName: types, meetingTypes: types }, verifiedAt: NOW };
};

for (const slug of ["lamesa", "capecoral", "detroitmi"]) test(`real ${slug} calendar retains every meeting, body and document link`, () => {
  const text = fixture(`${slug}.json`), rows = parseEscribeMeetings(text);
  assert.equal(createHash("sha256").update(text).digest("hex"), JSON.parse(fixture(`${slug}.meta.json`)).sha256);
  const types = [...new Set(rows.map(row => row.MeetingType))];
  const raw = types.map(type => ({ wiring: wiring(slug, type), text, collectedAt: NOW }));
  const output = makeEscribeSource(raw.map(row => row.wiring)).normalizeWithDrops(raw, new Date(NOW));
  assert.equal(output.meetings.length, rows.length);
  assert.equal(output.accounting.outcome, "CONSERVED");
  for (const row of rows) {
    const meeting = output.meetings.find(m => m.id.endsWith(row.ID))!;
    assert.ok(meeting);
    assert.equal(meeting.bodyName, row.MeetingType);
    assert.equal(meeting.publishedLinks?.length, row.MeetingDocumentLink.filter(d => d.Url).length);
    assert.equal(meeting.startsAt.slice(0, 19), row.StartDate.slice(0, 19).replaceAll("/", "-").replace(" ", "T"));
    assert.equal(Boolean(meeting.agendaUrl), row.MeetingDocumentLink.some(d => ["Agenda", "Merged", "AgendaCover", "MergedCover"].includes(d.Type) && d.Url));
  }
});

test("eScribe cancellation documents keep the sitting visible as canceled", () => {
  const text = fixture("lamesa.json"), row = parseEscribeMeetings(text)[0];
  const w = wiring("lamesa", row.MeetingType);
  const [m] = makeEscribeSource([w]).normalize([{ wiring: w, text, collectedAt: NOW }], new Date(NOW));
  assert.equal(m.status, "CANCELED");
  assert.equal(m.agendaUrl, null);
  assert.match(m.publishedLinks![0].label, /Cancellation/);
});

test("two bodies on one tenant share the cheap calendar request and bind in the composite", async () => {
  const text = fixture("lamesa.json");
  const rows = [wiring("lamesa", "City Council"), wiring("lamesa", "Planning Commission")];
  const seen: string[] = [];
  const composite = buildCompositeSource({ derivedRows: rows, fetchImpl: (async (url, init) => {
    seen.push(String(url)); assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { calendarStartDate: "2026-07-15", calendarEndDate: "2027-01-15" });
    return new Response(text);
  }) as typeof fetch });
  const result = composite.normalize(await composite.fetch({ lat: 32, lng: -117, radiusKm: 25, startsAfter: "2026-07-15", startsBefore: "2027-01-15" }), new Date(NOW));
  assert.deepEqual(seen, [escribeCalendarUrl(rows[0].config.portalUrl)]);
  assert.ok(result.some(m => m.bodyId === rows[0].bodyId));
  assert.ok(result.some(m => m.bodyId === rows[1].bodyId));
  assert.equal(meetingAcquisitionFailureDomain("escribe", rows[0]), "meeting-upstream:pub-lamesa.escribemeetings.com");
});

test("eScribe rejects changed shapes and accounts for invalid dates and foreign bodies", () => {
  assert.throws(() => parseEscribeMeetings("{}"));
  assert.throws(() => parseEscribeMeetings('{"d":[{}]}'));
  const row = parseEscribeMeetings(fixture("lamesa.json"))[0], w = wiring("lamesa", row.MeetingType);
  const output = makeEscribeSource([w]).normalizeWithDrops([{ wiring: w, text: JSON.stringify({ d: [{ ...row, StartDate: "2026/02/31 12:00:00" }, { ...row, MeetingType: "Other Board" }] }), collectedAt: NOW }]);
  assert.equal(output.meetings.length, 0);
  assert.equal(output.drops.unplaceableInTime, 1);
  assert.equal(output.drops.notConfigured, 1);
});

test("a census discovery walk automatically reviews the real tenant's governing body and commissions", async () => {
  const w = wiring("lamesa", "City Council"), route = escribeCalendarUrl(w.config.portalUrl);
  const bodies = new Map<string, HeldBytes>();
  const attempt = await walkMeetingsDiscoveryNeed({ jurisdictionId: "ca:city:la-mesa", stateCode: "CA", name: "City of La Mesa", govClass: "CITY_OR_TOWN", ownWebAddress: "https://fixture.gov", basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "OPERATIONAL_REFERENCE", versionId: "ref-1" } }, {
    open: async input => {
      const body = input.url.endsWith("robots.txt") ? "User-agent: *\nDisallow: /\n" : input.url === "https://fixture.gov/" ? `<h1>City of La Mesa</h1><a href="${w.config.portalUrl}">Meetings</a>` : input.url === route ? fixture("lamesa.json") : "";
      if (input.url === route) { assert.equal(input.method, "POST"); assert.ok(JSON.parse(input.body!).calendarStartDate); }
      return { status: body ? 200 : 404, body, bytes: body.length, contentType: input.url === route ? "application/json" : "text/html", location: null, transportError: null };
    }, spaceOut: async () => {}, now: () => NOW, budget: { spent: () => false },
    vault: async (artifact, text) => { bodies.set(artifact.id, { text, sha256: artifact.contentHash.slice(7), evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt } }); return { stored: true, where: `vault/${artifact.id}`, why: "saved" }; },
  });
  assert.ok(attempt.found.some(f => f.vendor === "escribe"));
  const review = reviewDiscoveryWalk({ walk: { attempt, recordId: "walk-1", recordedAt: NOW }, registered: { bodyId: `${w.ocdId}#governing`, ocdId: w.ocdId!, publishingOrg: "City of La Mesa", input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-CA:registration:v1", versionId: "reg-1", readModelSha256: "a".repeat(64), promotedAt: NOW } }, held: id => bodies.get(id) ?? null, handWired: () => false, reviewer: "auto-crosswalk-reviewer@0123456789ab", now: NOW });
  assert.ok(review.accepted.some(r => r.row.bodyRole === "GOVERNING"), JSON.stringify(review.held));
  assert.ok(review.accepted.some(r => /Planning Commission/.test(r.row.bodyName)));
  assert.deepEqual(wiringShapeFor({ vendor: "escribe", url: route }), { kind: "ESCRIBE", endpoint: { portalUrl: w.config.portalUrl } });
  assert.equal(dataDoorConfig({ kind: "ESCRIBE", route, slug: "la-mesa", bodyName: "City Council", filter: { meetingTypes: "City Council|City Council Special Meeting" } }).portalUrl, w.config.portalUrl);
});
