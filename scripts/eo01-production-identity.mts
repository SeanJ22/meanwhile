import type { LocalElectionOffice } from "../lib/sources/local-election-offices/model.ts";

export interface ProductionLocalOfficeGeography {
  ocdId: string; label: string; divisionType: string; geoid: string | null; parentOcdId: string | null;
}

function jurisdictionText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replaceAll("&", " and ")
    .replace(/\bst[.]?(?=\s)/g, "saint").replace(/\bste[.]?(?=\s)/g, "sainte")
    .replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function countyName(value: string) {
  return value.replace(/ county clerk$/, " county").replace(/^city of (.+)$/, "$1 city")
    .replace(/^(?:county|parish|borough) of /, "").replace(/ (?:county|parish|borough|census area|municipality)$/, "");
}

/** A matching OCD ID alone cannot prove that a native directory row was joined to the right place. */
export function localElectionOfficeProductionIdentity(office: LocalElectionOffice, division: ProductionLocalOfficeGeography, county?: ProductionLocalOfficeGeography) {
  const nativeJurisdiction = office.directoryJurisdiction ?? office.town ?? office.countyName ?? "";
  const nativeMunicipalityExclusion = /\s+other\s+than\s+(.+)$/i.exec(nativeJurisdiction)?.[1]?.trim();
  const scopeText = /\bwithin\b/i.test(nativeJurisdiction) ? nativeJurisdiction : office.directorySource?.quote.replace(/<[^>]*>/g, " ") ?? "";
  const nativeCountyRestriction = /\bwithin\s+(.+?)(?:\s+[-–—]\s+|$)/i.exec(scopeText)?.[1]?.trim();
  const kind = office.municipalityType?.toLowerCase(), rules: string[] = ["Punctuation, accents, St./Saint and &/and normalization"];
  let nativeName = jurisdictionText(nativeJurisdiction.split(/\s+(?:within|other\s+than)\s+/i)[0]), productionName = jurisdictionText(division.label);
  const productionRawName = productionName;
  if (kind) {
    nativeName = nativeName.replace(new RegExp(`^${kind} of `), "");
    if (office.state === "MA" && kind === "city" && / town city$/.test(productionName) && office.countySubdivisionGeoid === division.geoid) {
      productionName = productionName.replace(/ town city$/, "");
      rules.push("Massachusetts Census compound Town city designation; exact municipality GEOID required");
    } else productionName = productionName.replace(new RegExp(`^${kind} of `), "").replace(new RegExp(` ${kind}$`), "");
    rules.push("Native municipal proper-name words preserved; explicit production municipal classification removed once");
  } else {
    nativeName = countyName(nativeName); productionName = countyName(productionName);
    rules.push("County/parish/borough/census-area wrappers and explicit County Clerk role removed; independent city preserved");
  }
  const nativeKey = nativeName.replaceAll(" ", ""), productionKey = productionName.replaceAll(" ", "");
  const countyRowGeoid = division.divisionType === "county" ? division.geoid : county?.geoid;
  const countyGeoid = countyRowGeoid ?? (kind && /^\d{10}$/.test(division.geoid ?? "") ? division.geoid!.slice(0, 5) : null);
  const countyGeoidEvidence = countyRowGeoid ? "Actual production county division GEOID" : countyGeoid ? "First five digits of actual production 10-digit Census county-subdivision GEOID" : "No production county GEOID available";
  const reasons: string[] = [];
  const nameMatched = !!nativeKey && (nativeKey === productionKey || !!kind && nativeKey === productionRawName.replaceAll(" ", ""));
  if (!nameMatched) reasons.push("The native directory jurisdiction does not match the actual production division label.");
  const nativeCountyRestrictionKey = nativeCountyRestriction ? countyName(jurisdictionText(nativeCountyRestriction).replace(/ co$/, " county")).replaceAll(" ", "") : null;
  const productionCountyKey = county ? countyName(jurisdictionText(county.label)).replaceAll(" ", "") : null;
  if (nativeCountyRestrictionKey && nativeCountyRestrictionKey !== productionCountyKey) reasons.push("The native directory's explicit within-county restriction does not match the actual production county label.");
  if (office.countyFips && office.countyFips !== countyGeoid) reasons.push("The acquired county FIPS does not match the actual production county GEOID.");
  if (office.town && office.countySubdivisionGeoid && office.countySubdivisionGeoid !== division.geoid) reasons.push("The acquired municipality GEOID does not match the actual production division GEOID.");
  return { matched: reasons.length === 0, nameMatched, nativeJurisdiction, productionLabel: division.label, nativeKey, productionKey, normalizationRules: rules,
    nativeCountyRestriction: nativeCountyRestriction ?? null, nativeCountyRestrictionKey, nativeMunicipalityExclusion: nativeMunicipalityExclusion ?? null, productionCountyLabel: county?.label ?? null, productionCountyKey,
    acquiredCountyFips: office.countyFips ?? null, productionCountyGeoid: countyGeoid ?? null, countyGeoidEvidence,
    acquiredMunicipalityGeoid: office.countySubdivisionGeoid ?? null, productionDivisionGeoid: division.geoid,
    municipalityType: office.municipalityType ?? null, productionDivisionType: division.divisionType, reasons };
}
