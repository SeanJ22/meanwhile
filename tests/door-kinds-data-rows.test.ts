import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { meetingSourceNamesForWiring, type BodySourceWiring } from "@/lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { CAPABILITIES, buildCompositeSource } from "@/lib/sources/composite/wiring.ts";
import { DATA_DOOR_KINDS, DOOR_KIND_SPECS, dataDoorConfig } from "@/lib/civic-data/derived-door-kinds.ts";
import { CROSSWALK_KINDS } from "@/lib/civic-data/meeting-body-crosswalk.ts";
import { DERIVED_WIRING_SOURCE_NAMES, bodySourceWiringFor, derivedAdapterConfig, type DerivedWiringRow } from "@/lib/civic-data/derived-meeting-wiring.ts";
import { wiringShapeFor } from "@/lib/control-plane/discovery/derived-wiring.ts";

// Reviewed filters may carry settings added since the hand-wired import.
const mandan = JSON.parse(readFileSync(new URL("./fixtures/civicclerk-mandan-events.json", import.meta.url), "utf8")).value[0];
const sharedCategory = JSON.parse(readFileSync(new URL("./fixtures/civicclerk/mandannd/Events.json", import.meta.url), "utf8")).value[0];
const pimaBody = JSON.parse(readFileSync(new URL("./fixtures/legistar-members/pima/bodies.json", import.meta.url), "utf8"))[0];
const SAMPLE_ROWS: BodySourceWiring[] = [
  { ...FIXTURE_DOOR_ROWS.find(row => row.config.slug === "pima")!, agendaSourceType: "LEGISTAR" as const,
    config: { slug: "pima", eventBodyId: String(pimaBody.BodyId) } },
  { ...FIXTURE_DOOR_ROWS[0], agendaSourceType: "MUNICODE" as const, config: { portalUrl: "https://meetings.municode.com/PublishPage/index?cid=BREM&ppid=d33416d7-25d1-44e6-9d32-55b97fa53824", nameTerms: "City Council" } },
  { bodyId: "ocd-division/country:us/state:nd/place:mandan#body:safety-and-wellness-committee", ocdId: "ocd-division/country:us/state:nd/place:mandan",
    jurisdiction: "Mandan, ND", publishingOrg: "City of Mandan", timeZone: "America/Chicago", verifiedAt: "2026-10-13T19:21:00Z", agendaSourceType: "CIVICCLERK" as const,
    config: { apiBase: "https://mandannd.api.civicclerk.com", portalBase: "https://mandannd.portal.civicclerk.com", titleMatch: sharedCategory.eventName, categoryId: String(sharedCategory.categoryId) } },
  { bodyId: "ocd-division/country:us/state:nd/place:mandan#governing", ocdId: "ocd-division/country:us/state:nd/place:mandan", jurisdiction: "Mandan, ND", publishingOrg: "City of Mandan", timeZone: "America/Chicago", verifiedAt: "2026-10-13T19:21:00Z", agendaSourceType: "CIVICCLERK" as const,
    config: { apiBase: "https://mandannd.api.civicclerk.com", portalBase: "https://mandannd.portal.civicclerk.com", bodyMatch: mandan.categoryName, categoryId: String(mandan.categoryId) } },
  { ...FIXTURE_DOOR_ROWS[0], agendaSourceType: "NOVUSAGENDA" as const,
    config: { portalUrl: "https://coalinga.novusagenda.com/AgendaPublic/MeetingsResponsive.aspx", bodyMatch: "City Council Meeting" } },
  { ...FIXTURE_DOOR_ROWS[0], agendaSourceType: "ESCRIBE" as const, config: { portalUrl: "https://pub-lamesa.escribemeetings.com", meetingTypes: "City Council" } },
  { ...FIXTURE_DOOR_ROWS[0], agendaSourceType: "GRANICUS" as const,
    config: { publisherUrl: "https://alexandria.granicus.com/ViewPublisher.php?view_id=57", bodyMatch: "City Council", bodyName: "City Council" } },
  ...FIXTURE_DOOR_ROWS.map(row => row.agendaSourceType === "CIVICCLERK"
    ? { ...row, config: { ...row.config, bodyMatch: "Board of Directors" } } : row),
  { ...FIXTURE_DOOR_ROWS[0], agendaSourceType: "BOARDDOCS" as const,
    config: { portalUrl: "https://go.boarddocs.com/mi/grand/Board.nsf/Public", committeeId: "A4EP6J588C05" } },
  { ...FIXTURE_DOOR_ROWS[0], agendaSourceType: "SWAGIT" as const,
    config: { portalUrl: "https://chandleraz.new.swagit.com/views/155/", bodyMatch: "City Council" } },
  { ...FIXTURE_DOOR_ROWS[0], agendaSourceType: "PRIMEGOV" as const,
    config: { portalUrl: "https://okc.primegov.com/Public/Portal", committeeId: "1" } },
];

