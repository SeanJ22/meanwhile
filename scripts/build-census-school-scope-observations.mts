/** Import retained complete Census/GEOS observations into the existing scope reference.
 * No network, database, assignments or publication. Reuses the recorded full-polygon
 * intersection, official LEAID/PID crosswalk and the existing OCD constructor. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { schoolIdentity } from "../lib/ocd/divisions.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = arg("evidence-root"), zip = arg("zip"), stamp = arg("stamp");
assert.ok(root && zip && /^\d{5}$/.test(zip) && stamp && /^\d{8}$/.test(stamp), "Provide --evidence-root, --zip and --stamp for retained evidence.");
const sources: { file: string; sha256: string }[] = [];
const read = (file: string) => {
  const bytes = readFileSync(join(root, file));
  sources.push({ file, sha256: createHash("sha256").update(bytes).digest("hex") });
  return JSON.parse(bytes.toString("utf8"));
};
const summary = read(`census-school-${zip}-${stamp}.json`);
const areas = read(`census-school-positive-area-${stamp}.json`);
const zcta = read(`zcta${zip}.geojson`);
assert.ok(zcta.geometry && areas.zctaAreaSquareMetres > 0 && /No buffer, simplification or geometry repair/.test(areas.method));
const crosswalk = readFileSync("data/derived/census-nces-crosswalk.csv", "utf8").split(/\r?\n/).slice(1).map(line => line.split(","));
const shard = JSON.parse(readFileSync(`data/derived/zip-divisions/${zip.slice(0, 2)}.json`, "utf8"));
const layers: Record<number, string> = { 0: "unsd", 1: "scsd", 2: "elsd" };
assert.deepEqual(summary.layers.map((layer: { layer: number }) => layer.layer).sort(), [0, 1, 2], "All school layers must be accounted for, including empty layers.");
const records = [];
for (const layer of summary.layers) {
  assert.match(layer.url, /^https:\/\/tigerweb\.geo\.census\.gov\/arcgis\/rest\/services\/TIGERweb\/School\/MapServer\/[012]\/query$/);
  const raw = read(`census-school-layer-${layer.layer}-${zip}-${stamp}.geojson`);
  assert.ok(!raw.error && !raw.exceededTransferLimit && Array.isArray(raw.features), "Truncated or failed Census responses cannot define scope.");
  assert.deepEqual(raw.features.map((f: { properties: { GEOID: string } }) => f.properties.GEOID).sort(), layer.features.map((f: { GEOID: string }) => f.GEOID).sort());
  for (const feature of raw.features) {
    const geoid = feature.properties.GEOID;
    const measurements = areas.rows.filter((row: { GEOID: string }) => row.GEOID === geoid);
    assert.equal(measurements.length, 1, `One exact area measurement required for ${geoid}`);
    const area = measurements[0];
    if (!area.positiveArea) { assert.equal(area.overlapSquareMetres, 0); continue; }
    assert.ok(area.overlapSquareMetres > 0 && area.overlapSquareMetres <= areas.zctaAreaSquareMetres);
    const matches = crosswalk.filter(parts => {
      const index = parts.findIndex(p => p === "INDEPENDENT" || p === "DEPENDENT");
      return index >= 0 && parts[index + 1] === geoid;
    });
    assert.equal(matches.length, 1, `Unique Census PID6/LEAID bridge required for ${geoid}`);
    const identity = schoolIdentity(geoid.slice(0, 2), feature.properties.NAME);
    assert.ok(identity && shard.divisions.includes(identity.ocdId), "Reuse an existing held division identity, never mint an unreviewed name join.");
    records.push({ zcta: zip, zctaVintage: "2020", sourceVintage: layer.vintage, observedAt: summary.at,
      layer: layers[layer.layer], geoid, pid6: matches[0][0], ocdId: identity.ocdId, name: feature.properties.NAME,
      overlapSquareMetres: area.overlapSquareMetres, zctaAreaSquareMetres: areas.zctaAreaSquareMetres, sourceUrl: layer.url });
  }
}
assert.equal(records.length, areas.rows.filter((row: { positiveArea: boolean }) => row.positiveArea).length);
const count = floored("positive school overlaps", "retained complete Census polygon intersection measurements", areas.rows.length, records.length);
const output = "lib/control-plane/expansion/reference/census-school-intersections.json";
const prior = JSON.parse(readFileSync(output, "utf8"));
writeFileSync(output, JSON.stringify({ formatVersion: 1, method: areas.method, sourceEvidence: sources,
  records: [...prior.records.filter((row: { zcta: string }) => row.zcta !== zip), ...records] }, null, 2) + "\n");
console.log(JSON.stringify({ zip, count: floorLine(count), output, paidCalls: 0 }));
