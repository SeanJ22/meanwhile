import { createHash } from "node:crypto";

import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { GeographyType, GeographyVersion } from "./contract.ts";
import type { BuiltGrouping, BuiltOverlap, BuiltScope } from "./dataset.ts";
import { WHOLE_THRESHOLD } from "./build.ts";
import { censusGeographyUserAgent } from "./http.ts";
import { establishedApplicability } from "./selection.ts";

/** The 2026 congressional map from Census grf block files; the tab20 relationship files stop at the 119th Congress. Shares are area-based, as in the tab20 build. */
const GRF_BASE = "https://www2.census.gov/geo/docs/maps-data/data/grf/2026";

/** Every Census state and territory FIPS; one with no grf file 404s and is skipped. */
export const GRF_STATE_FIPS: readonly string[] = Object.keys(FIPS_TO_STATE)
  .filter((fips) => /^\d{2}$/.test(fips))
  .sort();

export interface GrfTarget {
  readonly type: GeographyType;
  readonly version: string;
  readonly column: "CDCURFP" | "SLDUST" | "SLDLST";
  /** District-code width: 2 for a congressional district, 3 for a state-leg district. */
  readonly districtWidth: number;
  readonly plan: string;
  readonly effectiveFor: string;
  readonly labelSuffix: string;
  readonly districtNoun: string;
}

export const GRF_CD120: GrfTarget = {
  type: "congressional_district",
  version: "cd:120",
  column: "CDCURFP",
  districtWidth: 2,
  plan: "120th Congress",
  effectiveFor: "2026 general election (120th Congress)",
  labelSuffix: "(120th Congress)",
  districtNoun: "Congressional District",
};

export interface GrfColumns {
  readonly state: number;
  readonly zcta: number;
  readonly land: number;
  readonly district: number;
}

export function parseGrfHeader(headerLine: string): string[] {
  return headerLine.replace(/^﻿/, "").trim().split("|");
}

export function resolveGrfColumns(header: readonly string[], column: GrfTarget["column"]): GrfColumns {
  const at = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`grf header is missing column "${name}"`);
    return i;
  };
  return { state: at("TABBLKST"), zcta: at("ZCTA5CE"), land: at("AREALAND"), district: at(column) };
}

function toNonNegative(raw: string | undefined): number {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * National accumulator for one grf target column. Holds only per-ZCTA and
 * per-(district, ZCTA) land totals, never the blocks — so a national build stays
 * small in memory even though the input is ~8M block rows.
 */
export class GrfAccumulator {
  private readonly zctaLand = new Map<string, number>();
  private readonly geoZctaLand = new Map<string, Map<string, number>>();
  private readonly geoState = new Map<string, string>();
  private blocks = 0;
  private readonly target: GrfTarget;
  private readonly cols: GrfColumns;

  constructor(target: GrfTarget, cols: GrfColumns) {
    this.target = target;
    this.cols = cols;
  }

  add(fields: readonly string[]): void {
    this.blocks += 1;
    const zcta = (fields[this.cols.zcta] ?? "").trim();
    if (zcta === "") return; // a block in no ZCTA (e.g. open water)
    const land = toNonNegative(fields[this.cols.land]);
    this.zctaLand.set(zcta, (this.zctaLand.get(zcta) ?? 0) + land);
    const district = (fields[this.cols.district] ?? "").trim();
    if (district === "" || district === "ZZ") return; // block assigned to no district of this layer
    const stateFips = (fields[this.cols.state] ?? "").trim().padStart(2, "0");
    const geoid = stateFips + district.padStart(this.target.districtWidth, "0");
    this.geoState.set(geoid, stateFips);
    let m = this.geoZctaLand.get(geoid);
    if (m === undefined) {
      m = new Map();
      this.geoZctaLand.set(geoid, m);
    }
    m.set(zcta, (m.get(zcta) ?? 0) + land);
  }

  stats(): { blocks: number; zctas: number; districts: number } {
    return { blocks: this.blocks, zctas: this.zctaLand.size, districts: this.geoZctaLand.size };
  }

  finish(versionMeta: GeographyVersion): BuiltScope {
    const groupings: BuiltGrouping[] = [];
    let edges = 0;
    for (const [geoid, zm] of this.geoZctaLand) {
      const stateFips = this.geoState.get(geoid) ?? geoid.slice(0, 2);
      const stateAbbr = FIPS_TO_STATE[stateFips]?.postal ?? "??";
      const districtCode = geoid.slice(2);
      const districtLabel = districtCode === "00" ? "(At Large)" : districtCode.replace(/^0+/, "") || "0";
      const overlaps: BuiltOverlap[] = [];
      for (const [zcta5, land] of zm) {
        const total = this.zctaLand.get(zcta5) ?? 0;
        const fraction = total > 0 ? Math.min(1, land / total) : null;
        overlaps.push({ zcta5, whole: fraction !== null && fraction >= WHOLE_THRESHOLD, fraction });
      }
      overlaps.sort((a, b) => (a.zcta5 < b.zcta5 ? -1 : a.zcta5 > b.zcta5 ? 1 : 0));
      edges += overlaps.length;
      groupings.push({
        geoid,
        ocdId: null,
        label: `${stateAbbr} ${this.target.districtNoun} ${districtLabel} ${this.target.labelSuffix}`.replace(/\s+/g, " ").trim(),
        stateFips,
        stateAbbr,
        memberStates: [stateAbbr],
        overlaps,
      });
    }
    groupings.sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));
    return {
      type: this.target.type,
      version: versionMeta.key,
      versionMeta,
      fractionBasis: "area",
      groupings,
      instanceCount: groupings.length,
      zctaEdgeCount: edges,
    };
  }
}

