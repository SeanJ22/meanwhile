import assert from "node:assert/strict";
import test from "node:test";
import { readStateDivisionsByName } from "../lib/control-plane/expansion/territory-name-lookup.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../lib/registry/runtime-data-plane.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { readPlacePayloadParts } from "../lib/civic-data/place-payload-slices.ts";

const division = (ocdId: string, label: string) => ({ ocdId, label, provenance: { sourceUrl: "https://www.census.gov/", collectedAt: "2026-09-30" } });

test("directory names use a state-bounded exact lookup and preserve ambiguous candidates and provenance", async () => {
  const root = "ocd-division/country:us/state:az";
  const rows = [division(`${root}/county:pima`, "Pima County"), division(`${root}/place:pima`, "Pima"),
    division(`${root}/county:test/place:pima`, "Pima"), division(`${root}/place:pima_heights`, "Pima Heights"),
    division("ocd-division/country:us/state:nm/place:pima", "Pima")];
  let calls = 0;
  const query: ReadOnlyQuery = async statements => {
    calls++;
    assert.equal(statements.length, 1);
    const { text, params } = statements[0];
    assert.deepEqual(params.slice(0, 3), ["REGISTRY_RUNTIME_BINDING", [REGISTRY_RUNTIME_SCOPE], []]);
    assert.deepEqual(params.slice(5), [["registry.divisions"], root, ["pima county", "pima"]]);
    assert.match(text, /civic_data_payload_parts/, "uses the shared packed and inline reader");
    return [[{ scope: REGISTRY_RUNTIME_SCOPE, field: "registry.divisions", rows }]];
  };
  const result = await readStateDivisionsByName("az", ["  PIMA---County ", "Pima", "pima"], { query });
  assert.equal(calls, 1);
  assert.deepEqual(result.map(d => d.ocdId), [rows[0].ocdId, rows[2].ocdId, rows[1].ocdId]);
  assert.deepEqual(result[0].provenance, rows[0].provenance);
  assert.equal(result.filter(d => d.label === "Pima").length, 2, "the caller must resolve ambiguity, never take the first match");
});

test("DC and territories retain their canonical roots instead of becoming states", async () => {
  for (const [code, suffix] of [["DC", "district:dc"], ["PR", "territory:pr"], ["GU", "territory:gu"]]) {
    const root = `ocd-division/country:us/${suffix}`;
    const query: ReadOnlyQuery = async ([statement]) => {
      assert.equal(statement.params[6], root);
      return [[{ scope: REGISTRY_RUNTIME_SCOPE, field: "registry.divisions", rows: [
        division(root, "Region"), division(`${root}/place:example`, "Region"),
        division(`ocd-division/country:us/state:${code.toLowerCase()}/place:example`, "Region"),
      ] }]];
    };
    assert.deepEqual((await readStateDivisionsByName(code, ["Region"], { query })).map(d => d.ocdId),
      [root, `${root}/place:example`]);
  }
});

test("empty names make no query; unknown states and broken held reads remain explicit", async () => {
  const unused: ReadOnlyQuery = async () => { throw new Error("unexpected query"); };
  assert.deepEqual(await readStateDivisionsByName("AZ", ["", "---"], { query: unused }), []);
  await assert.rejects(readStateDivisionsByName("XX", ["Pima"], { query: unused }), /TERRITORY_NAME_STATE_INVALID/);
  assert.deepEqual(await readStateDivisionsByName("AZ", ["Unrecorded"], { query: async () => [[]] }), []);
  await assert.rejects(readStateDivisionsByName("AZ", ["Pima"], { query: async () => {
    throw new Error("held read failed");
  } }), /held read failed/);
  await assert.rejects(readStateDivisionsByName("AZ", ["Pima"], { query: async () => [[{
    scope: REGISTRY_RUNTIME_SCOPE, field: "$missing", rows: [{ $civicPayloadPart: "missing" }],
  }]] }), /CIVIC_PAYLOAD_PART_MISSING/);
});

test("existing ID-based place selections retain their collections and bindings", async () => {
  const query: ReadOnlyQuery = async ([statement]) => {
    assert.equal(statement.params.length, 6);
    assert.deepEqual(statement.params.slice(2, 5), [["division"], ["body"], ["target"]]);
    assert.ok((statement.params[5] as string[]).includes("registry.bodies"));
    return [[{ scope: REGISTRY_RUNTIME_SCOPE, field: "registry.bodies", rows: [{ id: "body", ocdId: "division" }] }]];
  };
  const result = await readPlacePayloadParts(query, "REGISTRY_RUNTIME_BINDING", [REGISTRY_RUNTIME_SCOPE], ["division"], ["body"], ["target"]);
  assert.deepEqual((result.get(REGISTRY_RUNTIME_SCOPE) as { registry: { bodies: unknown[] } }).registry.bodies, [{ id: "body", ocdId: "division" }]);
});
