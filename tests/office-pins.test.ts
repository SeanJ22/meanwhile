import test from "node:test";
import assert from "node:assert/strict";
import {
  directoryOffices, groupOfficePins, officeAriaLabel, officeAtVenue, officeOwners, officePinSet,
  type OfficeOwner, type OfficePin,
} from "../lib/map/office-pins.ts";
import { clusterOfficeSites, ringBackground, ringSegments } from "../lib/map/office-clusters.ts";
import { COLLISION_RADIUS, OFFICE_FAN, fanRightOffsets } from "../lib/map/spiderfy.ts";
import { campaignOfficeFrom } from "../lib/officials/office-locations.ts";
import { officePointFor } from "../lib/map/office-geocode.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import type { MemberDirectory } from "../hooks/use-member-directory.ts";

const source = { sourceUrl: "https://office.example.gov/contact", sourceOrg: "Office directory", collectedAt: "2026-10-05" };
const holder = (id: string, name: string) => ({ id, name, officeTitle: "Representative" }) as SeatHolder;
const house = holder("congress:A000001", "House Member");
const senatorA = holder("congress:S000001", "Senator One");
const senatorB = holder("congress:S000002", "Senator Two");
const stateSenator = holder("plural:az:upper-1", "State Senator");
const stateRep = holder("plural:az:lower-1", "State Representative");
const councilMember = holder("local:council-1", "Council Member");
const rosterMember = holder("local:board-1", "Board Member");
const coverage = {
  seats: [
    { ocdId: "ocd-division/country:us/state:az/cd:7", label: "Congressional District 7", divisionType: "cd", tier: "national", representatives: [house] },
    { ocdId: "ocd-division/country:us/state:az/sldu:20", label: "Legislative District 20", divisionType: "sldu", tier: "state", representatives: [stateSenator] },
    { ocdId: "ocd-division/country:us/state:az/sldl:20", label: "Legislative District 20", divisionType: "sldl", tier: "state", representatives: [stateRep] },
    { ocdId: "ocd-division/country:us/state:az/place:tucson/council_district:1", label: "Ward 1", divisionType: "council_district", tier: "local", representatives: [councilMember] },
  ],
  senators: [senatorA, senatorB],
  bodies: [{ bodyId: "fixture:school", name: "School district", officeContact: { address: "400 Example Street, Tucson, AZ 85701", phone: null, provenance: source },
    readerRoster: { members: [rosterMember] } }],
} as unknown as CoverageSummary;

const owners = officeOwners(coverage);
const owner = (id: string) => owners.find(row => row.holder.id === id)!;
const directory = (offices: { address: string; city?: string; kind?: "CAPITOL" | "DISTRICT"; lat?: number }[]): MemberDirectory => ({
  districtOffices: offices.map(office => ({ address: office.address, city: office.city ?? "Tucson", state: "AZ", zip: "85701", phone: "520-555-0101", lat: office.lat ?? null, lng: office.lat ? -110.97 : null })),
  committees: [],
  officeDetails: offices.map(office => ({ ...source, officeKind: office.kind ?? "DISTRICT", official: true })),
});
const pin = (office: OfficeOwner, address: string, lat: number, lng: number): OfficePin =>
  ({ ...directoryOffices(office, directory([{ address }]))[0], lat, lng });

test("only the reader's House member, senators and state legislators own office pins; bodies and rosters never do", () => {
  assert.deepEqual(owners.map(row => row.holder.id).sort(), [house.id, senatorA.id, senatorB.id, stateRep.id, stateSenator.id].sort());
  assert.ok(!owners.some(row => row.holder.id === rosterMember.id || row.holder.id === councilMember.id || row.holder.id === "fixture:school"));
});

test("tier is the owner's level from the OCD tier table: Congress is national, legislators are state", () => {
  assert.deepEqual([owner(house.id).tier, owner(house.id).role], ["national", "US House"]);
  assert.deepEqual([owner(senatorA.id).tier, owner(senatorA.id).role], ["national", "US Senate"]);
  assert.deepEqual([owner(stateSenator.id).tier, owner(stateRep.id).tier], ["state", "state"]);
  assert.equal(owner(stateRep.id).role, "State office");
  assert.equal(officeAriaLabel(pin(owner(house.id), "1 Example Way", 32.2, -110.97)), "House Member, US House district office, Federal office");
  assert.equal(officeAriaLabel(pin(owner(stateRep.id), "1 Example Way", 32.2, -110.97)), "State Representative, state legislator district office, State office");
});

