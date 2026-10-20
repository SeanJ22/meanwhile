import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectPlaceReferences } from "../scripts/project-place-references.mts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { readStateReference, type StateReferenceIndex } from "../lib/control-plane/expansion/state-references.ts";
import { governmentNativeId } from "../lib/registration/listings.ts";

const censusFiles = ["census_govt_units_2022.csv", "census_govt_units_2022_dependent_school_systems.csv"];
const censusHeader = ["census_id_pid6", "unit_name", "gov_type", "state", "fips_state", "fips_county", "fips_place", "city", "web_address", "county_area_name", "is_active"];
const ncesHeader = ["nces_leaid", "state", "location_state", "lea_name", "lea_type", "website", "updated_status", "sy_status"];
const csv = (header: readonly string[], rows: readonly (readonly string[])[]) => [header, ...rows].map(row => row.map(cell => /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell).join(",")).join("\r\n") + "\r\n";
const digest = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "place-reference-fixture-")), reference = join(root, "data", "reference"), registration = join(root, "data", "derived", "registration");
  mkdirSync(reference, { recursive: true }); mkdirSync(registration, { recursive: true });
  const longName = 'Town, says "yes"\n' + "東".repeat(24_000);
  const census = [csv(censusHeader, [
    ["000101", "County", "COUNTY", "AZ", "04", "001", "", "First city", "https://county.example.gov/", "Apache", "N"],
    ["000202", "District city", "MUNICIPAL", "DC", "11", "001", "50000", "Washington", "", "", "Y"],
    ["000303", longName, "MUNICIPAL", "AZ", "04", "019", "77000", "Tucson", "", "Pima", "Y"],
    ["000404", "Territory subdivision", "TOWNSHIP", "PR", "72", "127", "12345", "San Juan", "", "San Juan", "Y"],
    ["177940", "District with no established source geography", "SPECIAL DISTRICT", "AZ", "04", "003", "", "", "", "Cochise", "Y"],
    ["000505", "Unknown source postal code", "COUNTY", "ZZ", "04", "001", "", "", "", "", "Y"],
    ["", "Missing native id", "COUNTY", "AZ", "04", "001", "", "", "", "", "Y"],
  ]), csv(censusHeader, [["000101", "Dependent school", "DEPENDENT SCHOOL SYSTEM", "AZ", "04", "001", "", "Last city", "", "Apache", "Y"]])];
  census.forEach((text, index) => writeFileSync(join(reference, censusFiles[index]), text));
  writeFileSync(join(reference, "nces_ccd_lea_directory_2025_26.csv"), csv(ncesHeader, [
    ["0400001", "AZ", "AZ", "Arizona LEA", "Regular district", "district.example.org", "Open", "Closed"],
    ["1100001", "XX", "DC", "District fallback LEA", "Regular district", "https://school.example.gov", "", "Open"],
    ["7200001", "PR", "PR", "Puerto Rico LEA", "Regular district", "", "Open", ""],
    ["invalid", "AZ", "AZ", "Invalid native id", "", "", "", ""],
  ]));
  const source = censusFiles.map((file, index) => `${file} (sha256 ${digest(census[index])})`).join(" and ");
  writeFileSync(join(registration, "index.json"), JSON.stringify({ source }));
  for (const { postal } of Object.values(FIPS_TO_STATE)) writeFileSync(join(registration, `${postal.toLowerCase()}.json`), JSON.stringify({ governments:
    postal === "AZ" ? [["000101", "az:county:reviewed-alias"]] : [] }));
  return { root, census, longName, source, out: join(root, "data", "derived", "place-reference") };
}

test("place reference projection preserves source order, native identities, aliases, district and territory rows, and immutable file hashes", async () => {
  const f = fixture();
  try {
    const states = Object.values(FIPS_TO_STATE).map(row => row.postal);
    assert.equal(await projectPlaceReferences(f.root), states.length);
    assert.deepEqual(readdirSync(f.out).filter(file => /^[a-z]{2}\.json$/.test(file)).sort(), states.map(state => `${state.toLowerCase()}.json`).sort());
    for (const state of states) {
      const index = JSON.parse(readFileSync(join(f.out, `${state.toLowerCase()}.json`), "utf8")) as StateReferenceIndex;
      assert.equal(index.censusSource, f.source.split(" and ").map(source => `data/reference/${source}`).join(" and "));
      const bytes = readFileSync(join(f.out, index.dataFile!));
      assert.equal(digest(bytes), index.dataSha256);
      assert.equal(index.dataFile, `${state.toLowerCase()}.${index.dataSha256}.jsonl`);
    }
    const az = readStateReference(f.root, "AZ", { units: "state", facts: true, listings: true });
    assert.deepEqual(az.units.map(row => row.pid6), ["000101", "000303", "177940", "000101"]);
    assert.equal(az.units[1].name, f.longName, "a multibyte quoted record spans input chunks without changing its words");
    assert.deepEqual(az.units.filter(row => row.pid6 === "000101").map(row => row.aliases), [["az:county:reviewed-alias"], ["az:county:reviewed-alias"]]);
    assert.equal(az.facts["000101"].city, "Last city", "later source facts overwrite the same native key without deleting source rows");
    assert.deepEqual(az.listings!.map(row => row.id), ["000101", "000303", "177940", "000101"].map(id => governmentNativeId("AZ", "cog", id)).concat(governmentNativeId("AZ", "nces", "0400001")));
    assert.equal(az.listings![0].status, "N", "dormant native governments remain in the inventory");
    assert.equal(az.listings!.at(-1)!.website, "http://district.example.org");
    assert.deepEqual(az.exactShares, {}); assert.deepEqual(az.zips, {});
    assert.ok(az.units.every(unit => unit.zips.length === 0), "an alias or district rule never invents a service boundary");
    const dc = readStateReference(f.root, "DC", { units: "state", listings: true });
    assert.deepEqual(dc.units.map(row => row.pid6), ["000202"]);
    assert.equal(dc.listings!.at(-1)!.nativeIds.source_state, "XX");
    assert.equal(dc.listings!.at(-1)!.nativeIds.nces_leaid, "1100001");
    const pr = readStateReference(f.root, "PR", { units: "state", listings: true });
    assert.deepEqual(pr.units.map(row => row.method), ["cousub GEOID 7212712345"]);
    assert.equal(pr.listings!.at(-1)!.nativeIds.nces_leaid, "7200001");
    assert.deepEqual(readStateReference(f.root, "AS", { units: "state", listings: true }).listings, []);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a changed held Census file is rejected before any new state index is emitted", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "data", "reference", censusFiles[0]), f.census[0] + "\r\n");
    await assert.rejects(projectPlaceReferences(f.root), /REGISTRATION_CENSUS_FILE_DRIFT:census_govt_units_2022\.csv/);
    assert.equal(existsSync(f.out), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
