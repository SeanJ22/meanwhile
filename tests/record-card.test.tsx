import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordCard } from "../components/ui/record-card.tsx";
import { PublicRecords } from "../components/map/public-records.tsx";
import { OfficeCard } from "../components/map/popup/office-card.tsx";
import type { PublicRecord } from "../lib/civic-data/types.ts";
import { venueLink } from "../lib/registry/links.ts";

const division = "ocd-division/country:us/state:az/place:example";
const record: PublicRecord = { id: "fixture:record", kind: "PUBLIC_RECORD", bodyId: null, ocdId: division, title: "Public notice", kindLabel: "Notice", sourceSentence: "The public may comment on this proposal.", sourceUrl: "https://records.example.gov/notice", capturedAt: "2026-10-05T01:00:00Z" };
test("plain records use the shared Card; read dates and URLs only occur in Sources", () => {
  const html = renderToStaticMarkup(<RecordCard record={record} />);
  const [face, sources] = html.split('data-card-sources=""');
  assert.match(face, /Public notice/);
  assert.match(face, /The public may comment/);
  assert.match(face, /data-public-record="fixture:record"/);
  assert.ok(!face.includes(record.sourceUrl));
  assert.ok(!face.includes("2026-10-05"));
  assert.ok(sources.includes(record.sourceUrl));
  assert.match(sources, /2026-10-05/);
});
test("a place never shows another jurisdiction's record or claims another body's record", () => {
  const records = [record, { ...record, id: "fixture:elsewhere", ocdId: `${division}_other` }, { ...record, id: "fixture:body", bodyId: "fixture:body" }];
  const html = renderToStaticMarkup(<PublicRecords divisionId={division} records={records} />);
  assert.match(html, /fixture:record/);
  assert.match(html, /fixture:body/);
  assert.ok(!html.includes("fixture:elsewhere"));
  const bodyHtml = renderToStaticMarkup(<PublicRecords divisionId={division} bodyId="fixture:body" records={records} />);
  assert.ok(!bodyHtml.includes('data-public-record="fixture:record"'));
  assert.match(bodyHtml, /fixture:body/);
});
test("office directions use venueLink while the published address, hours and contacts stay native", () => {
  const office = { id: "fixture:office", ownerId: "fixture:school", name: "School district", kind: "BODY_OFFICE" as const, address: "400 Example Street", hours: "Mon–Fri, 9 am–4 pm", phone: "555-0101", sourceUrl: record.sourceUrl, sourceOrg: "School district", collectedAt: record.capturedAt, lat: 33.4, lng: -112.1 };
  const site = { id: "fixture:site", name: office.name, address: office.address, lat: office.lat, lng: office.lng, offices: [office] };
  const html = renderToStaticMarkup(<OfficeCard site={site} />);
  const [face, sources] = html.split('data-card-sources=""');
  assert.match(face, /400 Example Street/);
  assert.match(face, /Mon–Fri, 9 am–4 pm/);
  assert.match(face, /tel:5550101/);
  assert.ok(face.includes(venueLink(office)!.url.replace(/&/g, "&amp;")));
  assert.ok(!face.includes(office.sourceUrl));
  assert.ok(sources.includes(office.sourceUrl));
});
