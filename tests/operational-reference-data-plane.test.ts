import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AZ_BULK_FILING_GUIDE_URL,
  CENSUS_GOVERNMENT_UNITS_URL,
  jurisdictionReferenceAcquisitionTestOnly,
  type JurisdictionReferenceAcquisitionSuccess,
  type JurisdictionReferenceSourceReceipt,
} from "../lib/civic-data/jurisdiction-reference-acquisition.ts";
import { DOTGOV_REGISTRY_URL, WEBSITE_CORRECTIONS, websiteCorrectionNote } from "../lib/civic-data/website-corrections.ts";
import {
  azJurisdictionOperationalReferenceCandidate,
  clearOperationalReferenceBundle,
  installAzOperationalReferenceBundle,
  installOperationalReferenceBundle,
  installedOperationalReferenceRegistries,
  jurisdictionOperationalReferenceCandidate,
  jurisdictionOperationalReferenceFailureCandidate,
  operationalReferenceBundle,
  requiredOperationalJurisdictionRegistry,
  type JurisdictionReferenceState,
} from "../lib/civic-data/operational-references.ts";
import { manualCandidateContractIssue, processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { Jurisdiction, JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";

const ROOT = process.cwd();
const NOW = "2026-09-08T22:00:00.000Z";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[n] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries: readonly { readonly name: string; readonly bytes: Uint8Array }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + name.byteLength + bytes.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.byteLength, 18);
    local.writeUInt32LE(bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    name.copy(local, 30);
    bytes.copy(local, 30 + name.byteLength);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.byteLength, 20);
    central.writeUInt32LE(bytes.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    localOffset += local.byteLength;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sheet(row: readonly string[]): Uint8Array {
  const header = ["UNIT_NAME", "STATE", "COUNTY_AREA_NAME", "WEB_ADDRESS", "CENSUS_ID_PID6", "IS_ACTIVE", "UNIT_TYPE"];
  const rowXml = (values: readonly string[], number: number) => values.map((value, index) => {
    const column = String.fromCharCode(65 + index);
    return `<c r="${column}${number}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  }).join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>` +
      `<row r="1">${rowXml(header, 1)}</row><row r="2">${rowXml(row, 2)}</row>` +
      `</sheetData></worksheet>`,
  );
}

function acquiredArchives(): { readonly census: Uint8Array; readonly guide: Uint8Array; readonly workbook: Uint8Array } {
  const workbook = zip([
    { name: "xl/sharedStrings.xml", bytes: Buffer.from("<?xml version=\"1.0\"?><sst><si><t>sentinel</t></si></sst>") },
    { name: "xl/worksheets/sheet1.xml", bytes: sheet(["COUNTY OF TEST", "AZ", "PIMA", "https://example.gov", "100001", "Y", "1 - COUNTY"]) },
    { name: "xl/worksheets/sheet2.xml", bytes: sheet(["TEST WATER DISTRICT", "NH", "MERRIMACK", "", "200001", "Y", ""]) },
    { name: "xl/worksheets/sheet3.xml", bytes: sheet(["TEST SCHOOL DISTRICT", "NJ", "MORRIS", "", "300001", "Y", ""]) },
    { name: "xl/worksheets/sheet4.xml", bytes: sheet(["TEST DEPENDENT SCHOOL", "AZ", "PIMA", "", "400001", "Y", "1 - COUNTY"]) },
  ]);
  return {
    census: zip([{ name: "Govt_Units_2022_Final.xlsx", bytes: workbook }]),
    guide: Buffer.from("%PDF-1.7\nexact test guide bytes\n%%EOF\n"),
    workbook,
  };
}

function response(bytes: Uint8Array, status: number, url: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as Response;
}

function testFetch(archives: ReturnType<typeof acquiredArchives>, guideStatus = 200): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === CENSUS_GOVERNMENT_UNITS_URL) return response(archives.census, 200, CENSUS_GOVERNMENT_UNITS_URL);
    if (url === AZ_BULK_FILING_GUIDE_URL) return response(archives.guide, guideStatus, AZ_BULK_FILING_GUIDE_URL);
    throw new Error(`unexpected test URL ${url}`);
  }) as typeof fetch;
}

async function acquire(guideStatus = 200) {
  const archives = acquiredArchives();
  const result = await jurisdictionReferenceAcquisitionTestOnly.acquire(
    testFetch(archives, guideStatus),
    () => NOW,
    { general: 1, special: 1, school: 1, dependent: 1 },
  );
  return { archives, result };
}

