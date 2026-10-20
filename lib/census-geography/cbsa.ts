import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { WHOLE_THRESHOLD } from "./build.ts";
import type { CbsaClass, GeographyVersion } from "./contract.ts";
import type { BuiltGrouping, BuiltOverlap, BuiltScope } from "./dataset.ts";
import { readXlsxFirstSheet, readXlsxFileRows } from "./xlsx.ts";

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
function cbsaDelineationBuilder(states?: ReadonlySet<string>) {
  let header: string[] | null = null;
  const cbsaByCounty = new Map<string,string>(), cbsa = new Map<string,CbsaInfo>();
  const add = (row: readonly string[]) => {
    if (!header) { if(row.some(c=>c.trim()==="CBSA Code")) header=row.map(c=>c.trim()); return; }
    const cell=(name:string)=>{const at=header!.indexOf(name);if(at<0)throw new Error(`CBSA delineation: missing column "${name}"`);return (row[at]??"").trim();};
    const code=cell("CBSA Code").padStart(5,"0"), stateFips=cell("FIPS State Code").padStart(2,"0"),countyFips=cell("FIPS County Code").padStart(3,"0");
    if(!/^\d{5}$/.test(code)||!/^\d{2}$/.test(stateFips)||!/^\d{3}$/.test(countyFips)||states&&!states.has(stateFips))return;
    const text=cell("Metropolitan/Micropolitan Statistical Area");
    const cbsaClass:CbsaClass|null=text.includes("Metropolitan")?"metropolitan":text.includes("Micropolitan")?"micropolitan":null;
    if(!cbsaClass)return;
    const county=stateFips+countyFips;
    cbsaByCounty.set(county,code);
    const info=cbsa.get(code)??{title:cell("CBSA Title"),cbsaClass,stateFips:new Set<string>(),counties:[]};
    info.stateFips.add(stateFips);info.counties.push(county);cbsa.set(code,info);
  };
  const finish=()=>{if(!header)throw new Error('CBSA delineation: no "CBSA Code" header row found');if(!cbsa.size&&!states)throw new Error("CBSA delineation: parsed zero CBSAs (extraction failed)");return {cbsaByCounty,cbsa};};
  return {add,finish};
}
export function parseCbsaDelineation(xlsxBytes:Buffer):CbsaDelineation {
  const builder=cbsaDelineationBuilder();
  for(const row of readXlsxFirstSheet(xlsxBytes))builder.add(row);
  return builder.finish();
}

/** Shared strings stay on disk; only this state's county relationships survive a row. */
export async function readCbsaDelineationFile(path:string,states?:ReadonlySet<string>):Promise<CbsaDelineation>{
  const builder=cbsaDelineationBuilder(states);
  for await(const row of readXlsxFileRows(path))builder.add(row);
  const result=builder.finish();
  if(states){
    let header:readonly string[]|null=null;
    for await(const row of readXlsxFileRows(path)){
      if(!header){if(row.some(c=>c.trim()==="CBSA Code"))header=row;continue;}
      const code=(row[header.indexOf("CBSA Code")]??"").trim().padStart(5,"0");
      const info=result.cbsa.get(code);
      if(info)info.stateFips.add((row[header.indexOf("FIPS State Code")]??"").trim().padStart(2,"0"));
    }
  }
  return result;
}

interface ZctaAgg {
  sum: number;
  hasNumeric: boolean;
}

/**
 * Fold a built ZCTA↔county scope up to ZCTA↔CBSA using the delineation.
 * State jobs retain the in-state counties of every touching CBSA. Its member
 * states remain source metadata; another state's county records stay outside the job.
 */
export function buildCbsaScope(
  countyScope: BuiltScope,
  delineation: CbsaDelineation,
  versionMeta: GeographyVersion,
  stateFips?: string,
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
    const primaryFips = stateFips ?? memberFips[0] ?? code.slice(0, 2);
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
