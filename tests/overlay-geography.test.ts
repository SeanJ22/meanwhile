import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readBoundaryZip, readDbf, readZip } from "../lib/geo/shapefile.ts";
import type { GeographyGeometry, GeographyVersion } from "../lib/census-geography/contract.ts";
import { overlayDistrictCode, overlayDistrictIdentity, overlaySources } from "../lib/overlay-geography/reference.ts";
import { geometryArea, geometryPolygons, shapesToGeometry } from "../lib/overlay-geography/geometry.ts";
import { districtDocumentLines, normalizeTown, parseDistrictTownAssignments } from "../lib/overlay-geography/document.ts";
import { buildOverlayScope, OverlayOverlapAccumulator, overlayDocumentMembers, overlayPartitionMembers, verifyOverlayTowns, type VerifiedOverlay } from "../lib/overlay-geography/build.ts";
import { acquireOverlayScopes, parseOverlayBoundaryZip } from "../lib/overlay-geography/acquire.ts";
import { zip } from "../scripts/xlsx.mjs";

const source = overlaySources()[0];
const square = (west: number, south: number, east: number, north: number): GeographyGeometry => ({ type: "Polygon", coordinates: [[[west, south], [west, north], [east, north], [east, south], [west, south]]] });

test("the real source reference maps a county designation to its DBF code and shared OCD identity", () => {
  assert.equal(overlayDistrictCode(source, "Rockingham 31"), "RO31");
  assert.equal(overlayDistrictCode(source, "ro031"), "RO31");
  assert.equal(overlayDistrictIdentity(source, "RO31")?.ocdId, "ocd-division/country:us/state:nh/sldl:ro31");
  assert.equal(overlayDistrictCode(source, "Unknown 31"), null);
  assert.equal(overlayDistrictCode(source, "Rockingham 0"), null);
  const different = { ...source, stateFips: "50", codePrefixes: { XX: { name: "Example County", countyFips: "001" } } };
  assert.equal(overlayDistrictCode(different, "Example County 4"), "XX4");
  assert.equal(overlayDistrictIdentity(different, "XX4")?.ocdId, "ocd-division/country:us/state:vt/sldl:xx4");
});

test("State Plane US feet reprojection uses the declared NAD83 origin", () => {
  // Official source projection parameters. A false-origin control checks feet/metres and latitude/longitude order.
  const definition = "+proj=tmerc +lat_0=42.5 +lon_0=-71.66666666666667 +k=0.9999666666666667 +x_0=300000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs";
  const geometry = shapesToGeometry([[[984250, 0], [984250, 100], [984350, 100], [984350, 0], [984250, 0]]], definition);
  const [longitude, latitude] = geometry.coordinates[0][0][0] as number[];
  assert.ok(Math.abs(longitude + 71.66666666666667) < 1e-9);
  assert.ok(Math.abs(latitude - 42.5) < 1e-9);
});

test("disjoint polygons keep their holes even when the hole precedes its exterior", () => {
  const hole: [number, number][] = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];
  const exterior: [number, number][] = [[0, 0], [0, 3], [3, 3], [3, 0], [0, 0]];
  const second: [number, number][] = [[4, 0], [4, 1], [5, 1], [5, 0], [4, 0]];
  const geometry = shapesToGeometry([hole, exterior, second], "EPSG:4326");
  const polygons = geometryPolygons(geometry);
  assert.deepEqual(polygons.map((polygon) => polygon.length), [2, 1]);
  assert.ok(Math.abs(geometryArea(polygons) - 9) < 1e-10);
});