function registries(): Record<JurisdictionReferenceState, JurisdictionRegistry> {
  return JSON.parse(readFileSync(join(ROOT, "tests/fixtures/jurisdiction-registries.json"), "utf8")) as Record<JurisdictionReferenceState, JurisdictionRegistry>;
}

function candidate(acquisition: JurisdictionReferenceAcquisitionSuccess) {
  return jurisdictionOperationalReferenceCandidate({
    registries: registries(),
    sourceReceipts: acquisition.receipts,
    workbook: acquisition.workbook,
    retrievedAt: NOW,
  });
}

test("live-input acquisition derives both Census sheets and carries exact response-byte receipts", async () => {
  const { archives, result } = await acquire();
  assert.equal(result.kind, "ACQUIRED");
  if (result.kind !== "ACQUIRED") return;
  assert.deepEqual(result.censusUnits.map(({ govType, state }) => [govType, state]), [
    ["COUNTY", "AZ"],
    ["SPECIAL DISTRICT", "NH"],
    ["SCHOOL DISTRICT", "NJ"],
  ]);
  assert.equal(result.dependentSchoolSystems[0]?.govType, "DEPENDENT SCHOOL SYSTEM");
  assert.deepEqual(result.receipts, [
    {
      sourceId: "census-government-units-2022",
      requestedUrl: CENSUS_GOVERNMENT_UNITS_URL,
      finalUrl: CENSUS_GOVERNMENT_UNITS_URL,
      httpStatus: 200,
      retrievedAt: NOW,
      rawHash: sha256(archives.census),
      byteCount: archives.census.byteLength,
    },
    {
      sourceId: "az-sos-bulk-filing-guide-2026",
      requestedUrl: AZ_BULK_FILING_GUIDE_URL,
      finalUrl: AZ_BULK_FILING_GUIDE_URL,
      httpStatus: 200,
      retrievedAt: NOW,
      rawHash: sha256(archives.guide),
      byteCount: archives.guide.byteLength,
    },
  ]);
  assert.equal(result.workbook.rawHash, sha256(archives.workbook));
  assert.equal(result.workbook.byteCount, archives.workbook.byteLength);
});

test("first seed promotes with source-scoped evidence and a later HTTPS failure retains LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const acquired = (await acquire()).result;
  assert.equal(acquired.kind, "ACQUIRED");
  if (acquired.kind !== "ACQUIRED") return;
  const first = candidate(acquired);
  assert.deepEqual(first.sourceProjectionEvidence, {
    kind: "SOURCE_PROJECTION_CONTRACT",
    sourceId: "jurisdiction-operational-reference",
    recordClass: "OPERATIONAL_REFERENCE",
    scope: "US:covered-jurisdiction-routing:v1",
  });
  assert.equal(manualCandidateContractIssue("jurisdiction-operational-reference", first), null);
  const promoted = await processRegisteredManualCandidate(store, "jurisdiction-operational-reference", first, NOW);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.candidate.receipt?.decision, "GOOD");
  assert.equal(promoted.promoted?.versionId, first.id);
  assert.equal(promoted.readerReadback?.status, "PASS");

  const failed = (await acquire(503)).result;
  assert.equal(failed.kind, "FAILED");
  if (failed.kind !== "FAILED") return;
  assert.equal(failed.stage, "HTTP");
  assert.equal(failed.httpStatus, 503);
  assert.equal(failed.rawHash, sha256(acquiredArchives().guide));
  const refusedCandidate = jurisdictionOperationalReferenceFailureCandidate(failed);
  assert.equal(manualCandidateContractIssue("jurisdiction-operational-reference", refusedCandidate), null);
  const refused = await processRegisteredManualCandidate(
    store,
    "jurisdiction-operational-reference",
    refusedCandidate,
    "2026-09-08T23:00:00.000Z",
  );
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.state, "SOURCE_BLOCKED");
  assert.equal(refused.candidate.receipt?.decision, "FAIL");
  assert.equal((await store.readPromotion(first.recordClass, first.scope))?.versionId, first.id);
});

