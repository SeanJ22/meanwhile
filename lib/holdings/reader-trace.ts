import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";


export interface ReaderTraceRequirement { route: string; loader: string; files: string[] }
/** Input contracts, independently checked against Next's emitted deployment manifests. */
export function readerTraceRequirements(_root: string): ReaderTraceRequirement[] {
  // Place and point memberships are database reads. The body-territory reader
  // still selects its remote geometry from this manifest.
  const staticGeography = ["data/derived/state-geometry.json"];
  const zipArea = ["data/derived/zip-coverage-tiers-runtime.json"];
  return [
    ...["api/meetings/route", "api/representation/[...division]/route", "api/votes/route", "api/ask/grounded/route", "ballot/page", "about-area/page"].map((route) => ({ route, loader: "lib/registry/server.ts", files: staticGeography })),
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
