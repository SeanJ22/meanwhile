/**
 * Local build + verification of the census-geography dataset (developer tool).
 * Fetches the Census tab20 files via the shared `acquireDataset` and optionally
 * writes the built dataset JSON (e.g. to regenerate the committed AZ bootstrap).
 *
 * Production publishes AUTOMATICALLY via the routine contract
 * (`scripts/census-geography-refresh.mts`, run by the standing runner). This
 * script never touches the production data plane.
 *
 *   pnpm exec tsx scripts/census-geo-build.mts --only=cd119 --verify-state=04
 *   pnpm exec tsx scripts/census-geo-build.mts --states=04 --out=lib/census-geography/bootstrap-az.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { acquireDataset } from "../lib/census-geography/acquire.ts";
import type { BuiltScope } from "../lib/census-geography/dataset.ts";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function verifyState(scope: BuiltScope, stateFips: string): void {
  const inState = scope.groupings.filter((g) => g.stateFips === stateFips);
  process.stdout.write(
    `\n== ${scope.type} ${scope.version} — state ${stateFips} (${inState[0]?.stateAbbr ?? "?"}): ${inState.length} groupings ==\n`,
  );
  for (const g of inState) {
    const whole = g.overlaps.filter((o) => o.whole).length;
    process.stdout.write(
      `  ${g.geoid}  ${String(g.overlaps.length).padStart(4)} ZCTAs (${whole} whole, ${g.overlaps.length - whole} partial)  ${g.label}\n`,
    );
  }
}

async function main(): Promise<void> {
  const only = arg("only")?.split(",").map((k) => k.trim());
  const statesArg = arg("states");
  const states = statesArg ? new Set(statesArg.split(",").map((s) => s.trim())) : undefined;
  const verifyStateFips = arg("verify-state");
  const out = arg("out");

  const dataset = await acquireDataset({ only, states });

  for (const s of dataset.scopes) {
    process.stderr.write(`[${s.version}] ${s.instanceCount} groupings, ${s.zctaEdgeCount} ZCTA edges\n`);
  }
  process.stdout.write(
    `\n== dataset: ${dataset.scopes.length} scope(s), ${dataset.scopes.reduce((n, s) => n + s.zctaEdgeCount, 0)} ZCTA edges, ${dataset.zctaUniverse.length} distinct ZCTAs ==\n`,
  );
  process.stdout.write(`   coverage: ${dataset.coverage}\n`);
  if (verifyStateFips) for (const s of dataset.scopes) verifyState(s, verifyStateFips);
  if (out) {
    const json = JSON.stringify(dataset);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json);
    process.stdout.write(`wrote ${out} (${(json.length / 1e6).toFixed(2)} MB)\n`);
  }
}

await main();