test("scoped Arizona source promotes only Arizona and its installed registry wins over legacy without inventing another state", async () => {
  const store = new MemoryRoutineDataStore();
  const acquired = (await acquire()).result;
  assert.equal(acquired.kind, "ACQUIRED");
  if (acquired.kind !== "ACQUIRED") return;
  const az = registries().az;
  const scoped = azJurisdictionOperationalReferenceCandidate({
    registries: { az }, sourceReceipts: acquired.receipts, workbook: acquired.workbook, retrievedAt: NOW,
  });
  assert.equal(scoped.sourceId, "jurisdiction-operational-reference-az");
  assert.equal(scoped.scope, "US-AZ:covered-jurisdiction-routing:v1");
  assert.deepEqual(Object.keys((scoped.readModel as { registries: object }).registries), ["az"]);
  assert.equal(manualCandidateContractIssue("jurisdiction-operational-reference-az", scoped), null);
  const promoted = await processRegisteredManualCandidate(store, "jurisdiction-operational-reference-az", scoped, NOW);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");
  clearOperationalReferenceBundle();
  installAzOperationalReferenceBundle(scoped.readModel as { formatVersion: 1; sourceVersion: "census-2022+reviewed-routing-v1"; registries: { az: JurisdictionRegistry } });
  assert.deepEqual(Object.keys(installedOperationalReferenceRegistries()), ["az"]);
  assert.equal(requiredOperationalJurisdictionRegistry("az").stateCode, "AZ");
  assert.throws(() => requiredOperationalJurisdictionRegistry("nh"), /STATE_NOT_PROMOTED/);
  installOperationalReferenceBundle(operationalReferenceBundle(registries()));
  assert.deepEqual(Object.keys(installedOperationalReferenceRegistries()).sort(), ["az", "nh", "nj"]);
  clearOperationalReferenceBundle();
});

test("a semantically bad successor is refused without replacing the promoted reference", async () => {
  const store = new MemoryRoutineDataStore();
  const acquired = (await acquire()).result;
  assert.equal(acquired.kind, "ACQUIRED");
  if (acquired.kind !== "ACQUIRED") return;
  const first = candidate(acquired);
  await processRegisteredManualCandidate(store, "jurisdiction-operational-reference", first, NOW);
  const bad = {
    ...structuredClone(first),
    id: `${first.id}-bad-successor`,
    semantics: { ...first.semantics, violations: ["routing catalog did not reconcile"] },
  };
  const refused = await processRegisteredManualCandidate(store, "jurisdiction-operational-reference", bad, "2026-09-08T23:00:00.000Z");
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.state, "SEMANTIC_INVALID");
  assert.equal((await store.readPromotion(first.recordClass, first.scope))?.versionId, first.id);
});

test("C15: a reviewed website correction promotes with the receipts of the pages read again; a forged or unreceipted one is refused", async () => {
  const acquired = (await acquire()).result;
  assert.equal(acquired.kind, "ACQUIRED");
  if (acquired.kind !== "ACQUIRED") return;
  const c = WEBSITE_CORRECTIONS.find((x) => x.jurisdictionId === "az:city:city-of-cottonwood")!;
  const CORRECTED_BEFORE = {
    id: c.jurisdictionId, stateCode: "AZ", name: "CITY OF COTTONWOOD", govClass: "CITY_OR_TOWN", countyName: "YAVAPAI",
    enumeratedFrom: "census-govt-units-2022", ownWebAddress: "http://www.ci.cottonwood.az.us", sourceIds: [],
  } as unknown as Jurisdiction;
  const withRow = (row: (j: Jurisdiction) => Jurisdiction) => {
    const all = registries();
    const az = all.az as unknown as { jurisdictions: Jurisdiction[]; counts: Record<string, number> };
    if (!az.jurisdictions.some((j) => j.id === c.jurisdictionId)) az.counts.CITY_OR_TOWN += 1;
    az.jurisdictions = [...az.jurisdictions.filter((j) => j.id !== c.jurisdictionId), row(CORRECTED_BEFORE)];
    return all;
  };
  const corrected = withRow((j) => ({ ...j, ownWebAddress: c.corrected, ownWebAddressCorrection: websiteCorrectionNote(c, "APPLIED_VERIFIED") }));
  const read = [
    { sourceId: "website-correction:dotgov-registry", requestedUrl: DOTGOV_REGISTRY_URL, finalUrl: DOTGOV_REGISTRY_URL, httpStatus: 200, retrievedAt: NOW, rawHash: sha256(Buffer.from("csv")), byteCount: 3 },
    { sourceId: `website-correction:${c.jurisdictionId}:homepage`, requestedUrl: c.homepage!.url, finalUrl: c.homepage!.url, httpStatus: 200, retrievedAt: NOW, rawHash: sha256(Buffer.from("home")), byteCount: 4 },
  ] as const;
  const build = (regs: ReturnType<typeof registries>, sourceReceipts: readonly JurisdictionReferenceSourceReceipt[]) =>
    jurisdictionOperationalReferenceCandidate({ registries: regs, sourceReceipts, workbook: acquired.workbook, retrievedAt: NOW });

  const good = build(corrected, [...acquired.receipts, ...read]);
  assert.deepEqual(good.semantics.violations, []);
  assert.equal(good.retrieval.succeeded, true);
  const store = new MemoryRoutineDataStore();
  assert.equal((await processRegisteredManualCandidate(store, "jurisdiction-operational-reference", good, NOW)).candidate.state, "PROMOTED");

  assert.ok(build(corrected, acquired.receipts).semantics.violations.includes(`WEBSITE_CORRECTION_UNRECEIPTED:${c.jurisdictionId}:homepage`));
  const forged = withRow((j) => ({ ...j, ownWebAddress: "https://attacker.example", ownWebAddressCorrection: websiteCorrectionNote(c, "APPLIED_VERIFIED") }));
  assert.ok(build(forged, [...acquired.receipts, ...read]).semantics.violations.some((v) => v.startsWith("WEBSITE_CORRECTION_ROW:")));
  const stray = build(corrected, [...acquired.receipts, ...read, { ...read[1], sourceId: "website-correction:az:city:city-of-tucson:homepage" }]);
  assert.equal(stray.retrieval.succeeded, false, "a receipt for a page the reviewed list does not name is refused");
});

