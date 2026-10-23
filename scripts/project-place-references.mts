import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { parseCsv } from "../lib/reference/index.ts";
import type { StateReference, StateReferenceIndex } from "../lib/control-plane/expansion/state-references.ts";
import { unitShareKey } from "../lib/control-plane/expansion/membership.ts";
import { ruledDistrictTerritory, DISTRICT_TERRITORIES } from "../lib/control-plane/expansion/district-territory.ts";
import { governmentNativeId, type RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import { censusGovernmentContacts } from "../lib/registration/census-contacts.ts";

const root = process.cwd();
const out = join(root, "data", "derived", "place-reference");
const shards = new Map<string, StateReference>();
function shardFor(state: string): StateReference {
  const key = state.toUpperCase();
  let shard = shards.get(key);
  if (!shard) {
    shard = { formatVersion: 1, state: key, units: [], zips: {}, facts: {}, censusSource: "", exactShares: {}, listings: [] };
    shards.set(key, shard);
  }
  return shard;
}
for (const state of Object.values(FIPS_TO_STATE)) shardFor(state.postal);
const sourceIndex = JSON.parse(readFileSync(join(root, "data", "derived", "registration", "index.json"), "utf8")) as { source: string };
const sources: string[] = [];
for (const file of ["census_govt_units_2022.csv", "census_govt_units_2022_dependent_school_systems.csv"]) {
  const text = readFileSync(join(root, "data", "reference", file), "utf8");
  const source = `${file} (sha256 ${createHash("sha256").update(text).digest("hex")})`;
  if (!sourceIndex.source.includes(source)) throw new Error(`REGISTRATION_CENSUS_FILE_DRIFT:${file}`);
  sources.push(`data/reference/${source}`);
  const [header = [], ...rows] = parseCsv(text);
  const pid = header.indexOf("census_id_pid6"), web = header.indexOf("web_address"), county = header.indexOf("county_area_name"), state = header.indexOf("state");
  if ([pid, web, county, state].some(index => index < 0)) throw new Error(`REGISTRATION_CENSUS_FILE_SHAPE:${file}`);
  const value = (row: string[], name: string) => (row[header.indexOf(name)] ?? "").trim();
  for (const row of rows) {
    const postal = FIPS_TO_STATE[value(row, "fips_state")]?.postal || row[state]?.toUpperCase();
    if (!row[pid] || !postal || !shards.has(postal)) continue;
    const shard = shardFor(postal);
    shard.facts[row[pid]] = { city: value(row, "city"), web: (row[web] ?? "").trim(), county: (row[county] ?? "").trim(),
      countyFips: /^\d{2}$/.test(value(row, "fips_state")) && /^\d{3}$/.test(value(row, "fips_county")) ? value(row, "fips_state") + value(row, "fips_county") : null };
    const type = value(row, "gov_type");
    const st = value(row, "fips_state"), countyCode = value(row, "fips_county"), placeCode = value(row, "fips_place");
    const key = type === "COUNTY" && /^\d{3}$/.test(countyCode) ? `county GEOID ${st}${countyCode}`
      : type === "MUNICIPAL" && /^\d{5}$/.test(placeCode) ? `place GEOID ${st}${placeCode}`
      : type === "TOWNSHIP" && /^\d{3}$/.test(countyCode) && /^\d{5}$/.test(placeCode) ? `cousub GEOID ${st}${countyCode}${placeCode}` : "No source-established service geography";
    shard.units.push({ pid6: row[pid], name: value(row, "unit_name"), type, state: postal, zips: [], method: key });
    shard.listings!.push({
      id: governmentNativeId(postal, "cog", row[pid]), aliases: [], jurisdictionId: null, state: postal,
      name: value(row, "unit_name"), kind: type === "DEPENDENT SCHOOL SYSTEM" ? "DEPENDENT_SCHOOL_SYSTEM" : "GOVERNMENT",
      governmentClass: type, nativeIds: { census_pid6: row[pid] }, status: value(row, "is_active") || null, sourceVintage: "2022 Census of Governments",
      ...censusGovernmentContacts((...fields) => fields.map(field => value(row, field.toLowerCase())).find(Boolean) ?? ""),
      officePhone: null, officeAddress: null,
      countyFips: /^\d{2}$/.test(value(row, "fips_state")) && /^\d{3}$/.test(value(row, "fips_county")) ? value(row, "fips_state") + value(row, "fips_county") : null,
      associations: [], bodyIds: [], provenance: { sourceUrl: "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP", sourceOrg: "U.S. Census Bureau", collectedAt: "2026-09-23", verifiedAt: null },
    });
  }
}
{
  const [header, ...rows] = parseCsv(readFileSync(join(root, "data", "reference", "nces_ccd_lea_directory_2025_26.csv"), "utf8"));
  const value = (row: string[], name: string) => (row[header.indexOf(name)] ?? "").trim();
  for (const row of rows) {
    const sourceState = value(row, "state").toUpperCase();
    const state = shards.has(sourceState) ? sourceState : value(row, "location_state").toUpperCase();
    const leaid = value(row, "nces_leaid");
    if (!shards.has(state) || !/^\d{7}$/.test(leaid)) continue;
    const website = value(row, "website");
    const listing: RegistrationGovernmentListing = {
      id: governmentNativeId(state, "nces", leaid), aliases: [], jurisdictionId: null, state,
      name: value(row, "lea_name"), kind: "EDUCATION_AGENCY", governmentClass: value(row, "lea_type"),
      nativeIds: { nces_leaid: leaid, state_leaid: value(row, "state_leaid"), source_state: sourceState,
        nces_lea_type: value(row, "lea_type_code"), nces_charter_lea: value(row, "charter_lea_code"),
        nces_lea_status: value(row, "updated_status") || value(row, "sy_status") },
      status: value(row, "updated_status") || value(row, "sy_status") || null, sourceVintage: "NCES CCD 2025–26 preliminary, 2026-05-06",
      website: website ? (/^https?:\/\//i.test(website) ? website : `http://${website}`) : null,
      officePhone: value(row, "phone") || null,
      officeAddress: ["location_street1", "location_street2", "location_street3", "location_city", "location_state", "location_zip"].map(field => value(row, field)).filter(Boolean).join(", ") || null,
      mailingAddress: ["mailing_street1", "mailing_street2", "mailing_street3", "mailing_city", "mailing_state", "mailing_zip"].map(field => value(row, field)).filter(Boolean).join(", ") || null,
      countyFips: null, associations: [], bodyIds: [],
      provenance: { sourceUrl: "https://nces.ed.gov/ccd/files.asp", sourceOrg: "National Center for Education Statistics", collectedAt: "2026-08-19", verifiedAt: null },
    };
    shardFor(state).listings!.push(listing);
  }
}
mkdirSync(out, { recursive: true });
for (const shard of shards.values()) {
  // Retain the exact previously held identity mapping for existing reviewed
  // registry callers. A saved alias does not establish a service boundary.
  const reference = JSON.parse(readFileSync(join(root, "data", "derived", "registration", `${shard.state.toLowerCase()}.json`), "utf8")) as {
    governments: readonly (readonly [pid6: string, jurisdictionId: string, ...rest: unknown[]])[];
  };
  const aliases = new Map(reference.governments.map(([pid6, jurisdictionId]) => [pid6, jurisdictionId]));
  shard.units = shard.units.map(unit => ({ ...unit, ...(aliases.has(unit.pid6) ? { aliases: [aliases.get(unit.pid6)!] } : {}) }));
  const adjacent = new Map<string, Set<string>>();
  for (const { edges } of Object.values(shard.zips)) {
    const keys = edges.map(edge => `${edge.layer}:${edge.id}`);
    for (const key of keys) {
      const neighbors = adjacent.get(key) ?? new Set<string>();
      for (const other of keys) if (other !== key) neighbors.add(other);
      adjacent.set(key, neighbors);
    }
  }
  shard.censusSource = sources.join(" and ");
  const temporaryData = join(out, `${shard.state.toLowerCase()}.${process.pid}.tmp`);
  const fd = openSync(temporaryData, "wx");
  const digest = createHash("sha256");
  let offset = 0;
  const write = (value: unknown): [number, number, string] => {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    digest.update(bytes);
    const span: [number, number, string] = [offset, bytes.length, createHash("sha256").update(bytes).digest("hex")];
    let written = 0;
    while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
    offset += bytes.length;
    return span;
  };
  try {
    const index: StateReferenceIndex = { formatVersion: 2, state: shard.state, censusSource: shard.censusSource,
      units: shard.units.map(write), byZip: {}, byDivision: {}, shares: {}, facts: write(shard.facts), listings: write(shard.listings ?? []) };
    const byDivision = new Map<string, number[]>();
    for (const [i, unit] of shard.units.entries()) {
      const key = unitShareKey(unit);
      if (key) { const rows = byDivision.get(key) ?? []; rows.push(i); byDivision.set(key, rows); }
      for (const zip of unit.zips) (index.byZip[zip] ??= []).push(i);
    }
    index.byDivision = Object.fromEntries(byDivision);
    for (const [zip, row] of Object.entries(shard.zips)) {
      const seeds = row.edges.map(edge => `${edge.layer}:${edge.id}`);
      const ring = new Set(seeds.flatMap(key => [key, ...(adjacent.get(key) ?? [])]));
      index.byZip[zip] = [...new Set([...(index.byZip[zip] ?? []), ...[...ring].flatMap(key => byDivision.get(key) ?? [])])];
    }
    const byPid = new Map(shard.units.map(unit => [`${shard.state}:${unit.pid6}`, unit]));
    const positions = new Map(shard.units.map((unit, i) => [unit.pid6, i]));
    for (const [i, unit] of shard.units.entries()) {
      if (unit.zips.length) continue;
      const ruled = ruledDistrictTerritory(unit, byPid, () => undefined, unitShareKey, DISTRICT_TERRITORIES);
      if (!ruled || "unplaced" in ruled) continue;
      const rule = DISTRICT_TERRITORIES.find(row => row.state === shard.state && row.pid6 === unit.pid6)?.rule;
      const dependencies = rule?.kind === "MEMBER_UNION" ? rule.members.flatMap(member => positions.get(member.pid6) ?? [])
        : rule?.kind === "COUNTY" ? byDivision.get(`county:${rule.countyGeoid}`) ?? [] : [];
      for (const zip of ruled.zctas) index.byZip[zip] = [...new Set([...(index.byZip[zip] ?? []), i, ...dependencies])];
    }
    const divisionRows = new Map<string, { zips: StateReference["zips"]; exact: Record<string, number> }>();
    for (const [zip, row] of Object.entries(shard.zips)) for (const edge of row.edges) {
      const key = `${edge.layer}:${edge.id}`;
      const value = divisionRows.get(key) ?? { zips: {}, exact: shard.exactShares[key] ?? {} };
      (value.zips[zip] ??= { total: row.total, edges: [] }).edges.push(edge);
      divisionRows.set(key, value);
    }
    for (const [key, exact] of Object.entries(shard.exactShares)) if (!divisionRows.has(key)) divisionRows.set(key, { zips: {}, exact });
    for (const [key, rows] of divisionRows) index.shares[key] = write(rows);
    closeSync(fd);
    const sha = digest.digest("hex");
    index.dataSha256 = sha;
    index.dataFile = `${shard.state.toLowerCase()}.${sha}.jsonl`;
    renameSync(temporaryData, join(out, index.dataFile));
    const temporaryIndex = join(out, `${shard.state.toLowerCase()}.${process.pid}.index.tmp`);
    writeFileSync(temporaryIndex, `${JSON.stringify(index)}\n`, { flag: "wx" });
    renameSync(temporaryIndex, join(out, `${shard.state.toLowerCase()}.json`));
  } catch (error) {
    try { closeSync(fd); } catch { /* already closed before index publication */ }
    rmSync(temporaryData, { force: true });
    throw error;
  }
}
console.log(`Projected held place references into ${shards.size} state indexes and seekable data files.`);
