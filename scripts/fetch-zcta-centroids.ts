/**
 * Build lib/geo/zcta-centroids.json from Census ZCTA Gazetteer data.
 *
 *   pnpm zcta:fetch
 *
 * The Gazetteer file gives an internal point (INTPTLAT/INTPTLONG) for every
 * ZCTA in the country — a point guaranteed to fall inside the polygon, unlike a
 * bare centroid, which for a C-shaped ZCTA can land outside it. That point is
 * what the map flies to.
 *
 * These are orientation coordinates and nothing else. A ZCTA is a statistical
 * shape built from mail delivery routes; it crosses city, county, school
 * district, and legislative lines. It can never resolve a ballot.
 *
 * The file this writes is committed. Rerun it when Census publishes a new
 * vintage — it rewrites in place and the diff shows what moved.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { readZipEntries } from "../lib/sources/archive.ts";

const VINTAGE = "2020";
const SOURCE_URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${VINTAGE}_Gazetteer/${VINTAGE}_Gaz_zcta_national.zip`;
const SOURCE_ORG = "U.S. Census Bureau";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(here, "..", "lib", "geo", "zcta-centroids.json");
const TMP_ZIP = join(here, "..", ".zcta-download.zip");

interface CentroidFile {
  source: string;
  sourceOrg: string;
  vintage: string;
  generatedAt: string;
  /** False while this is the checked-in stub subset. */
  complete: boolean;
  note: string;
  /** Zip code to [latitude, longitude]. */
  centroids: Record<string, [number, number]>;
}

/** The Gazetteer release must contain exactly one complete text member. */
function extractSingleFile(zip: Buffer): string {
  const entries = readZipEntries(zip, { maxEntries: 1, maxMemberBytes: 32 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
  if (entries.length !== 1) throw new Error("Gazetteer ZIP must contain exactly one member.");
  return entries[0].data.toString("latin1");
}

/**
 * Parse the tab-delimited Gazetteer table by header name. Census has moved
 * column order between vintages; position-based parsing silently swaps
 * latitude and longitude when it does.
 */
function parseGazetteer(text: string): Record<string, [number, number]> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("Gazetteer file has no data rows.");

  const header = lines[0].split("\t").map((h) => h.trim().toUpperCase());
  const geoidCol = header.indexOf("GEOID");
  const latCol = header.indexOf("INTPTLAT");
  const lngCol = header.findIndex((h) => h === "INTPTLONG" || h === "INTPTLON");

  if (geoidCol === -1 || latCol === -1 || lngCol === -1) {
    throw new Error(
      `Gazetteer header missing expected columns. Saw: ${header.join(", ")}`,
    );
  }

  const centroids: Record<string, [number, number]> = {};
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const zip = cells[geoidCol]?.trim();
    const lat = Number(cells[latCol]?.trim());
    const lng = Number(cells[lngCol]?.trim());

    if (!/^\d{5}$/.test(zip ?? "") || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped++;
      continue;
    }

    // Five decimals is roughly a meter. More than that is noise for a map fly-to
    // and costs a megabyte across 33,000 rows.
    centroids[zip] = [
      Number(lat.toFixed(5)),
      Number(lng.toFixed(5)),
    ];
  }

  if (skipped > 0) console.warn(`  skipped ${skipped} unparseable row(s)`);
  return centroids;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}`);

  const response = await fetch(SOURCE_URL);
  if (!response.ok || !response.body) {
    throw new Error(
      `Census returned ${response.status} ${response.statusText}. ` +
        `Check the vintage in this script — Census moves these paths between releases.`,
    );
  }

  await mkdir(dirname(TMP_ZIP), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(TMP_ZIP),
  );

  try {
    const zip = await readFile(TMP_ZIP);
    console.log(`  ${(zip.length / 1_048_576).toFixed(1)} MB downloaded`);

    const centroids = parseGazetteer(extractSingleFile(zip));
    const count = Object.keys(centroids).length;

    if (count < 30_000) {
      throw new Error(
        `Only parsed ${count} ZCTAs; expected roughly 33,000. Refusing to ` +
          `overwrite the committed file with a partial result.`,
      );
    }

    const out: CentroidFile = {
      source: SOURCE_URL,
      sourceOrg: SOURCE_ORG,
      vintage: VINTAGE,
      generatedAt: new Date().toISOString(),
      complete: true,
      note:
        "ZCTA internal points, for map orientation only. A ZCTA crosses city, " +
        "county, school district, and legislative boundaries and can never " +
        "resolve a ballot. Regenerate with `pnpm zcta:fetch`.",
      centroids,
    };

    await writeFile(OUT_PATH, `${JSON.stringify(out, null, 0)}\n`);
    console.log(`Wrote ${count.toLocaleString()} ZCTA centroids to ${OUT_PATH}`);
  } finally {
    await rm(TMP_ZIP, { force: true });
  }
}

main().catch((error) => {
  console.error(`\nzcta:fetch failed — ${error.message}`);
  process.exitCode = 1;
});
