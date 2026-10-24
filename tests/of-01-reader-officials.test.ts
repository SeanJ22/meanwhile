import assert from "node:assert/strict";
import test from "node:test";
import { statePeopleWithLegislativeAuthority } from "../lib/reader/state-people.ts";
import { currentPresidentRoster } from "../lib/reader/national.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import { scopedHolders } from "../lib/officials/scoped-holders.ts";
import type { StatewideExecutive } from "../lib/officials/statewide-executives.ts";
import type { Officeholder, OfficeholderSet, PersonMembership } from "../lib/officials/types.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import { selectStatewideExecutives } from "../lib/officials/statewide-selection.ts";
import { personIdentityKeys } from "../lib/officials/people-identity.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";

const COUNTRY = "ocd-division/country:us", STATE = `${COUNTRY}/state:az`, DISTRICT = `${STATE}/sldu:1`;
const AT = "2026-10-20T00:00:00.000Z";
function statewideHolder(id: string, state = "AZ", name = "Katie Hobbs", officeTitle = "Governor"): SeatHolder {
  const division = `${COUNTRY}/state:${state.toLowerCase()}`;
  return { id, state, name, officeTitle, officeJurisdictionOcdId: division, partyLabel: null, termEnd: null, birthDate: null,
    websiteUrl: "https://azgovernor.gov/", sourceUrl: "https://azgovernor.gov/", email: "engage@az.gov", phone: "602-542-4331",
    contactFormUrl: "https://azgovernor.gov/constituent-services", photoUrl: null, campaignUrl: null,
    provenance: { sourceUrl: "https://azgovernor.gov/", sourceOrg: "Governor", collectedAt: AT, verifiedAt: AT } };
}

test("duplicates inside the primary statewide list merge before Open States; official contacts and every person ID survive", () => {
  const national = { ...statewideHolder("usa-gov"), email: null, phone: null, contactFormUrl: null,
    provenance: { sourceUrl: "https://www.usa.gov/states/arizona", sourceOrg: "USA.gov", collectedAt: "2026-10-09", verifiedAt: null } };
  const official = { ...statewideHolder("statewide:az/governor"), provenance: { ...statewideHolder("x").provenance!, collectedAt: "2026-08-14" } };
  const reference = { ...statewideHolder("openstates-hobbs"), email: "sosadmin@azsos.gov", phone: "old office phone",
    provenance: { sourceUrl: "https://raw.githubusercontent.com/openstates/people/main/hobbs.yml", sourceOrg: "Open States", collectedAt: "2026-10-24", verifiedAt: null } };
  const before = structuredClone([national, official, reference]);
  const [holder, ...extra] = scopedHolders([national, official], [reference]);
  assert.deepEqual(extra, []);
  assert.equal(holder.email, official.email);
  assert.equal(holder.phone, official.phone);
  assert.equal(holder.contactFormUrl, official.contactFormUrl);
  for (const id of before.map(row => row.id)) assert.ok(personIdentityKeys(holder).has(id));
  assert.deepEqual([national, official, reference], before);
});

test("field timestamps choose the newest official value even when the reference roster was checked later", () => {
  const original = statewideHolder("first");
  original.fieldSources = { email: { ...original.provenance!, collectedAt: "2026-10-01" } };
  const newer = { ...statewideHolder("second"), email: "new@az.gov", provenance: { ...original.provenance!, collectedAt: "2026-09-01" },
    fieldSources: { email: { ...original.provenance!, collectedAt: "2026-10-23" } } };
  assert.equal(scopedHolders([original, newer], [])[0].email, newer.email);
});

test("a newer official incumbent replaces a stale single seat without conflating different people or states", () => {
  const stale = { ...statewideHolder("old", "AZ", "Previous Governor"), provenance: { ...statewideHolder("x").provenance!, collectedAt: "2026-08-01" } };
  const current = statewideHolder("current");
  const california = statewideHolder("california", "CA", "Gavin Newsom");
  const result = scopedHolders([stale, current, california], []);
  assert.deepEqual(result.map(row => row.id), [current.id, california.id]);
  assert.equal(personIdentityKeys(result[0]).has(stale.id), false);
});

test("statewide page furniture never displays and a multi-member commission keeps distinct holders", () => {
  const result = scopedHolders([statewideHolder("bad", "AZ", "Actions", "Attorney General"),
    statewideHolder("one", "AZ", "René Lopez", "Corporation Commissioner"),
    statewideHolder("two", "AZ", "Rachel Walden", "Corporation Commissioner")], []);
  assert.deepEqual(result.map(row => row.id), ["one", "two"]);
});

