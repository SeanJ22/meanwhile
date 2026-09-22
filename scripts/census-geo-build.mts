/**
 * Build the ZCTA↔geography overlap dataset from Census tab20 relationship
 * files. MANUAL/local acquisition (not a registered contract command): it
 * fetches from www2.census.gov, which is reachable from a workstation but
 * blocked for the runner, so the built dataset is what the promote path
 * consumes — this script does not touch the production data plane.
 *
 * Records provenance (URL, byte size, SHA-256, Last-Modified) while streaming,
 * so nothing is asserted about a file that was not actually read.
 *
 *   pnpm exec tsx scripts/census-geo-build.mts --only=cd119 --verify-state=04
 *   pnpm exec tsx scripts/census-geo-build.mts --out=<path>        # write dataset JSON
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { GeographyType, GeographyVersion } from "../lib/census-geography/contract.ts";
import type { BuiltDataset, BuiltScope } from "../lib/census-geography/dataset.ts";
import {
  ScopeAccumulator,
  parseTab20Header,
  resolveTab20Columns,
  type Tab20Spec,
} from "../lib/census-geography/build.ts";

const REL = "https://www2.census.gov/geo/docs/maps-data/data/rel2020";
const UA = `we-the-people census-geography importer (contact: ${process.env.INGEST_CONTACT_EMAIL ?? "https://github.com/SeanJ22/we-the-people"})`;

interface Source extends Tab20Spec {
  readonly url: string;
  readonly plan: string;
  readonly effectiveFor: string;
}

const SOURCES: Record<string, Source> = {
  cd119: {
    type: "congressional_district", version: "cd:119", geoTag: "CD119_20", labelSuffix: "(119th Congress)",
    url: `${REL}/cd-sld/tab20_cd11920_zcta520_natl.txt`,
    plan: "119th Congress", effectiveFor: "current representation (119th Congress, 2025–2027)",
  },
  sldu: {
    type: "state_leg_upper", version: "sldu:2024", geoTag: "SLDU2024_20", labelSuffix: "(2024 plan)",
    url: `${REL}/cd-sld/tab20_sldu202420_zcta520_natl.txt`,
    plan: "2024 state upper-chamber plan", effectiveFor: "current state upper-chamber districts (2024 plan)",
  },
  sldl: {
    type: "state_leg_lower", version: "sldl:2024", geoTag: "SLDL2024_20", labelSuffix: "(2024 plan)",
    url: `${REL}/cd-sld/tab20_sldl202420_zcta520_natl.txt`,
    plan: "2024 state lower-chamber plan", effectiveFor: "current state lower-chamber districts (2024 plan)",
  },
  county: {
    type: "county", version: "county:2020", geoTag: "COUNTY_20",
    url: `${REL}/zcta520/tab20_zcta520_county20_natl.txt`,
    plan: "2020 counties / county-equivalents", effectiveFor: "2020-vintage counties",
  },
  place: {
    type: "place", version: "place:2020", geoTag: "PLACE_20",
    url: `${REL}/zcta520/tab20_zcta520_place20_natl.txt`,
    plan: "2020 places", effectiveFor: "2020-vintage places",
  },
  cousub: {
    type: "county_subdivision", version: "cousub:2020", geoTag: "COUSUB_20",
    url: `${REL}/zcta520/tab20_zcta520_cousub20_natl.txt`,
    plan: "2020 county subdivisions", effectiveFor: "2020-vintage county subdivisions",
  },
};

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function streamLines(
  url: string,
  onLine: (line: string) => void,
): Promise<{ bytes: number; sha256: string; lastModified: string | null }> {
  const hash = createHash("sha256");
  let bytes = 0;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const lastModified = res.headers.get("last-modified");
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      hash.update(value);
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, nl).replace(/\r$/, ""));
        buf = buf.slice(nl + 1);
      }
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) onLine(buf.replace(/\r$/, ""));
  return { bytes, sha256: hash.digest("hex"), lastModified };
}

async function buildScope(key: string, src: Source): Promise<BuiltScope> {
  const filename = src.url.split("/").pop() ?? src.url;
  // Holder object: a `let` assigned only inside the stream callback collapses to
  // its init type for TS control flow; an object property keeps its declared type.
  const state: { acc: ScopeAccumulator | null } = { acc: null };
  const t0 = Date.now();
  process.stderr.write(`\n[${key}] fetching ${src.url}\n`);
  const { bytes, sha256, lastModified } = await streamLines(src.url, (line) => {
    if (state.acc === null) {
      const cols = resolveTab20Columns(parseTab20Header(line), src.geoTag);
      state.acc = new ScopeAccumulator(src, cols);
      return;
    }
    if (line.trim() === "") return;
    state.acc.add(line.split("|"));
  });
  if (state.acc === null) throw new Error(`[${key}] no header line read from ${src.url}`);
  const acc = state.acc;
  const versionMeta: GeographyVersion = {
    key: src.version,
    type: src.type as GeographyType,
    plan: src.plan,
    zctaTabulation: "2020",
    effectiveFor: src.effectiveFor,
    provenance: {
      sourceUrls: [src.url],
      sourceDataset: "CENSUS_TAB20_REL2020",
      sourceFiles: [filename],
      sourceChecksums: [sha256],
      method:
        `Census 2020-tabulation ZCTA↔${src.geoTag.replace(/_20$/, "")} relationship file ` +
        `(${filename}); a ZCTA is an edge if it shares any land with the geography; ` +
        `area share = AREALAND_PART / AREALAND_ZCTA5_20 (population weight unavailable in this file).`,
      computedAt: new Date().toISOString(),
    },
  };
  const scope = acc.finish(versionMeta);
  const s = acc.stats();
  process.stderr.write(
    `[${key}] ${(bytes / 1e6).toFixed(1)} MB  sha256=${sha256.slice(0, 12)}…  ` +
      `last-modified=${lastModified ?? "?"}  rows=${s.rows} skippedBlank=${s.skippedBlank}  ` +
      `${scope.instanceCount} groupings, ${scope.zctaEdgeCount} ZCTA edges  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`,
  );
  return scope;
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

/** Restrict a scope's groupings to the given state FIPS set (for a priority batch). */
function filterScopeByStates(scope: BuiltScope, states: ReadonlySet<string>): BuiltScope {
  const groupings = scope.groupings.filter((g) => states.has(g.stateFips));
  return {
    ...scope,
    groupings,
    instanceCount: groupings.length,
    zctaEdgeCount: groupings.reduce((n, g) => n + g.overlaps.length, 0),
  };
}

