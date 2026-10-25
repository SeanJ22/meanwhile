import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { refreshVotingSources, votingSourceEvidence } from "../scripts/fetch-voting-sites.mts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { holdVotingRawEvidence, recordVotingSourceRead, saveVotingSourceDoor } from "../lib/ballot/voting-source-publication.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { vaultCapture } from "../lib/facts/capture.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { classifyAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { REDACTION_PLACEHOLDER } from "../lib/ops/fixture-credentials.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

// These are the real served pages. Each was committed with its Maps key replaced by the placeholder at the
// exact place the page printed it; the test puts a key-shaped value back there, built at runtime so no
// usable credential enters the repository.
const key = (fill: string) => ["AI", "za"].join("") + fill.repeat(35);
const served = (path: string, value: string) => {
  const page = readFileSync(path, "utf8");
  assert.equal(page.split(REDACTION_PLACEHOLDER).length, 2, `${path} printed one key`);
  return new TextEncoder().encode(page.replace(REDACTION_PLACEHOLDER, value));
};
const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
const door = (id: string) => doors.find(row => row.id === id)!;
const EL_PASO = "tests/fixtures/voting-sources/";
const COCHISE = "tests/fixtures/voting-sources/vs-04-west/";
const pages = (value: string): Record<string, () => Uint8Array> => ({
  "https://epcountyvotestx.gov/voter-information/early-voting-locations": () => served(`${EL_PASO}tx-el-paso-early-native.html`, value),
  "https://epcountyvotestx.gov/voter-information/election-day-vote-centers": () => served(`${EL_PASO}tx-el-paso-vote-centers-native.html`, value),
  "https://www.cochise.az.gov/509/Voter-Information": () => served(`${COCHISE}az-207951e62d4f-ae3bdf26f6f1.html`, value),
  "https://www.cochise.az.gov/292/Elections": () => served(`${COCHISE}az-29b49e44902a-04d6e8adcd16.html`, value),
  // The saved Wheeling capture is a trimmed excerpt with its scripts removed, so it carries no key.
  "https://wheelingil.gov/468/Election-Information": () => readFileSync("tests/fixtures/voting-sources/vs-07-counties/wheeling-election.html"),
});
const fetchPages = (value: string) => (async input => {
  const url = String(input);
  if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
  const page = pages(value)[url];
  return page ? new Response(new Uint8Array(page()), { headers: { "content-type": "text/html; charset=utf-8" } }) : new Response(null, { status: 404 });
}) as typeof fetch;
const now = "2026-10-24T12:00:00.000Z";

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
}