test("source town assignments establish overlay membership and missing assignments remain differences", () => {
  const assignments = parseDistrictTownAssignments(source, ["ROCKINGHAM COUNTY", "31 FL Example One, Example Two", "32 Example Three"]);
  assert.deepEqual(assignments, [{ code: "RO31", towns: ["example one", "example two"], overlay: true }]);
  const boundaries = [{ code: "RO31", geometry: square(0, 0, 2, 1) }, { code: "RO32", geometry: square(2, 0, 3, 1) }];
  const towns = [{ geoid: "3301500001", countyFips: "015", name: "Example One town", geometry: square(0, 0, 1, 1) }, { geoid: "3301500002", countyFips: "015", name: "Example Two", geometry: square(1, 0, 2, 1) }, { geoid: "3301500003", countyFips: "015", name: "Example Three", geometry: square(2, 0, 3, 1) }];
  const checked = verifyOverlayTowns(source, boundaries, towns, assignments);
  assert.deepEqual(checked.verified[0].townGeoids, ["3301500001", "3301500002"]);
  assert.equal(checked.verified.length, 1);
  assert.equal(checked.reports[0].code, "RO32");
  assert.match(checked.reports[0].reason, /No parsed town assignment/);
  assert.equal(checked.reports[0].sourceUrls.length, 2);
  const disagreement = verifyOverlayTowns(source, boundaries.slice(0, 1), towns, [{ code: "RO31", towns: ["Example One", "Example Three"] }]);
  assert.equal(disagreement.verified.length, 0);
  assert.deepEqual(disagreement.reports[0].geometryOnly, ["example two"]);
  assert.deepEqual(disagreement.reports[0].documentOnly, ["example three"]);
  assert.equal(normalizeTown("Example One town"), "example one");
});

test("ward overlays join the complete Census partition and reject a partial base district", () => {
  const partition = [{ geoid: "33001", geometry: square(0, 0, 1, 1) }, { geoid: "33002", geometry: square(1, 0, 2, 1) }];
  assert.deepEqual(overlayPartitionMembers(square(0, 0, 2, 1), partition), { geoids: ["33001", "33002"], partial: [], uncovered: 0 });
  const partial = overlayPartitionMembers(square(0, 0, 1.5, 1), partition);
  assert.deepEqual(partial.geoids, ["33001"]);
  assert.deepEqual(partial.partial, ["33002"]);
  assert.ok(Math.abs(partial.uncovered - 1 / 3) < 1e-10);
});

test("town rows and ward ranges continue across PDF lines without annexing headings", () => {
  const assignments = parseDistrictTownAssignments(source, ["ROCKINGHAM COUNTY", "31 FL Example City Wards 1-2", "Example Town", "State Representative Districts", "32 FL Other Town"], ["Example City Ward 1", "Example City Ward 2", "Example City Ward 3", "Example Town", "Other Town"]);
  assert.deepEqual(assignments, [{ code: "RO31", towns: ["example", "example city ward 1", "example city ward 2"], overlay: true }, { code: "RO32", towns: ["other"], overlay: true }]);
});

test("overlay ZIP shares sum exact Census land parts, exclude water and attribute both agreeing sources", () => {
  const verified: VerifiedOverlay[] = [{ code: "RO31", geometry: square(0, 0, 2, 1), townGeoids: ["3301500001", "3301500002"] }];
  const overlaps = new OverlayOverlapAccumulator(verified);
  overlaps.add("GEOID_COUSUB_20|NAMELSAD_COUSUB_20|AREALAND_COUSUB_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART");
  overlaps.add("3301500001|Example One town|80|00001|100|20");
  overlaps.add("3301500002|Example Two town|90|00001|100|30");
  overlaps.add("3301500002|Example Two town|90|00002|100|100");
  overlaps.add("3301500002|Example Two town|90|00003|100|0");
  const metadata: GeographyVersion = { key: "overlay:controlled", type: "overlay_district", plan: "controlled unit input", zctaTabulation: "2020", effectiveFor: "controlled unit input", provenance: { sourceUrls: [source.fileUrl, source.townDocumentUrl], sourceDataset: "controlled", sourceFiles: [], sourceChecksums: [], method: "controlled input", computedAt: "2026-10-12T00:00:00Z" } };
  const scope = buildOverlayScope(source, verified, overlaps, metadata);
  assert.deepEqual(scope.groupings[0].overlaps, [{ zcta5: "00001", fraction: 0.5, whole: false }, { zcta5: "00002", fraction: 1, whole: true }]);
  assert.equal(scope.fractionBasis, "area");
  assert.equal(scope.groupings[0].representation, "overlay");
  assert.equal(scope.groupings[0].chamber, "lower");
  assert.deepEqual(scope.groupings[0].sourceUrls, [source.fileUrl, source.townDocumentUrl]);
});

