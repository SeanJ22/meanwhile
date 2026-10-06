import test from "node:test";
import assert from "node:assert/strict";
import { bodyOffice, directoryOffices, groupOfficePins, namedOffice } from "../lib/map/office-pins.ts";
import { campaignOfficeFrom } from "../lib/officials/office-locations.ts";
import { officePointFor } from "../lib/map/office-geocode.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

const source = { sourceUrl: "https://office.example.gov/contact", sourceOrg: "School district", collectedAt: "2026-10-05", verifiedAt: null };
const body = { bodyId: "fixture:school", name: "School district", officeContact: { address: "400 Example Street, Example, AZ 85001", phone: null, provenance: source } } as CoveredBody;

test("a school office becomes a pin independently of any meetings, with its actual source", () => {
  const office = bodyOffice(body)!;
  assert.equal(office.ownerId, body.bodyId);
  assert.equal(office.sourceUrl, source.sourceUrl);
  assert.equal(office.kind, "BODY_OFFICE");
  assert.equal(bodyOffice({ ...body, officeContact: null }), null);
  assert.equal(bodyOffice({ ...body, officeContact: { ...body.officeContact!, provenance: { ...source, sourceUrl: null } } }), null);
});
test("directory offices retain owner, office kind and saved provenance; mailing fields are not inputs", () => {
  const offices = directoryOffices("fixture:official", "Official", { districtOffices: [{ address: "600 Example Road", city: "Example", state: "AZ", zip: "85001", phone: "555-0101", lat: null, lng: null }], committees: [], officeDetails: [{ ...source, officeKind: "CAPITOL", official: true }] });
  assert.equal(offices[0].kind, "CAPITOL_OFFICE");
  assert.equal(offices[0].address, "600 Example Road, Example, AZ 85001");
  assert.equal(offices[0].collectedAt, source.collectedAt);
  assert.deepEqual(directoryOffices("fixture:official", "Official", { districtOffices: [{ address: "600 Example Road", city: null, state: null, zip: null, phone: null, lat: null, lng: null }], committees: [] }), []);
});
test("campaign pins accept the CA-07 office fact and refuse the filed home before projection", () => {
  const input = { ownerId: "fixture:candidate", pageText: "Campaign Office: 900 Example Street", sourceUrl: source.sourceUrl };
  const location = campaignOfficeFrom(input)!;
  assert.equal(namedOffice(location, "Candidate").kind, "CAMPAIGN_OFFICE");
  assert.equal(campaignOfficeFrom({ ...input, filedMailingAddress: "900 Example St." }), null);
});
test("shared buildings keep all offices behind one reachable marker; dedup is by native owner", () => {
  const office = bodyOffice(body)!;
  const pin = { ...office, lat: 33.4, lng: -112.1 };
  const sites = groupOfficePins([pin, pin, { ...pin, id: "fixture:other:office", ownerId: "fixture:other", name: "Another body" }]);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].offices.length, 2);
  assert.equal(sites[0].address, office.address);
  const suites = groupOfficePins([pin, { ...pin, id: "fixture:suite", address: "400 Example Street, Suite 2, Example, AZ 85001" }]);
  assert.equal(suites.length, 1, "same-point offices stay reachable when the source includes a suite");
  assert.equal(suites[0].address, null);
  assert.ok(suites[0].offices.some(row => row.address.includes("Suite 2")));
});
test("public-office geocoding shares in-flight reads, rejects missing/out-of-range points and retries misses", async () => {
  const original = globalThis.fetch;
  const addresses: string[] = [];
  globalThis.fetch = (async (_url, options) => {
    const address = JSON.parse(String(options?.body)).address;
    addresses.push(address);
    return Response.json(address === "fixture:good" ? { match: true, lat: 33.4, lng: -112.1 } : address === "fixture:invalid" ? { match: true, lat: 100, lng: -112 } : { match: false });
  }) as typeof fetch;
  try {
    const results = await Promise.all([officePointFor("fixture:good"), officePointFor("fixture:good")]);
    assert.deepEqual(results, [{ lat: 33.4, lng: -112.1 }, { lat: 33.4, lng: -112.1 }]);
    assert.equal(addresses.length, 1);
    assert.equal(await officePointFor("fixture:invalid"), null);
    assert.equal(await officePointFor("fixture:miss"), null);
    assert.equal(await officePointFor("fixture:miss"), null);
    assert.equal(addresses.filter(address => address === "fixture:miss").length, 2);
  } finally { globalThis.fetch = original; }
});
