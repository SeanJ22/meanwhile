import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdirSync, openSync, readFileSync, writeSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { streamCsvRecords } from "../lib/sources/prl/streaming.ts";
import { withHistoryIndex, type HistoryIndex } from "../lib/control-plane/workers/streamed-history.ts";
import type { StateReference, StateReferenceIndex } from "../lib/control-plane/expansion/state-references.ts";
import { unitShareKey } from "../lib/control-plane/expansion/membership.ts";
import { ruledDistrictTerritory, DISTRICT_TERRITORIES } from "../lib/control-plane/expansion/district-territory.ts";
import { governmentNativeId, type RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import { censusGovernmentContacts } from "../lib/registration/census-contacts.ts";

async function* sourceChunks(path: string, digest?: ReturnType<typeof createHash>): AsyncGenerator<string> {
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    const text = String(chunk);
    digest?.update(text);
    yield text;
  }
}

/** The national CSVs become an ordered disk inventory; only one state's records are opened for emission. */
async function indexSources(root: string, db: HistoryIndex, states: ReadonlySet<string>): Promise<string> {
  db.exec(`PRAGMA synchronous=OFF;
    CREATE TABLE census_rows(sequence INTEGER PRIMARY KEY,state TEXT NOT NULL,pid6 TEXT NOT NULL,unit TEXT NOT NULL,fact TEXT NOT NULL,listing TEXT NOT NULL);
    CREATE INDEX census_states ON census_rows(state,sequence);
    CREATE TABLE nces_rows(sequence INTEGER PRIMARY KEY,state TEXT NOT NULL,listing TEXT NOT NULL);
    CREATE INDEX nces_states ON nces_rows(state,sequence)`);
  const census = db.prepare("INSERT INTO census_rows(state,pid6,unit,fact,listing) VALUES(?,?,?,?,?)");
  const nces = db.prepare("INSERT INTO nces_rows(state,listing) VALUES(?,?)");
  const sourceIndex = JSON.parse(readFileSync(join(root, "data", "derived", "registration", "index.json"), "utf8")) as { source: string };
  const sources: string[] = [];
  for (const file of ["census_govt_units_2022.csv", "census_govt_units_2022_dependent_school_systems.csv"]) {
    const digest = createHash("sha256");
    let header: string[] | undefined;
    let pid = -1, web = -1, county = -1, state = -1;
    db.exec("BEGIN");
    try {
      for await (const row of streamCsvRecords(sourceChunks(join(root, "data", "reference", file), digest))) {
        if (!header) {
          header = row;
          pid = header.indexOf("census_id_pid6"); web = header.indexOf("web_address"); county = header.indexOf("county_area_name"); state = header.indexOf("state");
          if ([pid, web, county, state].some(index => index < 0)) throw new Error(`REGISTRATION_CENSUS_FILE_SHAPE:${file}`);
          continue;
        }
        const value = (name: string) => (row[header!.indexOf(name)] ?? "").trim();
        const postal = row[state]?.toUpperCase() || FIPS_TO_STATE[value("fips_state")]?.postal;
        if (!row[pid] || !postal || !states.has(postal)) continue;
        const fact = { city: value("city"), web: (row[web] ?? "").trim(), county: (row[county] ?? "").trim(),
          countyFips: /^\d{2}$/.test(value("fips_state")) && /^\d{3}$/.test(value("fips_county")) ? value("fips_state") + value("fips_county") : null };
        const type = value("gov_type");
        const st = value("fips_state"), countyCode = value("fips_county"), placeCode = value("fips_place");
        const key = type === "COUNTY" && /^\d{3}$/.test(countyCode) ? `county GEOID ${st}${countyCode}`
          : type === "MUNICIPAL" && /^\d{5}$/.test(placeCode) ? `place GEOID ${st}${placeCode}`
          : type === "TOWNSHIP" && /^\d{3}$/.test(countyCode) && /^\d{5}$/.test(placeCode) ? `cousub GEOID ${st}${countyCode}${placeCode}` : "No source-established service geography";
        const unit = { pid6: row[pid], name: value("unit_name"), type, state: postal, zips: [], method: key };
        const listing: RegistrationGovernmentListing = {
          id: governmentNativeId(postal, "cog", row[pid]), aliases: [], jurisdictionId: null, state: postal,
          name: value("unit_name"), kind: type === "DEPENDENT SCHOOL SYSTEM" ? "DEPENDENT_SCHOOL_SYSTEM" : "GOVERNMENT",
          governmentClass: type, nativeIds: { census_pid6: row[pid] }, status: value("is_active") || null, sourceVintage: "2022 Census of Governments",
          ...censusGovernmentContacts((...fields) => fields.map(field => value(field.toLowerCase())).find(Boolean) ?? ""),
          officePhone: null, officeAddress: null,
          countyFips: /^\d{2}$/.test(value("fips_state")) && /^\d{3}$/.test(value("fips_county")) ? value("fips_state") + value("fips_county") : null,
          associations: [], bodyIds: [], provenance: { sourceUrl: "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP", sourceOrg: "U.S. Census Bureau", collectedAt: "2026-09-23", verifiedAt: null },
        };
        census.run(postal, row[pid], JSON.stringify(unit), JSON.stringify(fact), JSON.stringify(listing));
      }
      if (!header) throw new Error(`REGISTRATION_CENSUS_FILE_SHAPE:${file}`);
      const source = `${file} (sha256 ${digest.digest("hex")})`;
      if (!sourceIndex.source.includes(source)) throw new Error(`REGISTRATION_CENSUS_FILE_DRIFT:${file}`);
      sources.push(`data/reference/${source}`);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  let header: string[] | undefined;
  db.exec("BEGIN");
  try {
    for await (const row of streamCsvRecords(sourceChunks(join(root, "data", "reference", "nces_ccd_lea_directory_2025_26.csv")))) {
      if (!header) { header = row; continue; }
      const value = (name: string) => (row[header!.indexOf(name)] ?? "").trim();
      const sourceState = value("state").toUpperCase();
      const state = states.has(sourceState) ? sourceState : value("location_state").toUpperCase();
      const leaid = value("nces_leaid");
      if (!states.has(state) || !/^\d{7}$/.test(leaid)) continue;
      const website = value("website");
      const listing: RegistrationGovernmentListing = {
        id: governmentNativeId(state, "nces", leaid), aliases: [], jurisdictionId: null, state,
        name: value("lea_name"), kind: "EDUCATION_AGENCY", governmentClass: value("lea_type"),
        nativeIds: { nces_leaid: leaid, state_leaid: value("state_leaid"), source_state: sourceState,
          nces_lea_type: value("lea_type_code"), nces_charter_lea: value("charter_lea_code"),
          nces_lea_status: value("updated_status") || value("sy_status") },
        status: value("updated_status") || value("sy_status") || null, sourceVintage: "NCES CCD 2025–26 preliminary, 2026-05-06",
        website: website ? (/^https?:\/\//i.test(website) ? website : `http://${website}`) : null,
        officePhone: value("phone") || null,
        officeAddress: ["location_street1", "location_street2", "location_street3", "location_city", "location_state", "location_zip"].map(value).filter(Boolean).join(", ") || null,
        mailingAddress: ["mailing_street1", "mailing_street2", "mailing_street3", "mailing_city", "mailing_state", "mailing_zip"].map(value).filter(Boolean).join(", ") || null,
        countyFips: null, associations: [], bodyIds: [],
        provenance: { sourceUrl: "https://nces.ed.gov/ccd/files.asp", sourceOrg: "National Center for Education Statistics", collectedAt: "2026-08-19", verifiedAt: null },
      };
      nces.run(state, JSON.stringify(listing));
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return sources.join(" and ");
}

function readIndexedState(db: HistoryIndex, state: string, censusSource: string): StateReference {
  const shard: StateReference = { formatVersion: 1, state, units: [], zips: {}, facts: {}, censusSource, exactShares: {}, listings: [] };
  for (const row of db.prepare("SELECT pid6,unit,fact,listing FROM census_rows WHERE state=? ORDER BY sequence").iterate(state)) {
    shard.units.push(JSON.parse(row.unit));
    shard.facts[row.pid6] = JSON.parse(row.fact);
    shard.listings!.push(JSON.parse(row.listing));
  }
  for (const row of db.prepare("SELECT listing FROM nces_rows WHERE state=? ORDER BY sequence").iterate(state)) shard.listings!.push(JSON.parse(row.listing));
  return shard;
}

function writeStateReference(root: string, out: string, shard: StateReference): void {
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

export async function projectPlaceReferences(root = process.cwd()): Promise<number> {
  const out = join(root, "data", "derived", "place-reference");
  const states = [...new Set(Object.values(FIPS_TO_STATE).map(state => state.postal))];
  await withHistoryIndex(async db => {
    const censusSource = await indexSources(root, db, new Set(states));
    mkdirSync(out, { recursive: true });
    for (const state of states) writeStateReference(root, out, readIndexedState(db, state, censusSource));
  });
  return states.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Projected held place references into ${await projectPlaceReferences()} state indexes and seekable data files.`);
}