for (const [state, ids, place, counts, keyed] of [
  ["TX", ["tx-el-paso-early-voting-2026", "tx-el-paso-vote-centers-2026"], "El Paso 79901", { EARLY_VOTING: 39, VOTE_CENTER: 123 }, true],
  ["AZ", ["cochise:ballot-box-table"], "Cochise 85603", { DROP_BOX: 5 }, true],
  ["IL", ["vs07-cook-wheeling-early"], "Wheeling 60090", { EARLY_VOTING: 1 }, false],
] as const) {
  test(`${place}: ${keyed ? "an official page printing a key is saved blanked, checked and" : "the official page (a saved excerpt without its scripts) is"} published in the scheduled job`, async (t) => {
    const credential = key("Q");
    const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
    const root = await mkdtemp(join(tmpdir(), "voting-keys-"));
    let clock = Date.parse(now);
    t.mock.method(Date, "now", () => clock);
    try {
      const report = await refreshVotingSources({ state, store, context: { repos }, now: () => now,
        deadlineMs: clock + 60_000, fetch: fetchPages(credential), geocode: async () => null,
        registry: { divisions: [], bodies: [] }, vault: cycleVault(root), seeds: ids.map(door) });
      clock += 1;
      assert.ok(report.terminal?.acquisitionSucceeded, JSON.stringify(report.terminal));
      assert.deepEqual(report.attemptedSourceIds.filter(id => (ids as readonly string[]).includes(id)).sort(), [...ids].sort());
      const reader = await readVotingSitesProjection(state, { store, now, bypassCache: true });
      assert.equal(reader.kind, "PROMOTED");
      if (reader.kind !== "PROMOTED") return;
      const sites = reader.value.jurisdictions.flatMap(row => row.sites);
      for (const [kind, count] of Object.entries(counts)) {
        assert.equal(sites.filter(site => (site.kinds ?? [site.kind]).includes(kind as never)).length, count, `${place} ${kind}`);
      }
      assert.ok(sites.every(site => site.sources?.every(source => source.official)));
      const blanks = reader.value.jurisdictions.flatMap(row => row.blanks ?? []);
      assert.equal(blanks.some(blank => /held|restricted/i.test(`${blank.id} ${blank.owed} ${blank.tried.join(" ")}`)), false);
      for (const file of await filesUnder(root)) assert.equal((await readFile(file)).includes(credential), false, `${file} holds no key`);
      assert.equal(JSON.stringify(await repos.doors.list()).includes(credential), false);
      assert.equal(JSON.stringify(await repos.fieldManual.list()).includes(credential), false);
      assert.equal(JSON.stringify(reader.value).includes(credential), false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("El Paso: the saved copy blanks the key, keeps every location, and records how it was cleaned", async () => {
  const credential = key("Q");
  for (const [id, count] of [["tx-el-paso-early-voting-2026", 39], ["tx-el-paso-vote-centers-2026", 123]] as const) {
    const source = door(id);
    const read = await readVotingSource(source, { fetch: fetchPages(credential), now: () => now });
    assert.equal(read.sites.length, count, id);
    assert.equal(read.blanks.filter(blank => blank.reason === "access" || blank.reason === "extraction").length, 0, id);
    const evidence = await votingSourceEvidence(source, read);
    const page = evidence.find(capture => capture.url === source.url)!;
    const saved = gunzipSync(Buffer.from(page.savedDocument!.body, "base64")).toString("utf8");
    assert.equal(saved.includes(credential), false);
    assert.ok(saved.includes(`key=${REDACTION_PLACEHOLDER}&callback=initMap`));
    assert.equal(classifyAcquisition(saved).tier, "RAW");
    assert.deepEqual(page.derivation?.redactionsByClass, { google_api_key: 1 });
    assert.notEqual(page.derivation?.rawHash, page.derivation?.derivedHash);
    assert.equal(page.derivation?.derivedHash, `sha256-${page.rawHash}`, "the saved hash is the cleaned copy's");
    assert.ok(read.rawBodies.every(body => !Buffer.from(body.bytes).includes(credential)), "the locations were read from the cleaned copy");
  }
});

test("a rotating key alone is not a change to the door", async () => {
  const repos = createMemoryRepositories(), source = door("tx-el-paso-vote-centers-2026");
  await saveVotingSourceDoor(repos.doors, source, now);
  const hashes: (string | null | undefined)[] = [];
  for (const fill of ["Q", "R"]) {
    const read = await readVotingSource(source, { fetch: fetchPages(key(fill)), now: () => now });
    await recordVotingSourceRead(repos.doors, source, read, now);
    hashes.push((await repos.doors.list()).find(row => row.value.kind === "official-voting-source")?.value.validators?.contentHash);
  }
  assert.ok(hashes[0]);
  assert.equal(hashes[1], hashes[0]);
});

const KY = "tests/fixtures/voting-sources/vs-04-southeast/ky-all-polling-locations.xlsx";
const MT = "tests/fixtures/voting-sources/mt-2026-polling-satellite.xlsx";
const FL = "tests/fixtures/voting-sources/vs-04-southeast/fl-early-ballot-intake.zip";
const fileFetch = (bytes: Uint8Array, type: string) => (async input => String(input).endsWith("/robots.txt")
  ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } })
  : new Response(new Uint8Array(bytes), { headers: { "content-type": type } })) as typeof fetch;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Counts recorded from the same reads on origin/river before this change; they must not move.
for (const [file, type, expected] of [
  [KY, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { "ky-statewide-election-day-general-2026": 1409,
    "ky-statewide-excused-in-person-general-2026": 120, "ky-statewide-no-excuse-in-person-general-2026": 202, "ky-statewide-dropbox-general-2026": 168 }],
  [MT, "application/octet-stream", { "mt-statewide-polling-2026": 304, "mt-statewide-satellite-2026": 31 }],
  [FL, "application/x-zip-compressed", { "fl-alachua-early-general-2026": 8, "fl-union-early-general-2026": 1 }],
] as const) {
  test(`${file.split("/").at(-1)} keeps publishing exactly as before, saved as its own bytes`, async () => {
    const bytes = new Uint8Array(readFileSync(file));
    for (const [id, count] of Object.entries(expected)) {
      const read = await readVotingSource({ ...door(id), electionAssociationVerified: false }, { fetch: fileFetch(bytes, type), now: () => now });
      assert.equal(read.sites.length, count, id);
      const [saved] = (await holdVotingRawEvidence(read, now)).filter(capture => !capture.url.endsWith("/robots.txt"));
      assert.equal(saved!.rawHash, sha256(bytes), id);
      assert.equal(saved!.contentType, type);
      assert.equal(saved!.derivation, undefined);
      assert.deepEqual(new Uint8Array(gunzipSync(Buffer.from(saved!.savedDocument!.body, "base64"))), bytes);
    }
  });
}

test("a spreadsheet or PDF whose bytes hold a key is never re-saved; its extracted text, blanked, is the copy", async () => {
  const credential = key("Z");
  // Real published documents with a key-shaped string appended after their last structure, where readers ignore it.
  const workbook = new Uint8Array([...readFileSync(MT), ...new TextEncoder().encode(credential)]);
  const read = await readVotingSource({ ...door("mt-statewide-polling-2026"), electionAssociationVerified: false }, { fetch: fileFetch(workbook, "application/octet-stream"), now: () => now });
  assert.equal(read.sites.length, 304, "the workbook is still parsed from its own bytes");
  const [sheet] = (await holdVotingRawEvidence(read, now)).filter(capture => !capture.url.endsWith("/robots.txt"));
  const sheetCopy = gunzipSync(Buffer.from(sheet!.savedDocument!.body, "base64")).toString("utf8");
  assert.equal(sheet!.contentType, "text/plain; charset=utf-8");
  assert.equal(sheetCopy.includes(credential), false);
  assert.equal(sheetCopy.startsWith("PK"), false, "never the workbook decoded as text");
  for (const site of read.sites.slice(0, 20)) assert.ok(sheetCopy.includes(site.name), site.name);
  assert.ok(sheet!.derivation);

  const pdf = new Uint8Array([...readFileSync("tests/fixtures/cochise-2026-vote-centers.pdf"), ...new TextEncoder().encode(`%${credential}\n`)]);
  const [copy] = await holdVotingRawEvidence({ rawBodies: [{ url: "https://cochise.az.gov/DocumentCenter/View/4575/Vote-Center-Locations-PDF", contentType: "application/pdf", bytes: pdf }] }, now);
  const pdfCopy = gunzipSync(Buffer.from(copy!.savedDocument!.body, "base64")).toString("utf8");
  assert.equal(pdfCopy.includes(credential), false);
  assert.equal(pdfCopy.startsWith("%PDF"), false);
  assert.match(pdfCopy, /Shiloh Christian Ministries/);

  const vault = new MemoryEvidenceStore();
  const fact = await vaultCapture({ vault, url: "https://cochise.az.gov/DocumentCenter/View/4575/Vote-Center-Locations-PDF", bytes: pdf,
    contentType: "application/pdf", httpStatus: 200, retrievedAt: now });
  assert.ok(!("error" in fact), JSON.stringify(fact));
  if ("error" in fact) return;
  assert.match(fact.capture.evidence.text, /Shiloh Christian Ministries/);
  for (const stored of await vault.list("project/")) assert.equal(Buffer.from((await vault.get(stored))!.bytes).includes(credential), false, stored);
});

test("doors the removed hold suspended, Cochise's among them, open again; other suspensions stay", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { reopenHeldDoors } = await import("../lib/control-plane/repository/migrations/RIVER-KEYS.ts");
  const { isDoorRecord } = await import("../lib/doors/registry.ts");
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE cp_doors(id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now())");
    const repos = createMemoryRepositories();
    await saveVotingSourceDoor(repos.doors, door("cochise:ballot-box-table"), now);
    const cochise = (await repos.doors.list())[0]!;
    const held = { ...cochise.value, status: "SUSPENDED", readNow: false,
      notes: "This document requires encrypted restricted evidence storage. Other official files remain active.", updatedAt: now };
    const duplicate = { ...cochise.value, doorId: "page:duplicate", status: "SUSPENDED", readNow: false, notes: "Publishing source is read through another door" };
    for (const [id, value] of [[cochise.id, held], ["page:duplicate", duplicate], ["page:open", { ...cochise.value, doorId: "page:open" }]] as const) {
      await db.query("INSERT INTO cp_doors(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)", [id, now, JSON.stringify(value)]);
    }
    const sql = { query: async (text: string, params: readonly unknown[] = []) => (await db.query<Record<string, unknown>>(text, [...params])).rows };
    assert.equal(await reopenHeldDoors(sql), 1);
    const rows = new Map((await sql.query("SELECT id, revision, value FROM cp_doors")).map(row => [row.id as string, row]));
    const reopened = rows.get(cochise.id)!.value as typeof held;
    assert.equal(reopened.status, "OPEN");
    assert.equal(reopened.readNow, true);
    assert.equal(Number(rows.get(cochise.id)!.revision), 2);
    assert.ok(isDoorRecord(reopened));
    assert.equal(reopened.config.votingSource, cochise.value.config.votingSource, "the door keeps the source it reads");
    assert.equal((rows.get("page:duplicate")!.value as typeof held).status, "SUSPENDED");
    assert.equal(Number(rows.get("page:open")!.revision), 1);
    assert.equal(await reopenHeldDoors(sql), 0, "a second pass changes nothing");
  } finally { await db.close(); }
});