test("standing jurisdiction obligations require the installed promoted projection and never read tracked JSON", () => {
  clearOperationalReferenceBundle();
  const absent = buildRegistry([localJurisdictionsProvider()], { root: ROOT, nowIso: NOW });
  assert.equal(absent.units.length, 0);
  assert.match(absent.byProvider[0]?.readFailure ?? "", /OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED/);

  installOperationalReferenceBundle(operationalReferenceBundle(registries()));
  assert.equal(requiredOperationalJurisdictionRegistry("az").stateCode, "AZ");
  const present = buildRegistry([localJurisdictionsProvider()], { root: ROOT, nowIso: NOW });
  assert.ok(present.units.length > 0);
  assert.equal(present.byProvider[0]?.readFailure, null);
  assert.equal(present.units.some((unit) => /meeting/i.test(unit.record.recordClass)), false);
});

test("the production promoter has no tracked-input or Git-writer fallback", () => {
  assert.equal(existsSync(join(ROOT, "scripts/fetch-fec-directories.mts")), false);
  assert.equal(existsSync(join(ROOT, "scripts/build-state-cf-agencies.mts")), false);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["fec:directories"], undefined);
  assert.equal(pkg.scripts["cf:agencies"], undefined);
  assert.equal(pkg.scripts["jurisdictions:enumerate"], undefined);

  const command = readFileSync(join(ROOT, "scripts/enumerate-jurisdictions.mts"), "utf8");
  assert.match(command, /acquireJurisdictionReferenceInputs/);
  assert.doesNotMatch(command, /\b(?:readFileSync|readRecords|writeFileSync|appendFileSync|createWriteStream)\b/);
  assert.doesNotMatch(command, /tests\/fixtures|data\/reference\/census_govt_units_2022/);
  const provider = readFileSync(join(ROOT, "lib/control-plane/scheduler/providers/local-jurisdictions.ts"), "utf8");
  assert.doesNotMatch(provider, /readFileSync|data\/states\/\$?\{?state|jurisdictionRegistryPath/);
  /* The one accessor: the promoted reviewed bundle, else a state's promoted registration the runner installed. */
  assert.match(provider, /requiredJurisdictionRegistry/);
  const accessor = readFileSync(join(ROOT, "lib/civic-data/operational-references.ts"), "utf8");
  assert.doesNotMatch(accessor, /readFileSync|node:fs|data\/states/, "the accessor reads no tracked file");
  assert.match(accessor, /export function requiredJurisdictionRegistry[\s\S]*?requiredOperationalJurisdictionRegistry\(key\)[\s\S]*?installedRegistration\.get\(key\)/);
});