export interface AcquireGrfOptions {
  readonly fetchImpl?: typeof fetch;
  readonly states?: ReadonlySet<string>;
  readonly signal?: AbortSignal;
}

export async function acquireGrfScope(target: GrfTarget, options: AcquireGrfOptions = {}): Promise<BuiltScope> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const states = options.states ? GRF_STATE_FIPS.filter((s) => options.states!.has(s)) : GRF_STATE_FIPS;
  const hash = createHash("sha256");
  const sourceFiles: string[] = [];
  let acc: GrfAccumulator | null = null;

  for (const st of states) {
    const url = `${GRF_BASE}/public_grfc_cur26_${st}.txt`;
    const res = await fetchImpl(url, { headers: { "user-agent": censusGeographyUserAgent() }, signal: options.signal });
    if (res.status === 404) continue; // a jurisdiction with no grf/2026 block file (e.g. an outlying territory)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${url}`);
    sourceFiles.push(url.split("/").pop() ?? url);
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    const onLine = (line: string): void => {
      if (acc === null) {
        acc = new GrfAccumulator(target, resolveGrfColumns(parseGrfHeader(line), target.column));
        return;
      }
      if (line === "" || line.startsWith("TABBLKST|")) return; // blank or a repeated per-file header
      acc.add(line.split("|"));
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
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
  }
  if (acc === null) throw new Error("grf: no state files read");

  const versionMeta: GeographyVersion = {
    key: target.version,
    type: target.type,
    plan: target.plan,
    zctaTabulation: "2020",
    effectiveFor: target.effectiveFor,
    applicability: establishedApplicability(target.version),
    retrievalComplete: sourceFiles.length === states.length,
    provenance: {
      sourceUrls: [`${GRF_BASE}/`],
      sourceDataset: "CENSUS_GRF_CUR2026",
      sourceFiles,
      sourceChecksums: [hash.digest("hex")],
      method:
        `Census 2026 current geographic reference (grf/2026 public_grfc_cur26_<st>); a ZCTA is an edge ` +
        `of a ${target.districtNoun} if it shares block land; area share = Σ block AREALAND in the district / ` +
        `ZCTA total block AREALAND (no population weight). Source column ${target.column}; ` +
        `the grfn names file's CDSESSN=120 confirms the 120th Congress (2026 election).`,
      computedAt: new Date().toISOString(),
    },
  };
  return (acc as GrfAccumulator).finish(versionMeta);
}