async function main(): Promise<void> {
  const only = arg("only");
  const keys = only ? only.split(",").map((k) => k.trim()) : Object.keys(SOURCES);
  const verifyStateFips = arg("verify-state");
  const out = arg("out");
  const statesArg = arg("states");
  const states = statesArg ? new Set(statesArg.split(",").map((s) => s.trim())) : null;

  const scopes: BuiltScope[] = [];
  for (const key of keys) {
    const src = SOURCES[key];
    if (!src) throw new Error(`unknown source "${key}"; known: ${Object.keys(SOURCES).join(", ")}`);
    let scope = await buildScope(key, src);
    if (states) scope = filterScopeByStates(scope, states);
    scopes.push(scope);
    if (verifyStateFips) verifyState(scope, verifyStateFips);
  }

  const zctaUniverse = new Set<string>();
  for (const s of scopes) for (const g of s.groupings) for (const o of g.overlaps) zctaUniverse.add(o.zcta5);

  const coverage = states
    ? `priority batch: ${states.size} state(s) [${[...states].sort().join(",")}]; ${scopes.length} type(s): ${scopes.map((s) => s.version).join(", ")}`
    : `national; ${scopes.length} geography type(s): ${scopes.map((s) => s.version).join(", ")}`;

  const dataset: BuiltDataset = {
    formatVersion: 1,
    builtAt: new Date().toISOString(),
    coverage,
    scopes,
    zctaUniverse: [...zctaUniverse].sort(),
  };

  process.stdout.write(
    `\n== dataset: ${scopes.length} scope(s), ${scopes.reduce((n, s) => n + s.zctaEdgeCount, 0)} total ZCTA edges, ${zctaUniverse.size} distinct ZCTAs ==\n`,
  );
  process.stdout.write(`   coverage: ${coverage}\n`);
  if (out) {
    const json = JSON.stringify(dataset);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json);
    process.stdout.write(`wrote ${out} (${(json.length / 1e6).toFixed(2)} MB)\n`);
  }
}

await main();
