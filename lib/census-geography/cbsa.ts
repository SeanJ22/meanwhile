import type { CbsaClass } from "./contract.ts";
import { readXlsxFirstSheet } from "./xlsx.ts";

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