test("stored statewide selection is repeatable and retains the prior IDs through a later source refresh", () => {
  const rows = [statewideHolder("first"), statewideHolder("second")].map(holder => {
    const { provenance, ...value } = holder;
    return { stateOcdId: STATE, holder: value, sourceUrl: provenance!.sourceUrl!, sourceOrg: provenance!.sourceOrg,
      collectedAt: provenance!.collectedAt, verification: "PAGE_FETCHED" as const };
  });
  const once = selectStatewideExecutives(rows);
  assert.equal(once.length, 1);
  assert.deepEqual(selectStatewideExecutives(once), once);
  assert.deepEqual(selectStatewideExecutives([...once, rows[1]]), once);
  assert.ok(once[0].holder.nativeIds?.reader?.includes(rows[1].holder.id));
});

test("the merged source record cannot carry a prior navigation label or accept one from Open States", () => {
  const bad = person("bad", "Attorney General");
  bad.name = "Actions";
  const good = person("good", "Governor");
  const result = mergePeopleSets([roster([bad]), roster([good, bad])])!;
  assert.deepEqual(result.officeholders.map(row => row.id), [good.id]);
  assert.equal(result.divisions.some(row => row.officeholderId === bad.id), false);
});
function person(id: string, officeTitle: string, chamber?: string): Officeholder {
  return { id, personId: id, name: `Example ${id}`, officeTitle, level: "STATE", state: "AZ", chamber,
    termStart: "", termEnd: "", birthDate: null, partyLabel: null, websiteUrl: `https://az.gov/${id}`,
    contactFormUrl: `https://az.gov/${id}/contact`, phone: "602-555-0100", email: `${id}@az.gov`, campaignUrl: null, photo: null,
    provenance: { sourceUrl: `https://az.gov/${id}`, sourceOrg: "Arizona official source fixture", collectedAt: AT, verifiedAt: AT } };
}
function membership(holder: Officeholder, id: string, divisionId: string, officeTitle = holder.officeTitle, chamber = holder.chamber): PersonMembership {
  return { id, personId: holder.id, officeId: `${divisionId}:office:${id}`, jurisdiction: "US-AZ", level: "STATE", chamber,
    officeTitle, divisionId, current: true, sourceUrl: holder.provenance.sourceUrl! };
}
function roster(officeholders: Officeholder[]): OfficeholderSet {
  return { scope: "US-AZ", generatedAt: AT, officeholders, unmatched: [],
    divisions: officeholders.flatMap(holder => holder.memberships?.map(row => ({ officeholderId: holder.id, ocdId: row.divisionId!, bodyId: null, membershipId: row.id })) ??
      [{ officeholderId: holder.id, ocdId: holder.chamber ? DISTRICT : STATE, bodyId: null }]) };
}

test("legislative authority preserves independently sourced statewide officials and every contact", () => {
  const senator = person("senator", "State Senator", "upper");
  const treasurer = person("treasurer", "State Treasurer");
  const governor = person("governor", "Governor");
  const insurance = person("insurance", "Insurance Commissioner");
  const input = roster([senator, treasurer, governor, insurance]);
  const before = structuredClone(input);
  const authoritative = roster([{ ...senator, phone: null, email: null, contactFormUrl: null }]);
  const result = statePeopleWithLegislativeAuthority(input, authoritative)!;
  const byId = new Map(result.officeholders.map(holder => [holder.id, holder]));
  assert.equal(byId.size, 4);
  for (const prior of input.officeholders) {
    const after = byId.get(prior.id)!;
    for (const field of ["name", "officeTitle", "phone", "email", "contactFormUrl", "websiteUrl"] as const) assert.equal(after[field], prior[field]);
    assert.equal(after.provenance.sourceUrl, prior.provenance.sourceUrl);
  }
  assert.deepEqual(indexByDivision([result]).get(STATE)?.map(holder => holder.id).sort(), [governor.id, insurance.id, treasurer.id].sort());
  assert.deepEqual(input, before, "reader composition leaves the stored source roster intact");
});

test("an ended legislative seat does not remove another current office held by the same person", () => {
  const mixed = person("mixed", "State Senator", "upper");
  mixed.memberships = [membership(mixed, "old-legislative", DISTRICT), membership(mixed, "treasury", STATE, "State Treasurer", "")];
  const stale = person("stale", "State Senator", "upper");
  const current = person("current", "State Senator", "upper");
  const result = statePeopleWithLegislativeAuthority(roster([mixed, stale]), roster([current]))!;
  const byDivision = indexByDivision([result]);
  assert.deepEqual(result.officeholders.map(holder => holder.id).sort(), [mixed.id, current.id].sort());
  assert.deepEqual(byDivision.get(DISTRICT)?.map(holder => holder.id), [current.id]);
  const holder = byDivision.get(STATE)?.[0];
  assert.equal(holder?.id, mixed.id);
  assert.equal(holder?.officeTitle, "State Treasurer");
  assert.equal(holder?.phone, mixed.phone);
  assert.equal(holder?.sourceUrl, mixed.memberships[1].sourceUrl);
  assert.deepEqual(result.officeholders.find(holder => holder.id === mixed.id)?.memberships?.map(row => row.id), ["treasury"]);
});