function sampleFilter(kind: (typeof DATA_DOOR_KINDS)[number]): Record<string, string> {
  const spec = DOOR_KIND_SPECS[kind];
  const row = SAMPLE_ROWS.find((r) => r.agendaSourceType === spec.agendaSourceType && (kind !== "LEGISTAR_INSITE" || r.config.insiteHost) && spec.required.every((key) => r.config[key] !== undefined));
  assert.ok(row, `${kind}: no existing row carries every required setting`);
  return Object.fromEntries(spec.allowed.filter((key) => row.config[key] !== undefined).map((key) => [key, row.config[key]!]));
}

for (const kind of DATA_DOOR_KINDS) {
  test(`${kind} can be wired as a data row and is read by its own adapter`, () => {
    const spec = DOOR_KIND_SPECS[kind];
    assert.ok(CROSSWALK_KINDS.includes(kind));
    assert.equal(DERIVED_WIRING_SOURCE_NAMES[kind], spec.sourceName);
    const capability = CAPABILITIES.find((c) => c.name === spec.sourceName);
    assert.ok(capability, "the adapter is registered");
    assert.ok(capability.types.includes(spec.agendaSourceType));
    // Every setting the kind declares is one an existing body of that adapter carries.
    const same = SAMPLE_ROWS.filter((r) => r.agendaSourceType === spec.agendaSourceType);
    for (const key of [spec.route.key, ...spec.allowed]) {
      assert.ok(same.some((r) => r.config[key] !== undefined), `${kind}: no body carries ${key}`);
    }
    const route = kind === "LEGISTAR" ? "https://webapi.legistar.com/v1/pima/events" : kind === "BOARDBOOK" ? "https://meetings.boardbook.org/Public/Organization/1234" : `https://records.example.gov/${kind.toLowerCase()}/calendar`;
    const config = derivedAdapterConfig({ kind, route, officialHost: "records.example.gov", bodyId: "ocd-division/country:us/state:zz/place:example", bodyName: "Example Board", filter: sampleFilter(kind) });
    assert.equal(typeof config[spec.route.key], "string");
    const row: DerivedWiringRow = {
      bodyId: "ocd-division/country:us/state:zz/place:example", ocdId: "ocd-division/country:us/state:zz/place:example", bodyName: "Example Board",
      kind, route, officialHost: "records.example.gov", jurisdictionId: "x", state: "US-ZZ", publishingOrg: "Example", timeZone: "America/Phoenix",
      config, crosswalkRowId: "r", reviewedAt: "2026-10-04T00:00:00Z", verifiedAt: "2026-10-04T00:00:00Z",
    };
    const wiring = bodySourceWiringFor(row);
    assert.equal(wiring.agendaSourceType, spec.agendaSourceType);
    assert.ok(meetingSourceNamesForWiring(wiring).includes(spec.sourceName));
    // The composite builds the child for the row with no code change and no fetch.
    const source = buildCompositeSource({ sourceNames: [spec.sourceName], derivedRows: [wiring] });
    assert.ok(source);
  });

  test(`${kind} refuses a missing or undeclared setting by name`, () => {
    const spec = DOOR_KIND_SPECS[kind];
    const base = { kind, route: "https://records.example.gov/x", slug: "s", bodyName: "B" } as const;
    assert.throws(() => dataDoorConfig({ ...base, filter: { notDeclared: "x" } }), /DOOR_KIND_SETTING_NOT_DECLARED/);
    if (spec.required.length > 0) assert.throws(() => dataDoorConfig({ ...base, filter: {} }), new RegExp(`DOOR_KIND_SETTING_MISSING:${kind}`));
  });
}

test("discovery names a wiring kind for the vendors whose route is the whole connection", () => {
  assert.deepEqual(wiringShapeFor({ vendor: "civicclerk-api", url: "https://town.api.civicclerk.com/v1/Events?$top=5" }), { kind: "CIVICCLERK", endpoint: { apiBase: "https://town.api.civicclerk.com" } });
  assert.deepEqual(wiringShapeFor({ vendor: "iqm2", url: "https://town.iqm2.com/Citizens/Calendar.aspx" }), { kind: "IQM2", endpoint: { base: "https://town.iqm2.com" } });
  assert.deepEqual(wiringShapeFor({ vendor: "legistar-insite", url: "https://town.legistar.com/Calendar.aspx" }), { kind: "LEGISTAR_INSITE", endpoint: { insiteHost: "town.legistar.com" } });
});