function controlledBoundaryZip(properties: Record<string, string>): Buffer {
  const fields = Object.entries(properties);
  const headerLength = 33 + fields.length * 32, recordLength = 1 + fields.reduce((n, [, value]) => n + value.length, 0);
  const dbf = Buffer.alloc(headerLength + recordLength + 1);
  dbf[0] = 3; dbf.writeUInt32LE(1, 4); dbf.writeUInt16LE(headerLength, 8); dbf.writeUInt16LE(recordLength, 10);
  let cursor = headerLength + 1;
  for (const [index, [name, value]] of fields.entries()) {
    dbf.write(name, 32 + index * 32, "ascii"); dbf[32 + index * 32 + 11] = 67; dbf[32 + index * 32 + 16] = value.length;
    dbf.write(value, cursor, "ascii"); cursor += value.length;
  }
  dbf[headerLength - 1] = 13; dbf[headerLength] = 32; dbf[dbf.length - 1] = 26;
  const points = [[-72, 42], [-72, 43], [-71, 43], [-71, 42], [-72, 42]];
  const shp = Buffer.alloc(108 + 44 + 4 + points.length * 16);
  shp.writeInt32BE(9994); shp.writeInt32BE(shp.length / 2, 24); shp.writeInt32LE(1000, 28); shp.writeInt32LE(5, 32);
  shp.writeInt32BE(1, 100); shp.writeInt32BE((shp.length - 108) / 2, 104); shp.writeInt32LE(5, 108);
  for (const [index, value] of [-72, 42, -71, 43].entries()) shp.writeDoubleLE(value, 112 + index * 8);
  shp.writeInt32LE(1, 144); shp.writeInt32LE(points.length, 148);
  for (const [index, [x, y]] of points.entries()) { shp.writeDoubleLE(x, 156 + index * 16); shp.writeDoubleLE(y, 164 + index * 16); }
  return zip([{ name: "controlled.shp", data: shp }, { name: "controlled.dbf", data: dbf }, { name: "controlled.prj", data: Buffer.from("EPSG:4326") }], "2026-10-12");
}

function controlledTownPdf(): Buffer {
  const stream = "BT /F1 10 Tf 40 760 Td (EXAMPLE COUNTY) Tj 0 -14 Td (1 FL Exampleville) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("a source failure is explicit while a separate source's verified district publishes", async () => {
  const good = { ...source, id: "controlled-good", stateFips: "50", codePrefixes: { EX: { name: "Example", countyFips: "001" } }, fileUrl: "https://example.gov/good.zip", shapeFile: "controlled.shp", codeField: "Code", townDocumentUrl: "https://example.gov/towns.pdf", townDocumentMirrors: undefined, documentLayout: undefined, townBoundaryUrl: "https://example.gov/towns.zip", townFields: { name: "NAME", county: "COUNTYFP", geoid: "GEOID" }, townRelationshipUrl: "https://example.gov/overlaps.txt", partitionBoundaryUrl: undefined, partitionRelationshipUrl: undefined, partitionGeoTag: undefined, expectedFeatures: 1 };
  const bad = { ...good, id: "controlled-failed", fileUrl: "https://example.gov/failed.zip" };
  const malformed = { ...good, id: "controlled-malformed", fileUrl: "https://example.gov/malformed.zip" };
  const files = new Map<string, Buffer>([[malformed.fileUrl, Buffer.from("publisher returned an HTML page instead of a ZIP")], [good.fileUrl, controlledBoundaryZip({ Code: "EX1" })], [good.townDocumentUrl, controlledTownPdf()], [good.townBoundaryUrl, controlledBoundaryZip({ GEOID: "5000100001", STATEFP: "50", NAME: "Exampleville", COUNTYFP: "001" })], [good.townRelationshipUrl, Buffer.from("GEOID_COUSUB_20|NAMELSAD_COUSUB_20|AREALAND_COUSUB_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n5000100001|Exampleville town|100|00001|100|100\n")]]);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === bad.fileUrl) return new Response("publisher unavailable", { status: 503 });
    const bytes = files.get(url);
    assert.ok(bytes, `Unexpected source request ${url}`);
    return new Response(new Uint8Array(bytes));
  };
  const result = await acquireOverlayScopes({ sources: [bad, malformed, good], fetchImpl });
  assert.equal(result.failures.length, 2);
  assert.equal(result.failures[0].sourceId, bad.id);
  assert.equal(result.failures[0].version, "overlay:controlled-failed");
  assert.match(result.failures[0].reason, /HTTP 503 fetching/);
  assert.ok(result.failures[0].sourceUrls.includes(bad.fileUrl));
  assert.equal(result.failures[1].sourceId, malformed.id);
  assert.match(result.failures[1].reason, /ZIP_INVALID/);
  assert.equal(result.scopes.length, 1);
  assert.equal(result.scopes[0].version, "overlay:controlled-good");
  assert.equal(result.scopes[0].groupings.length, 1);
  assert.equal(result.scopes[0].groupings[0].overlaps[0].fraction, 1);
});

