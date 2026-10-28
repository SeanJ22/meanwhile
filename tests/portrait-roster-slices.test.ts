import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "../lib/db/client.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { portraitSlicesInMemory, readPortraitRosters, type PortraitRosterRequest, type PortraitRosters } from "../lib/civic-data/portrait-rosters.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";

const HASH = `sha256-${"a".repeat(64)}`, AT = "2026-10-01T00:00:00.000Z";
const provenance = { sourceUrl: "https://legislature.example.gov/members", sourceOrg: "Legislature", collectedAt: AT, verifiedAt: null };
function person(id: string, name: string, extra: Partial<Officeholder> = {}): Officeholder {
  return { id, personId: id, nativeIds: {}, name, officeTitle: "State Senator", level: "STATE", state: "AZ", chamber: "upper",
    termStart: "", termEnd: "", birthDate: null, partyLabel: null, websiteUrl: null, profileUrls: [], contactFormUrl: null, phone: null,
    email: null, campaignUrl: null, photo: null, social: {}, provenance, offices: [{ heavy: "office ".repeat(50) }],
    sourceHolders: [{ heavy: "merged copy ".repeat(50) }], fieldSources: { name: provenance, phone: provenance }, ...extra } as unknown as Officeholder;
}
/** A portrait bound to this person on their own page: one readers are shown. */
const shownPhoto = (personId: string, name: string, basis = "OWN_PAGE") => ({ url: `/api/portraits/officials/${"a".repeat(64)}.jpg`,
  sourceUrl: `https://img.example.gov/${personId}.jpg`, verification: { personId, basis, ownPageUrl: `https://legislature.example.gov/${personId}`, name,
    imageUrl: `https://img.example.gov/${personId}.jpg`, checkedAt: AT, imageHash: HASH, sourceImageHash: HASH,
    sources: [{ url: `https://legislature.example.gov/${personId}`, artifactId: `art-${personId}`, contentHash: HASH, retrievedAt: AT }],
    license: { value: "public domain", sourceUrl: `https://legislature.example.gov/${personId}`, quote: "Works of the legislature are public." } } }) as unknown as Officeholder["photo"];
const roster = (officeholders: Officeholder[]): OfficeholderSet => ({ scope: "US-AZ", generatedAt: AT, officeholders,
  divisions: officeholders.map(row => ({ officeholderId: row.id, ocdId: "ocd-division/country:us/state:az/sldu:7" })) as OfficeholderSet["divisions"], unmatched: [] });

const A = "STATE_LEGISLATOR:US-AZ:openstates-people:v1", B = "STATE_LEGISLATOR:US-AZ", P = "STATE_LEGISLATOR:US-AZ:people:portraits:v1";
// Open States: a1 shows its own portrait; a3's portrait shows from the portrait record; a6's held portrait is one the database cannot confirm.
const openStates = roster([person("ocd-person/a1", "Ann One", { photo: shownPhoto("ocd-person/a1", "Ann One") }),
  person("ocd-person/a2", "Ben Two"), person("ocd-person/a3", "Cal Three"), person("ocd-person/a4", "Dee Four"), person("ocd-person/a6", "Fay Six")]);
// The official roster names a1 and a2 by their Open States ids, and one person of its own.
const official = roster([person("az-legislature:1", "Ann One", { nativeIds: { "ocd-person": ["ocd-person/a1"] } }),
  person("az-legislature:2", "Ben Two", { nativeIds: { "ocd-person": ["ocd-person/a2"] } }), person("az-legislature:5", "Eve Five")]);
const portraits = roster([person("ocd-person/a3", "Cal Three", { photo: shownPhoto("ocd-person/a3", "Cal Three") }),
  person("ocd-person/a4", "Dee Four"), person("ocd-person/a6", "Fay Six", { photo: shownPhoto("ocd-person/a6", "Fay Six", "TWO_SOURCES") })]);
const HELD = new Map([[A, { scope: "US-AZ:openstates-people:v1", version: "cv-a1", roster: openStates }], [B, { scope: "US-AZ", version: "cv-b1", roster: official }],
  [P, { scope: "US-AZ:people:portraits:v1", version: "cv-p1", roster: portraits }]]);
const request = (read: PortraitRosterRequest["read"], due: string[] = [], subjects: string[] = []): PortraitRosterRequest => ({
  rosters: [{ recordClass: "STATE_LEGISLATOR", scope: "US-AZ:openstates-people:v1" }, { recordClass: "STATE_LEGISLATOR", scope: "US-AZ" }],
  portrait: { recordClass: "STATE_LEGISLATOR", scope: "US-AZ:people:portraits:v1" }, read, due, subjects });
const inMemory = (input: PortraitRosterRequest) => readPortraitRosters({
  versions: async keys => keys.flatMap(key => { const row = HELD.get(key); return row ? [{ key, recordClass: "STATE_LEGISLATOR" as const, scope: row.scope,
    versionId: row.version, promotedAt: AT, readModelSha256: `hash-${row.version}` }] : []; }),
  slices: async slice => portraitSlicesInMemory(new Map([...HELD].map(([key, row]) => [key, row.roster])), slice),
}, input);
const picked = (result: PortraitRosters) => ({ ...Object.fromEntries(result.rosters.map(row => [row.scope, row.roster.officeholders.map(person => person.id)])),
  portrait: result.portrait?.officeholders.map(person => person.id) ?? [], shown: [...result.shown] });

