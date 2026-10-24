import assert from "node:assert/strict";
import test from "node:test";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import { ballotHolderSources, mergeBallotPersonHolders } from "../lib/ballot/held-holder.ts";
import { indexByOfficeholderId } from "../lib/officials/lookup.ts";
import { personCardSources } from "../lib/officials/card-sources.ts";
import { syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";

const oldSource = { sourceUrl: "https://governor.example.gov/about", sourceOrg: "Governor's office",
  collectedAt: "2026-10-20", verifiedAt: null };
const newSource = { ...oldSource, sourceUrl: "https://state.example.gov/executive", collectedAt: "2026-10-24" };
function holder(id: string, overrides: Partial<SeatHolder> = {}): SeatHolder {
  return { id, name: "Katie Hobbs", officeTitle: "Governor", partyLabel: null, termEnd: null,
    birthDate: null, websiteUrl: null, sourceUrl: oldSource.sourceUrl, provenance: oldSource,
    email: null, phone: null, contactFormUrl: null, photoUrl: null, campaignUrl: null, ...overrides };
}

test("a held portrait retains its image source alongside the government profile's field source", () => {
  const roster = syntheticFederalDirectory().roster;
  const image = "https://www.congress.gov/img/member/67f0316b1b05a5a598f7fdf3_200.jpg";
  const profile = "https://api.congress.gov/v3/member/H001104?format=json";
  const person = { ...roster.officeholders[0], id: "congress:H001104", name: "Jon Husted",
    fieldSources: { photoUrl: { ...oldSource, sourceUrl: profile } },
    photo: { url: "/api/portraits/officials/held.webp", sourceUrl: image, license: null,
      attribution: "Congress.gov", collectedAt: oldSource.collectedAt } };
  const projected = indexByOfficeholderId([{ ...roster, officeholders: [person] }]).get(person.id)!;
  assert.equal(projected.photoUrl, person.photo.url);
  const urls = personCardSources(projected).map(source => source.provenance.sourceUrl);
  assert.ok(urls.includes(profile));
  assert.ok(urls.includes(image), "the source visible before the person aliases merged must remain in Sources");
});

test("a Congress source slot keeps its native person key for records while all source ids remain aliases", () => {
  const api = holder("congress-api:oh:H001104", { name: "Jon Husted", officeTitle: "U.S. Senator",
    nativeIds: { bioguide: ["H001104"] }, phone: "202-555-0100" });
  const merged = mergeBallotPersonHolders([api])!;
  assert.equal(merged.id, "congress:H001104");
  assert.equal(merged.personId, "congress:H001104");
  assert.ok(merged.personAliases.includes(api.id));
  assert.ok(merged.personAliases.includes(merged.id));
  assert.equal(merged.phone, api.phone);
  assert.deepEqual(ballotHolderSources(merged), [api]);
  assert.deepEqual(mergeBallotPersonHolders([merged]), merged);
  const conflict = mergeBallotPersonHolders([{ ...api, nativeIds: { bioguide: ["H001104", "S001230"] } }])!;
  assert.equal(conflict.id, api.id, "conflicting native keys never select an arbitrary person");
});

test("a verified empty office slot cannot replace its person's held portrait and contact", () => {
  const empty = holder("statewide:az:empty", { provenance: newSource });
  const rich = holder("statewide:az:governor", { photoUrl: "/officials/statewide-az-governor.jpg",
    phone: "602-542-4331", websiteUrl: oldSource.sourceUrl, nativeIds: { reader: ["old-person-card"] } });
  const before = structuredClone([empty, rich]);
  const merged = mergeBallotPersonHolders([empty, rich])!;
  assert.equal(merged.id, rich.id);
  assert.equal(merged.photoUrl, rich.photoUrl);
  assert.equal(merged.phone, rich.phone);
  assert.equal(merged.fieldSources?.photoUrl.sourceUrl, oldSource.sourceUrl);
  assert.deepEqual(new Set(merged.nativeIds?.reader), new Set([empty.id, rich.id, "old-person-card"]));
  assert.deepEqual(ballotHolderSources(merged), [empty, rich]);
  assert.deepEqual([empty, rich], before);
  assert.deepEqual(mergeBallotPersonHolders([merged]), merged, "repeated reads retain the same complement and aliases");
});

test("newer sourced fields supplement the rich person while every source stays available", () => {
  const rich = holder("person-rich", { photoUrl: "/officials/portrait.jpg", phone: "602-555-0100",
    memberships: [{ id: "membership:governor", personId: "person-rich", officeId: "governor", jurisdiction: "US-AZ", sourceUrl: oldSource.sourceUrl }],
    social: [{ platform: "facebook", accountKind: "OFFICIAL", url: "https://facebook.com/governor", sourceUrl: oldSource.sourceUrl, collectedAt: oldSource.collectedAt }] });
  const fresh = holder("person-fresh", { phone: "602-555-0101", email: "governor@example.gov", provenance: newSource,
    social: [{ platform: "youtube", accountKind: "OFFICIAL", url: "https://youtube.com/governor", sourceUrl: newSource.sourceUrl, collectedAt: newSource.collectedAt }] });
  const merged = mergeBallotPersonHolders([fresh, rich])!;
  assert.equal(merged.id, rich.id);
  assert.equal(merged.photoUrl, rich.photoUrl);
  assert.equal(merged.phone, fresh.phone);
  assert.equal(merged.email, fresh.email);
  assert.equal(merged.fieldSources?.phone.sourceUrl, newSource.sourceUrl);
  assert.equal(merged.fieldSources?.photoUrl.sourceUrl, oldSource.sourceUrl);
  assert.deepEqual(merged.memberships, rich.memberships);
  assert.equal(merged.social?.length, 2);
  assert.deepEqual(new Set(ballotHolderSources(merged).map(row => row.provenance?.sourceUrl)), new Set([oldSource.sourceUrl, newSource.sourceUrl]));
  assert.equal(mergeBallotPersonHolders([]), null);
});


test("a newer reference cannot replace current official member fields and the member source is a usable official page", () => {
  const currentUrl = "https://www.azleg.gov/House/House-member/?legislature=57&legislator=2346";
  const priorUrl = "https://www.azleg.gov/House/House-member/?legislature=56&legislator=2274";
  const referenceSource = { sourceUrl: "https://openstates.org/person/betty-villegas", sourceOrg: "Open States",
    collectedAt: "2026-10-24", verifiedAt: null, kind: "REFERENCE" as const };
  const currentSource = { sourceUrl: currentUrl, sourceOrg: "Arizona Legislature", collectedAt: "2026-10-20",
    verifiedAt: null, kind: "OFFICIAL" as const };
  const reference = holder("plural:az:betty", { name: "Betty Villegas", officeTitle: "State Representative",
    websiteUrl: priorUrl, phone: "602-555-0001", photoUrl: "/officials/betty.jpg", provenance: referenceSource,
    sourceUrl: referenceSource.sourceUrl, fieldSources: {websiteUrl: referenceSource, phone: referenceSource} });
  const current = holder("az-legislature:2346", { name: "Betty Villegas", officeTitle: "State Representative",
    websiteUrl: null, phone: "602-555-0002", provenance: currentSource, sourceUrl: currentUrl });
  const merged = mergeBallotPersonHolders([reference, current])!;
  assert.equal(merged.websiteUrl, currentUrl);
  assert.equal(merged.phone, current.phone);
  assert.equal(merged.photoUrl, reference.photoUrl, "complementary portrait remains available");
  assert.equal(merged.fieldSources?.websiteUrl.sourceUrl, currentUrl);
  assert.equal(merged.fieldSources?.phone.sourceUrl, currentUrl);
  assert.equal(ballotHolderSources(merged)[0].websiteUrl, priorUrl, "the source record keeps its published alternative");
  assert.equal(ballotHolderSources(merged)[1].websiteUrl, null, "the original record is not edited");
  assert.deepEqual(mergeBallotPersonHolders([merged]), merged);
});

test("a broad official roster never becomes a person's website and the latest official field wins", () => {
  const rosterUrl = "https://www.azleg.gov/MemberRoster/";
  const first = holder("az-legislature:member", { websiteUrl: null, phone: "602-555-0010",
    sourceUrl: rosterUrl, provenance: { ...oldSource, sourceUrl: rosterUrl } });
  const later = holder("az-legislature:member:latest", { websiteUrl: null, phone: "602-555-0011",
    sourceUrl: rosterUrl, provenance: { ...newSource, sourceUrl: rosterUrl } });
  const merged = mergeBallotPersonHolders([first, later])!;
  assert.equal(merged.websiteUrl, null);
  assert.equal(merged.phone, later.phone);
  assert.equal(merged.fieldSources?.phone.collectedAt, newSource.collectedAt);
});