test("a legislature filters legislators identified by seat or title without adding competing federal directory aliases", () => {
  const noChamber = person("old-delegate", "Delegate");
  const bySeat = person("by-seat", "Member");
  const federal = { ...person("federal", "U.S. Senator", "senate"), level: "FEDERAL" as const };
  const input = roster([noChamber, bySeat, federal]);
  input.divisions = input.divisions.map(link => link.officeholderId === bySeat.id ? { ...link, ocdId: DISTRICT } : link);
  const result = statePeopleWithLegislativeAuthority(input, roster([]))!;
  assert.deepEqual(result.officeholders.map(holder => holder.id), []);
  assert.ok(input.officeholders.some(holder => holder.id === federal.id), "the full source roster retains supplementary federal person details");
  assert.equal(statePeopleWithLegislativeAuthority(input, null), input);
  const authoritative = roster([person("current", "State Senator", "upper")]);
  assert.equal(statePeopleWithLegislativeAuthority(null, authoritative), authoritative);
});

test("a legacy statewide office survives stale chamber metadata and a legislative division link", () => {
  const treasurer = person("treasurer", "State Treasurer", "upper");
  const input = roster([treasurer]);
  input.divisions.push({ ...input.divisions[0], ocdId: STATE });
  const result = statePeopleWithLegislativeAuthority(input, roster([]))!;
  assert.equal(result.officeholders[0]?.id, treasurer.id);
  assert.equal(result.officeholders[0]?.phone, treasurer.phone);
  assert.deepEqual(result.divisions.map(link => link.ocdId), [STATE]);
});

test("newly exposed supplementary rows preserve existing official profile sources and contacts", () => {
  const official = person("governor", "Governor");
  const primary = indexByDivision([roster([official])]).get(STATE)![0];
  const { provenance, ...holder } = primary;
  const executive: StatewideExecutive = { stateOcdId: STATE, holder, sourceUrl: provenance!.sourceUrl!, sourceOrg: provenance!.sourceOrg,
    collectedAt: AT, verification: "PAGE_FETCHED" };
  const sourceUrl = "https://github.com/openstates/people/blob/main/data/az/executive/example.yml";
  const reference = { ...official, id: "plural:az:governor", personId: "plural:az:governor", phone: "602-555-0199",
    provenance: { sourceUrl, sourceOrg: "Open States", collectedAt: "2026-10-21T00:00:00.000Z", verifiedAt: null } };
  reference.memberships = [{ ...membership(reference, "governor", STATE), officeTitle: "governor", sourceUrl }];
  const input = roster([reference]);
  const result = statePeopleWithLegislativeAuthority(input, roster([]), [executive])!;
  const additional = indexByDivision([result]).get(STATE)!;
  const merged = scopedHolders([primary], additional);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, primary.id);
  assert.equal(merged[0].sourceUrl, primary.sourceUrl);
  assert.equal(merged[0].officeTitle, primary.officeTitle);
  assert.equal(merged[0].provenance?.sourceUrl, primary.provenance?.sourceUrl);
  assert.equal(merged[0].phone, primary.phone);
  assert.equal(merged[0].contactFormUrl, primary.contactFormUrl);
  assert.equal(input.officeholders[0].provenance.sourceUrl, sourceUrl, "the stored supplementary evidence remains unchanged");
});

test("the national reader keeps each current President and Vice President with contacts and sources", () => {
  const president = { ...person("president", "President of the United States"), level: "FEDERAL" as const };
  const vice = { ...person("vice", "Vice President of the United States"), level: "FEDERAL" as const };
  const historical = { ...person("previous", "President of the United States"), level: "FEDERAL" as const };
  for (const holder of [president, vice, historical]) holder.memberships = [{ ...membership(holder, `${holder.id}-membership`, COUNTRY), level: "FEDERAL", current: holder !== historical }];
  const input = roster([president, vice, historical]);
  input.scope = "US";
  const result = currentPresidentRoster(input)!;
  assert.deepEqual(result.officeholders.map(holder => holder.id), [president.id, vice.id]);
  const holders = indexByDivision([result]).get(COUNTRY)!;
  assert.equal(holders.length, 2);
  for (const original of [president, vice]) {
    const selected = holders.find(holder => holder.id === original.id)!;
    assert.equal(selected.phone, original.phone);
    assert.equal(selected.email, original.email);
    assert.equal(selected.contactFormUrl, original.contactFormUrl);
    assert.equal(selected.sourceUrl, original.provenance.sourceUrl);
  }
  assert.deepEqual(currentPresidentRoster({ ...input, officeholders: [vice], divisions: input.divisions.filter(row => row.officeholderId === vice.id) })?.officeholders.map(holder => holder.id), [vice.id]);
});
