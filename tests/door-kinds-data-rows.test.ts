import assert from "node:assert/strict";
import test from "node:test";

import { SOURCE_WIRING, meetingSourceNamesForWiring } from "@/lib/registry/source-wiring.ts";
import { CAPABILITIES, buildCompositeSource } from "@/lib/sources/composite/wiring.ts";
import { DATA_DOOR_KINDS, DOOR_KIND_SPECS, dataDoorConfig } from "@/lib/civic-data/derived-door-kinds.ts";
import { CROSSWALK_KINDS } from "@/lib/civic-data/meeting-body-crosswalk.ts";
import { DERIVED_WIRING_SOURCE_NAMES, bodySourceWiringFor, derivedAdapterConfig, type DerivedWiringRow } from "@/lib/civic-data/derived-meeting-wiring.ts";
import { wiringShapeFor } from "@/lib/control-plane/discovery/derived-wiring.ts";

/** Settings a reviewer would supply, taken from a body the code already wires on the same adapter. */
function sampleFilter(kind: (typeof DATA_DOOR_KINDS)[number]): Record<string, string> {
  const spec = DOOR_KIND_SPECS[kind];
  const row = SOURCE_WIRING.find((r) => r.agendaSourceType === spec.agendaSourceType && (kind !== "LEGISTAR_INSITE" || r.config.insiteHost) && spec.required.every((key) => r.config[key] !== undefined));
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
    const same = SOURCE_WIRING.filter((r) => r.agendaSourceType === spec.agendaSourceType);
    for (const key of [spec.route.key, ...spec.allowed]) {
      assert.ok(same.some((r) => r.config[key] !== undefined), `${kind}: no body carries ${key}`);
    }
    const route = kind === "BOARDBOOK" ? "https://meetings.boardbook.org/Public/Organization/1234" : `https://records.example.gov/${kind.toLowerCase()}/calendar`;
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
