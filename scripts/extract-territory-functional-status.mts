import { fetchSource } from "../lib/sources/fetch-source.ts";
/** @freshness-reads-here */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readBoundaryAttributes } from "../lib/geo/shapefile.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { censusGeographyUserAgent } from "../lib/census-geography/http.ts";

const ROOT = process.cwd();
const CACHE = process.argv.find((a) => a.startsWith("--tiger="))?.slice(8) ?? join(ROOT, ".cache", "tiger");
const OUT = join(ROOT, "data", "reference", "census_tiger_2023_territory_functional_status.csv");
const BASE = "https://www2.census.gov/geo/tiger/TIGER2023";
/** 15 minutes. A batch budget: an expiry is our stopwatch, never a refusal by census.gov. */
const BATCH_TIMEOUT_MS = 15 * 60 * 1000;

/** The territories, from the FIPS table's own class rather than a list kept here. */
const TERRITORIES = Object.entries(FIPS_TO_STATE)
  .filter(([, s]) => s.prefix === "territory")
  .map(([fips]) => fips)
  .sort();
const LAYERS = ["county", "cousub", "place"] as const;
type Layer = (typeof LAYERS)[number];
const ARCHIVES: readonly { readonly layer: Layer; readonly file: string; readonly url: string }[] = [
  { layer: "county", file: "tl_2023_us_county.zip", url: `${BASE}/COUNTY/tl_2023_us_county.zip` },
  ...TERRITORIES.flatMap((fp) =>
    (["cousub", "place"] as const).map((layer) => ({ layer, file: `tl_2023_${fp}_${layer}.zip`, url: `${BASE}/${layer.toUpperCase()}/tl_2023_${fp}_${layer}.zip` })),
  ),
];

interface Receipt {
  readonly url: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly lastModified: string | null;
  readonly retrievedAt: string;
  readonly bytes: number;
  readonly sha256: string;
}

async function archive(file: string, url: string): Promise<{ readonly bytes: Buffer; readonly receipt: Receipt }> {
  const dest = join(CACHE, file);
  const receiptPath = `${dest}.receipt.json`;
  if (existsSync(dest) && statSync(dest).size > 0 && existsSync(receiptPath)) {
    const bytes = readFileSync(dest);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Receipt;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== receipt.sha256) throw new Error(`${dest} no longer matches its receipt (${sha256} != ${receipt.sha256}); delete both and rerun.`);
    console.log(`CACHED  ${file} (${bytes.length} bytes, read ${receipt.retrievedAt})`);
    return { bytes, receipt };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
  try {
    const response = await fetchSource(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal: controller.signal });
    const retrievedAt = new Date().toISOString();
    if (!response.ok) throw new Error(`census.gov answered HTTP ${response.status} for ${url}`);
    const finalUrl = response.url || url;
    if (new URL(finalUrl).hostname !== "www2.census.gov" || new URL(finalUrl).protocol !== "https:") throw new Error(`${url} was answered from ${finalUrl}, not census.gov over HTTPS`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const receipt: Receipt = {
      url,
      finalUrl,
      httpStatus: response.status,
      lastModified: response.headers.get("last-modified"),
      retrievedAt,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(dest, bytes);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 1)}\n`, "utf8");
    console.log(`FETCHED ${file} (${bytes.length} bytes)`);
    return { bytes, receipt };
  } finally {
    clearTimeout(timer);
  }
}

const COLUMNS = ["layer", "statefp", "geoid", "name", "namelsad", "lsad", "classfp", "funcstat"] as const;
const csvField = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const rows: Record<(typeof COLUMNS)[number], string>[] = [];
const receipts: Receipt[] = [];
for (const { layer, file, url } of ARCHIVES) {
  const { bytes, receipt } = await archive(file, url);
  receipts.push(receipt);
  for (const row of readBoundaryAttributes(bytes) as Record<string, string>[]) {
    const statefp = row.STATEFP ?? "";
    if (!TERRITORIES.includes(statefp)) continue;
    const geoid = row.GEOID ?? "";
    const funcstat = (row.FUNCSTAT ?? "").trim();
    if (geoid === "" || funcstat === "") throw new Error(`${file}: a territory row (${geoid || "no GEOID"}, ${row.NAMELSAD ?? row.NAME ?? ""}) carries no GEOID or no FUNCSTAT.`);
    rows.push({
      layer,
      statefp,
      geoid,
      name: (row.NAME ?? "").trim(),
      namelsad: (row.NAMELSAD ?? "").trim(),
      lsad: (row.LSAD ?? "").trim(),
      classfp: (row.CLASSFP ?? "").trim(),
      funcstat,
    });
  }
}
rows.sort((a, b) => LAYERS.indexOf(a.layer as Layer) - LAYERS.indexOf(b.layer as Layer) || a.geoid.localeCompare(b.geoid));
const keys = new Set(rows.map((r) => `${r.layer}:${r.geoid}`));
if (keys.size !== rows.length) throw new Error(`${rows.length - keys.size} territory row(s) repeat a layer and GEOID.`);
writeFileSync(OUT, `${COLUMNS.join(",")}\n${rows.map((r) => COLUMNS.map((c) => csvField(r[c])).join(",")).join("\n")}\n`, "utf8");

console.log(`\n${rows.length} rows -> ${OUT}\n\nFUNCSTAT by territory and layer:`);
for (const fp of TERRITORIES) {
  for (const layer of LAYERS) {
    const count: Record<string, number> = {};
    for (const r of rows) if (r.statefp === fp && r.layer === layer) count[r.funcstat] = (count[r.funcstat] ?? 0) + 1;
    console.log(`  ${FIPS_TO_STATE[fp].postal} ${layer.padEnd(6)} ${Object.entries(count).sort().map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
}
console.log("\nProvenance:");
for (const r of receipts) console.log(`  ${r.url} | HTTP ${r.httpStatus} | Last-Modified ${r.lastModified ?? "none"} | ${r.bytes} bytes | sha256 ${r.sha256} | read ${r.retrievedAt}`);
