/** Rebuild ZIP orientation from national sources. `pnpm zcta:fetch [--from DIRECTORY]` uses saved downloads. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readZipEntries } from "../lib/sources/archive.ts";
import { readBoundaryZip } from "../lib/geo/shapefile.ts";
import { buildPostalTable } from "../lib/geo/build-postal-table.ts";
import { assertGovernmentZipCoverage, parseGazetteer, parseGeoNames, parsePostalTypes } from "../lib/geo/zip-source.ts";

const ROOT = process.cwd();
const SOURCES = {
  "zcta.zip": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2021_Gazetteer/2021_Gaz_zcta_national.zip",
  "US.zip": "https://download.geonames.org/export/zip/US.zip",
  "types-alt.csv": "https://raw.githubusercontent.com/seanpianka/Zipcodes/master/scripts/data/zip_code_database.csv",
  "zcta-polygons.zip": "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip",
  "place-polygons.zip": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_place_500k.zip",
  "county-polygons.zip": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_500k.zip",
};

function member(buffer: Buffer, name: string): string {
  const entries = readZipEntries(buffer, { maxMemberBytes: 32 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 });
  const entry = entries.find(entry => entry.name === name);
  if (!entry) throw new Error(`Source archive is missing ${name}`);
  return entry.data.toString("utf8");
}

async function main() {
  const arg = process.argv.indexOf("--from");
  const from = arg >= 0 ? process.argv[arg + 1] : null;
  if (arg >= 0 && !from) throw new Error("--from needs a directory of saved source downloads");
  const cache = from ?? join(ROOT, ".cache", "zip-entry");
  await mkdir(cache, { recursive: true });
  if (!from) {
    for (const [name, url] of Object.entries(SOURCES)) {
      console.log(`Reading ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}; committed tables remain intact`);
      await writeFile(join(cache, name), Buffer.from(await response.arrayBuffer()));
    }
  }
  const read = (name: string) => readFile(join(cache, name));
  const centroids = parseGazetteer(member(await read("zcta.zip"), "2021_Gaz_zcta_national.txt"));
  const governments = JSON.parse(await readFile(join(ROOT, "data", "derived", "zip-governments.json"), "utf8")) as { zips: Record<string, unknown> };
  assertGovernmentZipCoverage(centroids, Object.keys(governments.zips));
  if (Object.keys(centroids).length < 33791) throw new Error("Incomplete 2020 ZCTA Gazetteer");
  const geoNames = parseGeoNames(member(await read("US.zip"), "US.txt"));
  const types = parsePostalTypes((await read("types-alt.csv")).toString("utf8"));
  if (Object.keys(geoNames).length < 41000 || Object.keys(types).length < 41000) throw new Error("Incomplete national postal source");
  const boundaries = {
    zcta: readBoundaryZip(await read("zcta-polygons.zip")).features,
    place: readBoundaryZip(await read("place-polygons.zip")).features,
    county: readBoundaryZip(await read("county-polygons.zip")).features,
  };
  const zips = buildPostalTable(centroids, geoNames, types, boundaries);
  const generatedAt = new Date().toISOString();
  const centroidFile = { source: SOURCES["zcta.zip"], sourceOrg: "U.S. Census Bureau", vintage: "2020", release: "2021", generatedAt,
    complete: true, note: "Complete 2020 ZCTA internal points, released in the 2021 Gazetteer. Map orientation only; districts require a residential address. Regenerate with pnpm zcta:fetch.", centroids };
  const postalFile = { generatedAt, source: SOURCES["US.zip"], sourceOrg: "GeoNames", license: "CC BY 4.0", attribution: "https://www.geonames.org/",
    typeSource: SOURCES["types-alt.csv"], typeSourceOrg: "Zipcodes / unitedstateszipcodes.org", boundarySources: [SOURCES["zcta-polygons.zip"], SOURCES["place-polygons.zip"], SOURCES["county-polygons.zip"]],
    note: "Census coordinates take precedence for ZCTAs; other ZIPs use GeoNames coordinates, or the postal-type source when GeoNames has no row. Spatial containment maps ZCTA, place and county; null means no containing shape. No ZIP alone proves residential districts.",
    columns: ["lat", "lng", "type", "zcta", "place", "state", "county", "countyFips", "placeGeoid"], zips };
  // Every input and the full join validate before either committed table is replaced.
  await writeFile(join(ROOT, "lib", "geo", "zcta-centroids.json"), JSON.stringify(centroidFile) + "\n");
  await writeFile(join(ROOT, "lib", "geo", "postal-zips.json"), JSON.stringify(postalFile) + "\n");
  console.log(`Wrote ${Object.keys(centroids).length} ZCTAs and ${Object.keys(zips).length} postal ZIPs`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