const fixture = (name: string) => readFile(new URL(`./fixtures/geography/overlay/${name}`, import.meta.url));

test("the original GRANIT DBF holds 39 overlays and the three preserved polygons retain their original coordinates", async () => {
  const bytes = await fixture("NHHouseDistricts2022_Float.zip");
  const attributes = readDbf(await fixture("NHHouseDists2022_float.dbf"));
  assert.equal(attributes.length, 40);
  assert.equal(attributes.filter((row) => row.FloatHse22).length, 39);
  assert.equal(attributes.find((row) => row.FloatHse22 === "RO31")?.OBJECTID, "25");
  const original = JSON.parse((await fixture("original-polygons.json")).toString());
  assert.deepEqual(readBoundaryZip(bytes).features.filter((feature) => ["RO31", "ME28", "ST18"].includes(feature.properties.FloatHse22)), original);
  const boundaries = parseOverlayBoundaryZip(source, bytes);
  assert.equal(boundaries.length, 39);
  const reader = JSON.parse((await fixture("floterials.geojson")).toString());
  for (const feature of reader.features) assert.deepEqual(feature.geometry, boundaries.find((boundary) => boundary.code === feature.properties.code)?.geometry);
  assert.match(readZip(bytes).find((entry) => entry.name.endsWith(".prj"))!.data.toString(), /Foot_US/);
});

test("the real four-column election document preserves official towns and its unmarked overlay row", async () => {
  const lines = await districtDocumentLines(await fixture("2022-state-representative-and-delegate-districts.pdf"), source.documentLayout);
  assert.ok(lines.includes("District No. 18 (1)"));
  const assignments = parseDistrictTownAssignments(source, lines, [], ["ST18"]);
  // The PDF omits FL on this actual overlay district; boundary identity supplies
  // the candidate while the independent town list still has to agree.
  assert.equal(assignments.length, 39);
  assert.deepEqual(assignments.find((row) => row.code === "ST18")?.towns, []);
  const known = readBoundaryZip(await fixture("NHPolitDists2022.zip")).features.map((feature) => {
    const ward = /ward\s*\d+/i.exec(feature.properties.DISTRICT)?.[0];
    return feature.properties.NAME + (ward ? ` ${ward}` : "");
  });
  const compared = parseDistrictTownAssignments(source, lines, known, ["ST18"]);
  assert.deepEqual(compared.find((row) => row.code === "RO31")?.towns, ["auburn", "candia", "chester", "deerfield"]);
  assert.deepEqual(compared.find((row) => row.code === "ME28")?.towns, ["concord ward 1", "concord ward 2", "concord ward 3"]);
  assert.deepEqual(compared.find((row) => row.code === "ST18")?.towns, ["barrington", "middleton", "new durham", "strafford"]);
  const all = parseDistrictTownAssignments(source, lines, known, ["ME7", "ST18"]);
  assert.deepEqual(all.find((row) => row.code === "ME7")?.towns, ["new london", "newbury"]);
  assert.ok(!compared.some((row) => row.towns.includes("newbury")));
});

