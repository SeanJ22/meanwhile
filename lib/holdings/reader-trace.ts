import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { zipShardFiles } from "../geo/zip-division-index.ts";

export interface ReaderTraceRequirement { route: string; loader: string; files: string[] }
/** Input contracts, independently checked against Next's emitted deployment manifests. */
export function readerTraceRequirements(root: string): ReaderTraceRequirement[] {
  const resolver = "data/derived/resolver-geometry.json";
  const geometry = JSON.parse(readFileSync(join(root, resolver), "utf8")) as { files: string[] };
  const staticGeography = [...new Set([
    resolver,
    ...geometry.files,
    "data/states/az/geo/body-territories.geojson",
  ])];
  if (geometry.files.length === 0) throw new Error("Reader trace denominator is empty");
  // The national ZIP index is read one shard per request, and any ZIP can be asked for, so every shard must be traced.
  const shardDir = join(root, "data", "derived", "zip-divisions");
  const zipShards = zipShardFiles(shardDir).map((f) => `data/derived/zip-divisions/${f}`);
  if (zipShards.length === 0) throw new Error("Reader trace denominator is empty: no ZIP index shard");
  const zipArea = [
    "data/derived/zip-coverage-tiers-runtime.json",
    ...zipShards,
  ];
  return [
    ...["api/meetings/route", "api/representation/[...division]/route", "api/votes/route", "api/ask/grounded/route", "ballot/page", "about-area/page"].map((route) => ({ route, loader: "lib/registry/server.ts", files: staticGeography })),
    { route: "api/voting-sites/route", loader: "lib/geo/zip-division-index.ts + lib/geo/postal.ts", files: [...zipShards, "lib/geo/postal-zips.json"] },
    // The map reads only the ZIP index; the tier ledger's reader for it is `/api/log`.
    { route: "api/meetings/route", loader: "lib/geo/zip-division-index.ts + lib/registry/server.ts", files: zipShards },
    { route: "api/reader/places/route", loader: "lib/geo/zip-division-index.ts", files: [...zipShards, "data/derived/zip-divisions/index.json"] },
    { route: "ballot/page", loader: "lib/coverage/zip-tier.ts + lib/registry/server.ts", files: zipArea },
    { route: "api/ask/grounded/route", loader: "lib/coverage/zip-tier.ts + lib/registry/server.ts", files: zipArea },
    { route: "about-area/page", loader: "lib/coverage/zip-tier.ts", files: [zipArea[0]] },
    { route: "api/reactions/route", loader: "lib/coverage/zip-tier.ts", files: [zipArea[0]] },
    { route: "api/log/route", loader: "lib/coverage/zip-tier.ts", files: [zipArea[0]] },
    { route: "api/schema/route", loader: "lib/db/migrations/journal.ts", files: ["lib/db/migrations/meta/_journal.json"] },
  ];
}

export function missingReaderTraceFiles(expected: readonly string[], actual: ReadonlySet<string>): string[] {
  return expected.filter((file) => !actual.has(file));
}

export function checkReaderTraces(root: string): { routes: number; requirements: number; files: number; failures: string[] } {
  const requirements = readerTraceRequirements(root);
  const failures: string[] = [];
  for (const requirement of requirements) {
    const tracePath = join(root, ".next/server/app", `${requirement.route}.js.nft.json`);
    if (!existsSync(tracePath)) { failures.push(`Missing production trace: ${requirement.route}`); continue; }
    const trace = JSON.parse(readFileSync(tracePath, "utf8")) as { files: string[] };
    const actual = new Set(trace.files.map((file) => relative(root, resolve(dirname(tracePath), file)).replaceAll("\\", "/")));
    for (const missing of missingReaderTraceFiles(requirement.files, actual)) failures.push(`${requirement.route}: ${requirement.loader} cannot read untraced ${missing}`);
  }
  return { routes: new Set(requirements.map((r) => r.route)).size, requirements: requirements.length, files: new Set(requirements.flatMap((r) => r.files)).size, failures };
}
