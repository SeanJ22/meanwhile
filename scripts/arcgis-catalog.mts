/**
 * `pnpm arcgis:catalog` — WALK AN ARCGIS SERVER AND NAME EVERY LAYER IT HOLDS.
 *
 * ## Why enumerating the server beats enumerating the portal
 *
 * Pima County's open-data PORTAL lists 199 items, and six of them are named
 * `Districts - *`. The SERVER behind it holds many more layers than the portal
 * advertises, because a portal item is a curation decision and a server layer
 * is what exists. A session that reads only the portal concludes the county
 * publishes six district boundaries.
 *
 * It also fixes a guess that reads exactly like an absence:
 * `gisdata.pima.gov/arcgis/rest/services` returns **HTTP 404**, and the real
 * root is `/arcgis1/`. **A 404 on a guessed path is a failed guess, never a
 * host that publishes nothing** — and the way to stop guessing is to read the
 * catalog the portal's own item URLs point at.
 *
 * Usage:
 *   pnpm arcgis:catalog --root https://gisdata.pima.gov/arcgis1/rest/services --out data/hunt/x.json
 *   pnpm arcgis:catalog --root <root> --folder GISOpenData --grep district
 */

import { writeFileSync } from "node:fs";

import { floored } from "../lib/ops/denominator-floor.ts";

const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface CatalogResponse {
  error?: { code: number; message: string };
  folders?: string[];
  services?: Array<{ name: string; type: string }>;
  layers?: Array<{ id: number; name: string; geometryType?: string; parentLayerId?: number }>;
  tables?: Array<{ id: number; name: string }>;
}

async function j(url: string): Promise<CatalogResponse> {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}f=json`, {
    headers: { "user-agent": UA, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as CatalogResponse;
  if (body.error) throw new Error(`service error ${body.error.code}: ${body.error.message}`);
  return body;
}

const root = arg("root");
if (!root) {
  console.error("--root <arcgis rest services url> is required");
  process.exit(2);
}
const onlyFolder = arg("folder");
const grep = arg("grep");

interface LayerRow {
  service: string;
  serviceType: string;
  layerId: number;
  name: string;
  geometryType: string | null;
  parentLayerId: number;
  url: string;
}

const catalogRoot = await j(root);
const folders: string[] = onlyFolder ? [onlyFolder] : ["", ...(catalogRoot.folders ?? [])];

const services: Array<{ name: string; type: string }> = [];
for (const folder of folders) {
  const url = folder ? `${root}/${folder}` : root;
  try {
    const f = await j(url);
    for (const s of f.services ?? []) services.push({ name: s.name, type: s.type });
  } catch (e) {
    console.error(`folder ${folder || "(root)"} FAILED: ${(e as Error).message}`);
  }
}

const rows: LayerRow[] = [];
const failed: string[] = [];
for (const s of services) {
  if (s.type !== "MapServer" && s.type !== "FeatureServer") continue;
  const url = `${root}/${s.name}/${s.type}`;
  try {
    const svc = await j(url);
    for (const l of svc.layers ?? []) {
      rows.push({
        service: s.name,
        serviceType: s.type,
        layerId: l.id,
        name: l.name,
        geometryType: l.geometryType ?? null,
        parentLayerId: l.parentLayerId ?? -1,
        url: `${url}/${l.id}`,
      });
    }
    for (const t of svc.tables ?? []) {
      rows.push({
        service: s.name,
        serviceType: s.type,
        layerId: t.id,
        name: `${t.name} (table)`,
        geometryType: null,
        parentLayerId: -1,
        url: `${url}/${t.id}`,
      });
    }
  } catch (e) {
    // A service that will not describe itself is a FAILED read. Left out of the
    // count silently, it would shrink the catalog and read as a smaller server.
    failed.push(`${s.name}: ${(e as Error).message}`);
  }
}

// RULING 159 — the layer count is reported against the SERVICES it was read
// from. A catalog walk that reached no service must fail loudly rather than
// print "0 layers", which reads as a government that publishes nothing and is
// exactly the wrong conclusion — the real root was found only after five
// guessed hostnames returned 404.
floored("arcgis catalog layers", root, services.length, rows.length);

console.log(`ARCGIS CATALOG — ${root}`);
console.log(`  folders    ${folders.length}`);
console.log(`  services   ${services.length}`);
console.log(`  layers     ${rows.length}`);
console.log(`  failed     ${failed.length}`);
console.log("");
for (const f of failed) console.log(`  FAILED ${f}`);
if (failed.length) console.log("");

const show = grep ? rows.filter((r) => new RegExp(grep, "i").test(r.name)) : rows;
if (grep) console.log(`MATCHING /${grep}/i — ${show.length} layer(s)`);
for (const r of show) {
  console.log(`  ${r.name}`);
  console.log(`      ${r.geometryType ?? "table"}  ${r.url}`);
}

const out = arg("out");
if (out) {
  writeFileSync(
    out,
    JSON.stringify({ root, services: services.length, layers: rows, failedServices: failed }, null, 2) + "\n",
    "utf8",
  );
  console.log("");
  console.log(`wrote ${out}`);
}
