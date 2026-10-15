import { fetchSource } from "../lib/sources/fetch-source.ts";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "tiger");
const BASE = "https://www2.census.gov/geo/tiger";

/** 15 minutes. A batch budget, never the live map's. */
const BATCH_TIMEOUT_MS = 15 * 60 * 1000;

const CONTACT = process.env.INGEST_CONTACT_EMAIL ?? "seanj22@gmail.com";
const UA = `we-the-people/1.0 (civic transparency; contact: ${CONTACT})`;


const FILES = [
  "GENZ2023/shp/cb_2023_us_county_500k",
  "GENZ2023/shp/cb_2023_us_place_500k",
  "GENZ2023/shp/cb_2023_us_cousub_500k",
  "GENZ2023/shp/cb_2023_us_unsd_500k",
  "GENZ2023/shp/cb_2023_us_elsd_500k",
  "GENZ2023/shp/cb_2023_us_scsd_500k",
  "GENZ2020/shp/cb_2020_us_zcta520_500k",
];

mkdirSync(CACHE, { recursive: true });

const walls: string[] = [];
let fetched = 0;
let cached = 0;

for (const path of FILES) {
  const name = `${path.split("/").pop()}.zip`;
  const dest = join(CACHE, name);

  try {
    if (statSync(dest).size > 0) {
      console.log(`CACHED  ${name} (${statSync(dest).size} bytes) — not re-fetched`);
      cached += 1;
      continue;
    }
  } catch {
    // Not cached. Fall through and fetch.
  }

  const url = `${BASE}/${path}.zip`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
  try {
    const started = Date.now();
    const res = await fetchSource(url, {
      headers: { "user-agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after");
      walls.push(
        `WALL ${name}: HTTP ${res.status}${retryAfter ? ` (Retry-After: ${retryAfter})` : ""} — rung 2, plain fetch`,
      );
      console.log(`WALL    ${name}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    fetched += 1;
    console.log(
      `FETCHED ${name}: ${buf.length} bytes in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    // Name whose stopwatch ran out.
    const why = aborted
      ? `OUR ${BATCH_TIMEOUT_MS / 60000}-minute batch budget expired — this is not a refusal by census.gov`
      : String(err);
    walls.push(`WALL ${name}: ${why}`);
    console.log(`WALL    ${name}: ${why}`);
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n${fetched} fetched, ${cached} already cached, ${walls.length} walled`);
for (const w of walls) console.log(`  ${w}`);
if (walls.length) {
  console.log(
    "\nA walled file is a named gap, not an empty result. The join refuses to run " +
      "against a missing layer rather than reporting a smaller country.",
  );
  process.exit(1);
}