test("Census partition members come from complete official town/ward lists, including whole cities", () => {
  const partition = [{ geoid: "base1", code: "EX1" }, { geoid: "base2", code: "EX2" }, { geoid: "base3", code: "EX3" }];
  const rows = [{ code: "EX1", towns: ["One"] }, { code: "EX2", towns: ["City Ward 1", "City Ward 2"] }, { code: "EX3", towns: ["Other"] }, { code: "EX4", towns: ["One", "City Ward 1", "City Ward 2"] }];
  assert.deepEqual(overlayDocumentMembers("EX4", partition, rows), { geoids: ["base1", "base2"], partial: [], uncovered: [] });
  assert.deepEqual(overlayDocumentMembers("EX4", partition, [...rows.slice(0, 3), { code: "EX4", towns: ["One", "City Ward 1"] }]), { geoids: ["base1"], partial: ["base2"], uncovered: ["city ward 1"] });
});

test("an explicitly marked election-document overlay absent from the boundary file stays a source difference", () => {
  const assignments = parseDistrictTownAssignments(source, ["ROCKINGHAM COUNTY", "1 Example Base Town", "31 FL Example Overlay Town"], [], ["RO1"]);
  assert.deepEqual(assignments.find((assignment) => assignment.code === "RO31"), { code: "RO31", towns: ["example overlay"], overlay: true });
  const overlayCodes = new Set<string>();
  const checked = verifyOverlayTowns(source, [], [], assignments.filter((assignment) => assignment.overlay || overlayCodes.has(assignment.code)));
  assert.equal(checked.reports.length, 1);
  assert.equal(checked.reports[0].code, "RO31");
  assert.match(checked.reports[0].reason, /absent from the boundary file/);
});

let realAcquisition: ReturnType<typeof acquireOverlayScopes> | undefined;
function acquireRealFixture() {
  realAcquisition ??= acquireOverlayScopes({ fetchImpl: async (input) => {
    const url = String(input);
    // Preserve the observed SOS failure and successful legislature-hosted copy.
    if (url === source.townDocumentUrl) return new Response("official publisher returned Access Denied", { status: 403 });
    const path = new Map([[source.fileUrl, "NHHouseDistricts2022_Float.zip"], [source.townDocumentMirrors![0], "2022-state-representative-and-delegate-districts.pdf"], [source.townBoundaryUrl, "NHPolitDists2022.zip"], [source.partitionBoundaryUrl!, "tl_2024_33_sldl.zip"], [source.partitionRelationshipUrl!, "tab20_sldl202420_zcta520_33.txt"]]).get(url);
    assert.ok(path, `Unexpected source request: ${url}`);
    return new Response(new Uint8Array(await fixture(path)));
  } });
  return realAcquisition;
}

test("real sources publish 38 agreeing overlays and retain the Keene Ward 2 discrepancy with both sources", async () => {
  const result = await acquireRealFixture();
  assert.deepEqual(result.failures, []);
  assert.equal(result.scopes.length, 1);
  assert.equal(result.scopes[0].instanceCount, 38);
  assert.equal(result.scopes[0].zctaEdgeCount, 199);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].code, "CH16");
  assert.deepEqual(result.reports[0].documentOnly, ["keene ward 2"]);
  assert.ok(!result.scopes[0].groupings.some((district) => district.geoid === "33CH16"));
  assert.deepEqual(result.scopes[0].groupings.find((district) => district.geoid === "33RO31")?.sourceUrls, [source.fileUrl, source.townDocumentMirrors![0]]);
});

test("real Census land shares find Candia's floterial and give Newbury no invented overlay", async () => {
  const scope = (await acquireRealFixture()).scopes[0];
  const edges = (zip: string) => scope.groupings.filter((district) => district.overlaps.some((edge) => edge.zcta5 === zip));
  assert.deepEqual(edges("03034").map((district) => district.geoid), ["33RO31"]);
  assert.deepEqual(edges("03034")[0].overlaps.find((edge) => edge.zcta5 === "03034"), { zcta5: "03034", whole: true, fraction: 1 });
  assert.deepEqual(edges("03255"), []);
});