test("the database and memory stores choose the same people: changed rosters' people without a shown portrait, due people, nothing else", async t => {
  const pg = new PGlite(), originalFetch = neonConfig.fetchFunction, originalUrl = process.env.DATABASE_URL, originalReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  process.env.DATABASE_URL = "postgres://readonly:fixture@ep-portrait-slices.invalid/neondb";
  t.after(async () => {
    neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    await pg.close();
  });
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY, normalized_hash text);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY, record_class text, scope text, current_version_id text, promoted_at timestamptz, payload jsonb)`);
  for (const [key, row] of HELD) {
    await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2)", [row.version, `hash-${row.version}`]);
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,'STATE_LEGISLATOR',$2,$3,$4,$5)", [key, row.scope, row.version, AT, { roster: row.roster }]);
  }
  let bodies: string[] = [];
  neonConfig.fetchFunction = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const statement = JSON.parse(String(init?.body));
    assert.match(statement.query, /^\s*(WITH|SELECT)\b/i, "a portrait list only reads");
    const result = await pg.query<Record<string, unknown>>(statement.query, statement.params);
    const body = JSON.stringify({ command: "SELECT", rowCount: result.rows.length, rowAsArray: true, fields: result.fields,
      rows: result.rows.map(row => result.fields.map(field => { const value = row[field.name];
        return value === null ? null : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value); })) });
    bodies.push(body);
    return new Response(body);
  };
  const store = new PostgresRoutineDataStore();
  const both = async (input: PortraitRosterRequest) => {
    bodies = [];
    const database = await store.readPortraitRosters(input), memory = await inMemory(input);
    assert.deepEqual(picked(database), picked(memory));
    const sent = bodies.join("\n");
    for (const name of ["Ann One", "Cal Three"]) assert.ok(!sent.includes(name), `${name}'s portrait shows, so they never leave the database`);
    for (const heavy of ["office office", "merged copy"]) assert.ok(!sent.includes(heavy), "offices and merged copies stay behind");
    return { result: database, bytes: bodies.reduce((sum, body) => sum + Buffer.byteLength(body), 0), responses: bodies.length };
  };
  const current = { [A]: "cv-a1", [B]: "cv-b1" };

  const first = await both(request(null));
  assert.deepEqual(picked(first.result), { "US-AZ:openstates-people:v1": ["ocd-person/a2", "ocd-person/a4", "ocd-person/a6"],
    "US-AZ": ["az-legislature:2", "az-legislature:5"], portrait: ["ocd-person/a6"], shown: [] });
  assert.equal(first.result.complete, true);
  assert.deepEqual(first.result.versions, current);

  const quiet = await both(request(current));
  assert.equal(quiet.responses, 1, "unchanged rosters cost one version query");
  assert.deepEqual(picked(quiet.result), { "US-AZ:openstates-people:v1": [], "US-AZ": [], portrait: [], shown: [] });
  assert.equal(quiet.result.complete, false);

  // The official roster moved: its people without a shown portrait are read, with the Open States row naming the same person, and no one else.
  const moved = await both(request({ ...current, [B]: "cv-b0" }));
  assert.deepEqual(picked(moved.result), { "US-AZ:openstates-people:v1": ["ocd-person/a2"], "US-AZ": ["az-legislature:2", "az-legislature:5"], portrait: [], shown: [] });
  assert.deepEqual(moved.result.rosters.find(row => row.scope === "US-AZ")?.roster.divisions.map(row => row.officeholderId), ["az-legislature:2", "az-legislature:5"]);

  // A due retry reads that person alone; a person whose portrait shows is never read even when named due.
  const due = await both(request(current, ["ocd-person/a4", "ocd-person/a3"]));
  assert.deepEqual(picked(due.result), { "US-AZ:openstates-people:v1": ["ocd-person/a4"], "US-AZ": [], portrait: [], shown: [] });

  // Local officials and members of Congress learn which of them have a shown portrait without it being read.
  const subjects = await both(request(current, [], ["ocd-person/a3", "bioguide-x"]));
  assert.deepEqual(picked(subjects.result), { "US-AZ:openstates-people:v1": [], "US-AZ": [], portrait: [], shown: ["ocd-person/a3"] });
  t.diagnostic(`first list ${first.bytes} B; unchanged ${quiet.bytes} B; one roster moved ${moved.bytes} B; one retry due ${due.bytes} B; subjects ${subjects.bytes} B`);
});

test("a state's first list, before any portrait record, reads everyone", async () => {
  const result = await readPortraitRosters({
    versions: async keys => keys.flatMap(key => key === P ? [] : [{ key, recordClass: "STATE_LEGISLATOR" as const, scope: HELD.get(key)!.scope,
      versionId: HELD.get(key)!.version, promotedAt: AT, readModelSha256: null }]),
    slices: async slice => portraitSlicesInMemory(new Map([[A, openStates], [B, official]]), slice),
  }, request({ [A]: "cv-a1", [B]: "cv-b1" }));
  assert.equal(result.everyone, true);
  assert.equal(result.portrait, null);
  assert.deepEqual(result.rosters.map(row => row.roster.officeholders.length), [5, 3]);
});
