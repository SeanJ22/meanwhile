import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { WHOLE_THRESHOLD } from "./build.ts";
import type { CbsaClass, GeographyVersion } from "./contract.ts";
import type { BuiltGrouping, BuiltOverlap, BuiltScope } from "./dataset.ts";
import { readXlsxFirstSheet } from "./xlsx.ts";

/** A CBSA is a union of whole counties, so ZCTA↔CBSA is the exact fold of ZCTA↔county overlaps; metro and micro are never merged. */
interface CbsaInfo {
  title: string;
  cbsaClass: CbsaClass;
  readonly stateFips: Set<string>;
  readonly counties: string[];
}

export interface CbsaDelineation {
  /** county GEOID (SSCCC) -> its CBSA code. A county is in at most one CBSA. */
  readonly cbsaByCounty: Map<string, string>;
  readonly cbsa: Map<string, CbsaInfo>;
}

/**
 * Parse the OMB delineation (list1). The layout has title rows, then a header
 * row, then one data row per county, then footnotes. We resolve columns by
 * their header text (never by index) and restore FIPS leading zeros that Excel
 * may have dropped by storing the codes as numbers.
 */
export function parseCbsaDelineation(xlsxBytes: Buffer): CbsaDelineation {
  const rows = readXlsxFirstSheet(xlsxBytes);
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() === "CBSA Code"));
  if (headerIdx < 0) throw new Error('CBSA delineation: no "CBSA Code" header row found');
  const header = rows[headerIdx].map((c) => c.trim());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CBSA delineation: missing column "${name}"; header = ${JSON.stringify(header)}`);
    return i;
  };
  const cCode = col("CBSA Code");
  const cTitle = col("CBSA Title");
  const cClass = col("Metropolitan/Micropolitan Statistical Area");
  const cState = col("FIPS State Code");
  const cCounty = col("FIPS County Code");

  const cbsaByCounty = new Map<string, string>();
  const cbsa = new Map<string, CbsaInfo>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[cCode] ?? "").trim().padStart(5, "0");
    if (!/^\d{5}$/.test(code)) continue; // footnote / blank row
    const stateFips = (row[cState] ?? "").trim().padStart(2, "0");
    const countyFips = (row[cCounty] ?? "").trim().padStart(3, "0");
    if (!/^\d{2}$/.test(stateFips) || !/^\d{3}$/.test(countyFips)) continue;
    const areaText = (row[cClass] ?? "").trim();
    const cbsaClass: CbsaClass | null = areaText.includes("Metropolitan")
      ? "metropolitan"
      : areaText.includes("Micropolitan")
        ? "micropolitan"
        : null;
    if (cbsaClass === null) continue;
    const countyGeoid = stateFips + countyFips;
    const title = (row[cTitle] ?? "").trim();
    cbsaByCounty.set(countyGeoid, code);
    let info = cbsa.get(code);
    if (info === undefined) {
      info = { title, cbsaClass, stateFips: new Set(), counties: [] };
      cbsa.set(code, info);
    }
    info.stateFips.add(stateFips);
    info.counties.push(countyGeoid);
  }
  if (cbsa.size === 0) throw new Error("CBSA delineation: parsed zero CBSAs (extraction failed)");
  return { cbsaByCounty, cbsa };
}

interface ZctaAgg {
  sum: number;
  hasNumeric: boolean;
}

/**
 * Fold a built ZCTA↔county scope up to ZCTA↔CBSA using the delineation.
 * `countyScope` must be the UNFILTERED national county scope (a CBSA can span
 * counties in several states, so a state-filtered county scope would truncate
 * multi-state metros).
 */
export function buildCbsaScope(
  countyScope: BuiltScope,
  delineation: CbsaDelineation,
  versionMeta: GeographyVersion,
): BuiltScope {
  const agg = new Map<string, Map<string, ZctaAgg>>();
  for (const county of countyScope.groupings) {
    const code = delineation.cbsaByCounty.get(county.geoid);
    if (code === undefined) continue; // county is in no CBSA (rural / non-core)
    let zctas = agg.get(code);
    if (zctas === undefined) {
      zctas = new Map();
      agg.set(code, zctas);
    }
    for (const o of county.overlaps) {
      let z = zctas.get(o.zcta5);
      if (z === undefined) {
        z = { sum: 0, hasNumeric: false };
        zctas.set(o.zcta5, z);
      }
      if (o.fraction !== null) {
        z.sum += o.fraction;
        z.hasNumeric = true;
      }
    }
  }

  const groupings: BuiltGrouping[] = [];
  let edges = 0;
  for (const [code, info] of delineation.cbsa) {
    const zctas = agg.get(code);
    const overlaps: BuiltOverlap[] = [];
    if (zctas) {
      for (const [zcta5, z] of zctas) {
        const fraction = z.hasNumeric ? Math.min(1, z.sum) : null;
        overlaps.push({ zcta5, whole: fraction !== null && fraction >= WHOLE_THRESHOLD, fraction });
      }
      overlaps.sort((a, b) => (a.zcta5 < b.zcta5 ? -1 : a.zcta5 > b.zcta5 ? 1 : 0));
    }
    edges += overlaps.length;
    const memberFips = [...info.stateFips].sort();
    const memberStates = memberFips.map((f) => FIPS_TO_STATE[f]?.postal ?? "??");
    const primaryFips = memberFips[0] ?? code.slice(0, 2);
    groupings.push({
      geoid: code,
      ocdId: null, // a CBSA is a statistical area, not an OCD division
      label: info.title,
      stateFips: primaryFips,
      stateAbbr: FIPS_TO_STATE[primaryFips]?.postal ?? "??",
      cbsaClass: info.cbsaClass,
      memberStates,
      overlaps,
    });
  }
  groupings.sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));

  return {
    type: "cbsa",
    version: versionMeta.key,
    versionMeta,
    fractionBasis: "area",
    groupings,
    instanceCount: groupings.length,
    zctaEdgeCount: edges,
  };
}