test("production's key-held doors, recorded by failure reason and with rewritten notes, open again; other suspensions stay", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { reopenKeyHeldDoors } = await import("../lib/control-plane/repository/migrations/RIVER-KEYS-FX.ts");
  const { isDoorRecord } = await import("../lib/doors/registry.ts");
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE cp_doors(id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now())");
    const repos = createMemoryRepositories();
    await saveVotingSourceDoor(repos.doors, door("cochise:ballot-box-table"), now);
    const base = (await repos.doors.list())[0]!.value;
    // The two shapes production held on Oct 24, 12:28 UTC: notes rewritten by the door refresh.
    const boxTable = { ...base, doorId: "cochise:ballot-box-table", status: "SUSPENDED", readNow: false, notes: "Cochise County Recorder: list-page; 2026-11-03" };
    const pdf = { ...base, doorId: "legacy:cochise:vote-center-pdf", status: "SUSPENDED", readNow: false,
      notes: "Cochise County Elections Department: file; 2026-11-03",
      lastFailureReason: "https://www.cochise.az.gov/292/Elections; Source document requires encrypted restricted evidence storage; other official files remain active" };
    const other = { ...base, doorId: "page:duplicate", status: "SUSPENDED", readNow: false, notes: "Publishing source is read through another door" };
    for (const [id, value] of [[boxTable.doorId, boxTable], [pdf.doorId, pdf], [other.doorId, other]] as const) {
      await db.query("INSERT INTO cp_doors(id,revision,updated_at,value) VALUES($1,4,$2,$3::jsonb)", [id, now, JSON.stringify(value)]);
    }
    const sql = { query: async (text: string, params: readonly unknown[] = []) => (await db.query<Record<string, unknown>>(text, [...params])).rows };
    assert.equal(await reopenKeyHeldDoors(sql), 2);
    const rows = new Map((await sql.query("SELECT id, revision, value FROM cp_doors")).map(row => [row.id as string, row]));
    for (const id of ["cochise:ballot-box-table", "legacy:cochise:vote-center-pdf"]) {
      const value = rows.get(id)!.value as typeof pdf;
      assert.equal(value.status, "OPEN", id);
      assert.equal(value.readNow, true, id);
      assert.equal(value.lastFailureReason, undefined, id);
      assert.equal(Number(rows.get(id)!.revision), 5, id);
      assert.ok(isDoorRecord(value), id);
    }
    assert.equal((rows.get("page:duplicate")!.value as typeof pdf).status, "SUSPENDED");
    assert.equal(await reopenKeyHeldDoors(sql), 0, "a second pass changes nothing");
  } finally { await db.close(); }
});
