import test from "node:test";
import assert from "node:assert/strict";
import { campaignOfficeFrom, fromBodyOffice, fromMemberOffice, locationsForOwner, officeHoursFrom, officeLocation, officeLocationLine } from "../lib/officials/office-locations.ts";
import { contactForOfficeLocation, contactRecord } from "../lib/ask/contacts.ts";

const src = "https://example.gov/page";

test("a campaign address counts only when labeled an office or headquarters", () => {
  const page = "Contact us\nMailing address: 12 Elm St, Tucson, AZ 85701\nCampaign Office: 400 Main St Suite 2, Tucson, AZ 85705\nOffice hours: Mon-Fri 9am-5pm";
  const loc = campaignOfficeFrom({ ownerId: "c1", pageText: page, sourceUrl: src });
  assert.equal(loc?.address, "400 Main St Suite 2, Tucson, AZ 85705");
  assert.equal(loc?.kind, "CAMPAIGN_OFFICE");
  assert.equal(loc?.hours, "Mon-Fri 9am-5pm");
  assert.equal(campaignOfficeFrom({ ownerId: "c1", pageText: "Mailing address: 12 Elm St, Tucson, AZ 85701", sourceUrl: src }), null);
});

test("a campaign address equal to the filed mailing address is refused", () => {
  const page = "Headquarters: 12 Elm Street, Tucson, AZ 85701";
  assert.equal(campaignOfficeFrom({ ownerId: "c1", pageText: page, sourceUrl: src, filedMailingAddress: "12 Elm St., Tucson AZ 85701" }), null);
  assert.ok(campaignOfficeFrom({ ownerId: "c1", pageText: page, sourceUrl: src, filedMailingAddress: "PO Box 9, Tucson, AZ 85701" }));
});

test("an office needs an address and an https source", () => {
  assert.equal(officeLocation({ ownerId: "b", kind: "BODY_OFFICE", address: "City Hall", sourceUrl: src }), null);
  assert.equal(officeLocation({ ownerId: "b", kind: "BODY_OFFICE", address: "1 Main St, Vail, AZ 85641", sourceUrl: "http://x" }), null);
  assert.equal(officeLocation({ ownerId: "b", kind: "NOPE", address: "1 Main St, Vail, AZ 85641", sourceUrl: src }), null);
});

test("member offices and body offices become the one shape", () => {
  const member = fromMemberOffice({ id: "m", kind: "MEMBER_OFFICE", officeholderId: "h1", officeKind: "DISTRICT",
    office: { address: "680 Broadway", city: "Paterson", state: "NJ", zip: "07514", phone: "973-555-0100", lat: null, lng: null },
    sourceUrl: src, sourceOrg: "Open States", official: false, collectedAt: "2026-10-01" });
  assert.equal(member?.kind, "DISTRICT_OFFICE");
  assert.equal(member?.address, "680 Broadway, Paterson, NJ 07514");
  const body = fromBodyOffice({ bodyId: "b1", address: "1 Main St, Vail, AZ 85641", phone: "520-555-0101", sourceUrl: src });
  assert.equal(body?.kind, "BODY_OFFICE");
  assert.deepEqual(locationsForOwner([body!, member!], "b1").map(r => r.kind), ["BODY_OFFICE"]);
});

test("hours are read only when the page gives them", () => {
  assert.equal(officeHoursFrom("Hours: Monday to Friday, 8 a.m. to 5 p.m."), "Monday to Friday, 8 a.m. to 5 p.m.");
  assert.equal(officeHoursFrom("Come visit us soon"), null);
});

test("Ask's contact record carries the address and hours with the page as its source", () => {
  const loc = fromBodyOffice({ bodyId: "b1", address: "1 Main St, Vail, AZ 85641", phone: "520-555-0101", sourceUrl: src, sourceOrg: "Vail USD" })!;
  const record = contactRecord(contactForOfficeLocation({ ...loc, hours: "Mon-Fri 8am-4pm" }, "Vail School District", "Office of Vail School District"));
  assert.match(record.text, /1 Main St, Vail, AZ 85641/);
  assert.match(record.text, /Hours: Mon-Fri 8am-4pm/);
  assert.equal(record.sourceUrl, src);
  assert.match(officeLocationLine(loc), /^Office: 1 Main St/);
});