test("capitol and Washington offices stay on the battlecard; district offices keep owner, tier and source", () => {
  const rows = directoryOffices(owner(house.id), directory([
    { address: "100 Main Street", kind: "DISTRICT", lat: 32.22 },
    { address: "1700 West Washington Street", city: "Phoenix", kind: "CAPITOL" },
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "DISTRICT_OFFICE");
  assert.equal(rows[0].address, "100 Main Street, Tucson, AZ 85701");
  assert.equal(rows[0].tier, "national");
  assert.equal(rows[0].sourceUrl, source.sourceUrl);
  assert.deepEqual(rows[0].point, { lat: 32.22, lng: -110.97 });
  const washington = { districtOffices: [{ address: "123 Cannon House Office Building", city: "Washington", state: "DC", zip: "20515", phone: null, lat: null, lng: null }], committees: [], source: { ...source, repoUrl: source.sourceUrl } } as unknown as MemberDirectory;
  assert.deepEqual(directoryOffices(owner(house.id), washington), []);
});

test("a senator's office shows only inside the current view; other offices do not depend on the view", () => {
  const senate = pin(owner(senatorA.id), "300 Senate Way", 33.45, -112.07);
  const local = pin(owner(house.id), "100 Main Street", 32.22, -110.97);
  const tucson = { west: -111.1, south: 32.1, east: -110.8, north: 32.35 };
  assert.deepEqual(officePinSet([senate, local], { bounds: tucson, venues: [] }).pins.map(row => row.id), [local.id]);
  assert.deepEqual(officePinSet([senate, local], { bounds: null, venues: [] }).pins.map(row => row.id), [local.id]);
  const phoenix = { west: -112.3, south: 33.3, east: -111.9, north: 33.6 };
  assert.deepEqual(officePinSet([senate, local], { bounds: phoenix, venues: [] }).pins.map(row => row.id).sort(), [senate.id, local.id].sort());
});

test("an office in a meeting venue's building folds into that venue's card instead of drawing its own pin", () => {
  const office = pin(owner(stateRep.id), "255 West Alameda Street, Suite 2", 32.2216, -110.9747);
  const venue = { key: "32.2217,-110.9748", address: "City Hall, 255 W. Alameda St., Tucson, AZ 85701", lat: 32.2217, lng: -110.9748 };
  assert.ok(officeAtVenue(office, venue));
  const set = officePinSet([office], { bounds: null, venues: [venue] });
  assert.deepEqual(set.pins, []);
  assert.deepEqual(set.atVenue.get(venue.key)?.map(row => row.id), [office.id]);
  assert.ok(!officeAtVenue(office, { ...venue, address: "257 W Alameda St, Tucson, AZ" }), "the next door is not the same address");
  assert.ok(!officeAtVenue(office, { ...venue, lat: 33.45, lng: -112.07 }), "the same street line in another city is not the same building");
  assert.ok(!officeAtVenue(office, { ...venue, address: null }));
});

test("offices under 28px apart merge into one count pin, as meeting pins do; same-point offices stay one site", () => {
  assert.equal(COLLISION_RADIUS, 28);
  const a = pin(owner(house.id), "100 Main Street", 32.22, -110.97);
  const b = pin(owner(stateRep.id), "200 Main Street", 32.2201, -110.97);
  const c = pin(owner(stateSenator.id), "200 Main Street, Suite 3", 32.2201, -110.97);
  const sites = groupOfficePins([a, b, c]);
  assert.equal(sites.length, 2);
  const at = (gap: number) => clusterOfficeSites(sites, site => ({ x: site.lat === a.lat ? 0 : gap, y: 0 }));
  const merged = at(27.9);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].offices.map(row => row.tier), ["state", "state", "national"], "state offices first, then federal");
  assert.deepEqual(merged[0].tiers, ["state", "national"]);
  const apart = at(28);
  assert.equal(apart.length, 2);
  assert.deepEqual(apart.map(cluster => cluster.offices.length).sort(), [1, 2]);
  assert.equal(apart.find(cluster => cluster.offices.length === 1)!.key, a.id, "one pin per office, keyed by office");
});

test("the split ring gives each tier an equal arc; one tier is a solid ring", () => {
  assert.deepEqual(ringSegments(["state", "national"]), [{ tier: "state", from: 0, to: 50 }, { tier: "national", from: 50, to: 100 }]);
  assert.deepEqual(ringSegments(["local", "state", "national"]).map(s => [s.from, s.to]), [[0, 33.33], [33.33, 66.67], [66.67, 100]]);
  assert.equal(ringBackground(["national"]), "var(--accent-national)");
  assert.equal(ringBackground(["state", "national"]), "linear-gradient(90deg, var(--accent-state) 0% 50%, var(--accent-national) 50% 100%)");
  assert.ok(!ringBackground(["state", "national"]).includes("--mark"));
});

test("the fan opens to the right of the hub at the handoff's offsets", () => {
  assert.deepEqual(fanRightOffsets(["a", "b"], OFFICE_FAN.desktop), [{ key: "a", dx: 16, dy: -19 }, { key: "b", dx: 16, dy: 19 }]);
  assert.deepEqual(fanRightOffsets(["a", "b"], OFFICE_FAN.mobile), [{ key: "a", dx: 30, dy: -34 }, { key: "b", dx: 30, dy: 34 }]);
  assert.deepEqual(fanRightOffsets(["a", "b", "c"], OFFICE_FAN.desktop).map(o => o.dy), [-38, 0, 38]);
});

test("campaign offices accept the labelled office fact and refuse the filed home", () => {
  const input = { ownerId: "fixture:candidate", pageText: "Campaign Office: 900 Example Street", sourceUrl: source.sourceUrl };
  assert.equal(campaignOfficeFrom(input)!.kind, "CAMPAIGN_OFFICE");
  assert.equal(campaignOfficeFrom({ ...input, filedMailingAddress: "900 Example St." }), null);
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
    await officePointFor("fixture:good");
    assert.equal(addresses.length, 1, "the same public office's recent point is shared within the bounded thirty-second window");
    assert.equal(await officePointFor("fixture:invalid"), null);
    assert.equal(await officePointFor("fixture:miss"), null);
    assert.equal(await officePointFor("fixture:miss"), null);
    assert.equal(addresses.filter(address => address === "fixture:miss").length, 2);
  } finally { globalThis.fetch = original; }
});
