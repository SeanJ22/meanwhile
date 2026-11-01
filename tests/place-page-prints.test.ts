import assert from "node:assert/strict";
import test from "node:test";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { PLACE_PACKAGE_SQL, rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { packPlaceContext, unpackPlaceContextRow } from "../lib/reader/place-ready.ts";
import { composePlaceRow } from "../lib/reader/place-decode.ts";
import { meetingPartitionScope } from "../lib/civic-data/meeting-partitions.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";

const STATE = "ocd-division/country:us/state:az", COUNTY = `${STATE}/county:pima`, PLACES = 8, OTHER_BODIES = 600;
const AT = new Date(Date.now() - 86_400_000).toISOString(), DAY = 86_400_000;
const place = (n: number) => `${COUNTY}/place:town_${String(n).padStart(2, "0")}`;
const council = (n: number) => `${place(n)}#council`, schools = (n: number) => `${place(n)}#schools`;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().replace(/\.\d{3}Z$/, "Z");

const holder = (body: string, n: number) => ({ id: `${body}:member-${n}`, name: `Member ${n} of ${body.split("/").at(-1)}`,
  officeTitle: n === 0 ? "Mayor" : "Council Member", divisions: [body.split("#")[0]!], authority: "REGISTRY_BODY_ROSTER", sourceUrl: `https://example.gov/${n}` });

/** The state's registry binding at a realistic size: every body, roster, candidacy and photo in the state. */
function runtime(edition: string) {
  const local = Array.from({ length: PLACES }, (_, n) => [council(n), schools(n)]).flat();
  const elsewhere = Array.from({ length: OTHER_BODIES }, (_, n) => `${STATE}/county:other_${n % 14}/place:far_${n}#board`);
  const bodies = [...local, ...elsewhere].map(id => ({ id, ocdId: id.split("#")[0], name: `${edition} ${id.split("/").at(-1)}`,
    homepage: `https://example.gov/${encodeURIComponent(id)}`, bodyType: "council", seats: 7 }));
  const rosters = bodies.map(body => ({ bodyId: body.id, sourceUrl: body.homepage, members: Array.from({ length: 7 }, (_, n) => holder(body.id, n)) }));
  return { formatVersion: 1, registry: { generatedAt: AT, bodies,
    divisions: [...new Set(bodies.map(body => body.ocdId!))].map(ocdId => ({ ocdId, label: ocdId.split(":").at(-1), state: "AZ", divisionType: "place", parentOcdId: COUNTY })) },
    bodyRosters: rosters, rosterReaderDispositions: [],
    statewideExecutives: Array.from({ length: 10 }, (_, n) => ({ stateOcdId: STATE, office: `Office ${n}`, holder: { id: `az-exec-${n}`, name: `Executive ${n}` } })),
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",
      rows: rosters.flatMap(roster => roster.members.slice(0, 3).map(member => ({ holder: member, status: "NOT_CHECKED", candidacy: null }))) },
    officialPhotos: { photos: rosters.flatMap(roster => roster.members.slice(0, 3).map(member => ({ officeholderId: member.id, personId: member.id, url: `https://example.gov/photo/${member.id}` }))) },
    rosterPhotos: {} };
}

function registration() {
  const local = Array.from({ length: PLACES }, (_, n) => ({ id: `gov-${n}`, name: `Town ${n}`, state: "AZ", governmentClass: "MUNICIPAL",
    associations: [{ divisionId: place(n) }] }));
  const elsewhere = Array.from({ length: 700 }, (_, n) => ({ id: `gov-far-${n}`, name: `Far ${n}`, state: "AZ", governmentClass: "SPECIAL DISTRICT",
    associations: [{ divisionId: `${STATE}/county:other_${n % 14}/place:far_${n}` }] }));
  return { governments: [...local, ...elsewhere], divisions: [
    ...Array.from({ length: PLACES }, (_, n) => ({ ocdId: place(n), parentOcdId: COUNTY, label: `Town ${n}`, divisionType: "place", state: "AZ" })),
    ...Array.from({ length: 900 }, (_, n) => ({ ocdId: `${STATE}/county:other_${n % 14}/place:far_${n}`, parentOcdId: STATE, label: `Far ${n}`, divisionType: "place", state: "AZ" }))] };
}

/** One body's calendar: past and upcoming sittings, with agenda text on some. */
function calendar(body: string, label: string, from: number, count: number) {
  const meetings = Array.from({ length: count }, (_, n) => ({ id: `ical:${body}:${label}:${n}`, bodyId: body, ocdId: body.split("#")[0], bodyName: "Town Council",
    title: `${label} regular meeting ${n}`, startsAt: iso(from + n * 7), timeZone: "America/Phoenix",
    location: { name: "Town Hall", address: `${n} Main St`, lat: 32.2, lng: -110.9 }, agendaUrl: `https://example.gov/${label}/agenda/${n}`,
    jurisdiction: "Local", status: "SCHEDULED", provenance: { sourceUrl: "https://example.gov/calendar", sourceOrg: "example.gov", collectedAt: AT, verifiedAt: AT } }));
  const agendaDocuments = meetings.filter((_, n) => n % 3 === 0).map(meeting => ({ id: `${meeting.id}:agenda`, meetingId: meeting.id,
    documentUrl: `${meeting.agendaUrl}.pdf`, text: `Agenda for ${meeting.title}. `.repeat(60) }));
  return { formatVersion: 1, generatedAt: AT, counts: { fresh: count, carried: 0, total: count, duplicatesCollapsed: 0 },
    sources: [{ source: "ical", ok: true, error: null, fetched: count, normalized: count, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }],
    meetings, agendaDocuments };
}

async function fixture() {
  const { pg, publish } = await migratedReaderDb();
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const entity = (id: string, kind: string, name: string, parent: string | null = null) =>
    query("INSERT INTO entity(id,kind,name,parent_id,state) VALUES($1,$2,$3,$4,'AZ') ON CONFLICT DO NOTHING", [id, kind, name, parent]);
  const fact = async (id: string, field: string, value: unknown) => {
    await query("UPDATE fact SET status='superseded' WHERE entity_id=$1 AND field=$2 AND status='live'", [id, field]);
    return query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
    VALUES($1,$2,$3,'saved quote','live','OFFICIAL',1,'saved quote',$4,'fixture')`, [id, field, JSON.stringify(value), AT]);
  };
  await publish({ id: "registration-az", value: registration(), at: AT, recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", sourceId: "registration" });
  await publish({ id: "runtime-1", value: runtime("first"), at: AT, recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US-AZ:reader-registry-runtime", sourceId: "registry-runtime" });
  await query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/roster','https://example.gov/roster',$1,$2,'roster')", [AT, "a".repeat(64)]);
  await entity(STATE, "place", "Arizona");
  await entity(COUNTY, "place", "Pima County", STATE);
  for (let n = 0; n < PLACES; n++) {
    await entity(place(n), "place", `Town ${n}`, COUNTY);
    for (const body of [council(n), schools(n)]) {
      await entity(body, "body", "Town Council", place(n));
      await fact(body, "name", `Town ${n} ${body.endsWith("council") ? "Council" : "School Board"}`);
      await fact(body, "office_phone", "520-555-0100");
      for (let m = 0; m < 7; m++) {
        const person = `person:${body}:${m}`;
        await entity(person, "person", `Member ${m}`);
        await fact(body, `member:${person}`, { name: `Member ${m}`, office: m === 0 ? "Chair" : "Member" });
        await fact(person, "name", `Member ${m} of Town ${n}`);
        await fact(person, "phone", `520-555-01${String(m).padStart(2, "0")}`);
      }
      // An older verified edition keeps sittings past the lookback; the current one holds the recent calendar.
      const scope = meetingPartitionScope("ical", body);
      await publish({ id: `${body}:v1`, value: calendar(body, "older", -400, 30), at: AT, recordClass: "MEETING", scope, sourceId: "ical" });
      await publish({ id: `${body}:v2`, value: calendar(body, "current", -100, 30), at: AT, recordClass: "MEETING", scope, sourceId: "ical" });
    }
  }
  await query("UPDATE place_page SET stale_at=NULL");
  return { pg, query, publish, fact };
}

interface Meter { pageReads: number; pageBytes: number; contextReads: number; received: number; sent: number; statements: number }
const meter = (): Meter => ({ pageReads: 0, pageBytes: 0, contextReads: 0, received: 0, sent: 0, statements: 0 });
/** Rows back as they cross the connection; statement text counts once per connection, as a named statement does. */
function metered(query: Query, into: Meter, prepared = new Set<string>()): Query {
  return async (text, params = []) => {
    const rows = await query(text, params), bytes = Buffer.byteLength(JSON.stringify(rows));
    into.statements++; into.received += bytes;
    into.sent += Buffer.byteLength(JSON.stringify(params)) + (text === PLACE_PACKAGE_SQL && prepared.has(text) ? 0 : Buffer.byteLength(text));
    if (text === PLACE_PACKAGE_SQL) { prepared.add(text); into.pageReads++; into.pageBytes += bytes; }
    if (/context->\$2::text->'full'/.test(text)) into.contextReads++;
    return rows;
  };
}

const factDb = (pg: Awaited<ReturnType<typeof fixture>>["pg"], into: Meter): FactDb => {
  const prepared = new Set<string>();
  return { transaction: work => pg.transaction(tx => work(metered(async (text, params = []) => (await tx.query<Record<string, unknown>>(text, [...params])).rows, into, prepared))) };
};

async function stored(query: Query) {
  const rows = await query("SELECT place_id,context FROM place_page ORDER BY place_id");
  return new Map(await Promise.all(rows.map(async row => {
    const { prints, ...context } = row.context as Record<string, unknown>, id = String(row.place_id);
    const unpacked = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, key === "formatVersion" ? value
      : Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([shape, packed]) => [shape, unpackPlaceContextRow(packed)]))])) as Record<string, Record<string, Record<string, unknown>>>;
    return [id, { body: await composePlaceRow({ state: "AZ", divisionIds: [id] }, structuredClone(unpacked.current!.full!)),
      history: await composePlaceRow({ state: "AZ", divisionIds: [id], includeHistory: true }, structuredClone(unpacked.history!.full!)), prints, context: unpacked }] as const;
  })));
}

async function queueAll(query: Query) {
  for (let n = 0; n < PLACES; n++) await query("INSERT INTO place_page(place_id,stale_at) VALUES($1,clock_timestamp()) ON CONFLICT(place_id) DO UPDATE SET stale_at=clock_timestamp()", [place(n)]);
}

const turn = (pg: Awaited<ReturnType<typeof fixture>>["pg"], into: Meter) =>
  rebuildPlacePages({ db: factDb(pg, into), limit: 1_000, concurrency: 1, purge: async () => ({ purged: true }) });
const perPage = (bytes: number) => Math.round(bytes / PLACES);

test("a rebuild reads only what changed for its place and stores the same pages as a full read", async () => {
  const { pg, query, publish, fact } = await fixture();
  try {
    // First build: no prints are held, so every page is read whole, as before this change.
    await queueAll(query);
    const first = meter();
    assert.deepEqual(await turn(pg, first), { rebuilt: PLACES, failed: 0, remaining: 0 });
    const built = await stored(query);
    const town = built.get(place(3))!;
    assert.ok(town.body.meetings.length > 0 && town.body.bodies.some(body => body.roster?.members.length === 7), "the fixture page has sittings and officials");
    assert.ok(town.body.registry?.registry.bodies.some(body => body.id === council(3)) && town.body.governments.length === 1 && town.body.divisions.length,
      "the fixture page has registry bodies, a registered government and divisions");
    assert.ok(town.history.meetings.some(meeting => Date.parse(meeting.startsAt) < Date.now() - 300 * DAY), "the history page keeps archived sittings");

    // Queued again with nothing changed: each page's read returns prints only, and nothing is rewritten.
    await queueAll(query);
    const unchanged = meter();
    assert.deepEqual(await turn(pg, unchanged), { rebuilt: PLACES, failed: 0, remaining: 0, unchanged: PLACES });
    assert.equal(unchanged.contextReads, 0, "an unchanged page never reads its saved rows");
    assert.deepEqual(await stored(query), built, "unchanged pages are kept exactly");

    // A state-wide registry edition that renames a far-away board: the same answer for every town here.
    await publish({ id: "runtime-2", value: { ...runtime("first"), registry: { ...runtime("first").registry,
      bodies: runtime("first").registry.bodies.map(body => body.id.includes("far_5#") ? { ...body, name: "Renamed far board" } : body) } },
    at: AT, recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US-AZ:reader-registry-runtime", sourceId: "registry-runtime" });
    await queueAll(query);
    const stateWide = meter();
    assert.deepEqual(await turn(pg, stateWide), { rebuilt: PLACES, failed: 0, remaining: 0, unchanged: PLACES });
    assert.deepEqual(await stored(query), built);

    // One town's own officials and calendar change.
    await fact(`person:${council(3)}:1`, "phone", "520-555-0199");
    await publish({ id: `${council(3)}:v3`, value: calendar(council(3), "moved", -95, 30), at: AT, recordClass: "MEETING",
      scope: meetingPartitionScope("ical", council(3)), sourceId: "ical" });
    await queueAll(query);
    const changed = meter();
    assert.deepEqual(await turn(pg, changed), { rebuilt: PLACES, failed: 0, remaining: 0, unchanged: PLACES - 1 });
    assert.equal(changed.contextReads, 1, "a changed page reads its own saved rows once, for the groups that did not change");
    const partial = await stored(query);

    // The same snapshot read whole, with no prints held, builds identical pages.
    await query("UPDATE place_page SET context=context-'prints'");
    await queueAll(query);
    const whole = meter();
    assert.deepEqual(await turn(pg, whole), { rebuilt: PLACES, failed: 0, remaining: 0 });
    const full = await stored(query);
    for (const [id, page] of full) {
      const kept = partial.get(id)!;
      assert.deepEqual(kept.body, page.body, `${id}: the ready page matches a full read`);
      assert.deepEqual(kept.history, page.history, `${id}: the history page matches a full read`);
      assert.deepEqual(kept.context, page.context, `${id}: the saved rows match a full read`);
      assert.deepEqual(kept.prints, page.prints, `${id}: the prints match a full read`);
    }
    assert.ok(full.get(place(3))!.body.meetings.some(meeting => meeting.title.startsWith("moved")));
    assert.equal(full.get(place(3))!.body.bodies.find(body => body.id === council(3))!.roster!.members
      .find(member => member.personId === `person:${council(3)}:1`)?.phone, "520-555-0199");
    assert.deepEqual(full.get(place(2))!.body.meetings, built.get(place(2))!.body.meetings, "another town's calendar is untouched");

    console.log(`place-package bytes per page (${PLACES} towns, rows received): full read ${perPage(first.pageBytes)} B; `
      + `unchanged ${perPage(unchanged.pageBytes)} B; state-wide edition ${perPage(stateWide.pageBytes)} B; `
      + `one town changed ${perPage(changed.pageBytes)} B (+ ${perPage(changed.received - changed.pageBytes)} B other rows incl. saved rows)`);
    console.log(`whole turn per page, received + sent: first ${perPage(first.received + first.sent)} B, unchanged ${perPage(unchanged.received + unchanged.sent)} B, `
      + `changed ${perPage(changed.received + changed.sent)} B; place-package statement text ${Buffer.byteLength(PLACE_PACKAGE_SQL)} B once per connection`);
    assert.ok(unchanged.pageBytes * 40 < first.pageBytes, `an unchanged page reads under 1/40 of a full read (${unchanged.pageBytes} of ${first.pageBytes})`);
    assert.ok(perPage(unchanged.pageBytes) < 2_000, "an unchanged page's read is its prints");
    assert.ok(stateWide.pageBytes * 40 < first.pageBytes);
  } finally { await pg.close(); }
});

test("a page saved by the earlier read stays valid: its read hash and retired routing print do not rebuild it", async () => {
  const { pg, query } = await fixture();
  try {
    await queueAll(query);
    assert.deepEqual(await turn(pg, meter()), { rebuilt: PLACES, failed: 0, remaining: 0 });
    const built = await stored(query);
    await query(`UPDATE place_page SET context=jsonb_set(jsonb_set(context,'{prints,build}','"0123456789abcdef0123456789abcdef"'),'{prints,reads,history,everyday_routing}','"retired"')`);
    await queueAll(query);
    const again = meter();
    assert.deepEqual(await turn(pg, again), { rebuilt: PLACES, failed: 0, remaining: 0, unchanged: PLACES });
    assert.equal(again.contextReads, 0, "a valid old page never reads its saved rows");
    for (const [id, page] of await stored(query)) assert.deepEqual(page.body, built.get(id)!.body, `${id}: the page is kept as it was`);
    // A page printed before long lists had row prints is read whole and saved again with them.
    await query(`UPDATE place_page SET context=jsonb_set(context,'{prints,reads,history}',(context#>'{prints,reads,history}') - ARRAY(SELECT k FROM jsonb_object_keys(context#>'{prints,reads,history}') k WHERE k LIKE '%[]'))`);
    await queueAll(query);
    const whole = meter();
    assert.deepEqual(await turn(pg, whole), { rebuilt: PLACES, failed: 0, remaining: 0 });
    assert.equal(whole.contextReads, 0, "a page without row prints is read whole, not from its saved rows");
  } finally { await pg.close(); }
});

test("a page saved with the routing record is saved again without it, from its own rows, behind the marked pages", async () => {
  const { pg, query } = await fixture();
  try {
    await queueAll(query);
    assert.deepEqual(await turn(pg, meter()), { rebuilt: PLACES, failed: 0, remaining: 0 });
    const built = await stored(query);
    // As saved before this release: the record in every shape of every page, and a hash of the read for a build.
    for (const row of await query("SELECT place_id,context FROM place_page")) {
      const context = row.context as Record<string, Record<string, unknown>>, raw: Record<string, unknown> = { formatVersion: 1 };
      for (const key of ["current", "history", "emptyCurrent", "emptyHistory"]) if (context[key]) raw[key] = { ...unpackPlaceContextRow(context[key].full), everyday_routing: { routes: ["held"] } };
      const prints = { ...(context.prints as object), build: "0123456789abcdef0123456789abcdef" };
      await query("UPDATE place_page SET context=$2::jsonb WHERE place_id=$1", [row.place_id, JSON.stringify({ ...packPlaceContext(raw), prints })]);
    }
    await query("DELETE FROM pass_cursor WHERE name='place-pages:strip'");
    const versions = async () => new Map((await query("SELECT place_id,version FROM place_page")).map(row => [String(row.place_id), String(row.version)]));
    const old = await versions();
    assert.deepEqual(await turn(pg, meter()), { rebuilt: 0, failed: 0, remaining: 0 }, "nothing is marked, and nothing is rebuilt");
    for (const [id, version] of await versions()) assert.equal(version, old.get(id), `${id}: no version moves`);
    for (const row of await query("SELECT context FROM place_page")) for (const shape of ["full", "brief"])
      assert.equal(Object.hasOwn(unpackPlaceContextRow((row.context as Record<string, Record<string, unknown>>).current![shape]), "everyday_routing"), false, `the ${shape} rows carry no routing record`);
    for (const [id, page] of await stored(query)) assert.deepEqual(page.body, built.get(id)!.body, `${id}: the page reads as it did`);
    assert.deepEqual(await query("SELECT position FROM pass_cursor WHERE name='place-pages:strip'"), [{ position: '{"done":true}' }]);
  } finally { await pg.close(); }
});

test("a page that was never built is taken before the rebuild of a built page, whatever its priority", async () => {
  const { pg, query } = await fixture();
  try {
    await queueAll(query);
    assert.deepEqual(await turn(pg, meter()), { rebuilt: PLACES, failed: 0, remaining: 0 });
    const fresh = `${COUNTY}/place:never_built`;
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Never built','AZ')", [fresh]);
    await query("INSERT INTO place_page(place_id,stale_at,priority) VALUES($1,clock_timestamp(),0)", [fresh]);
    await query("UPDATE place_page SET stale_at=clock_timestamp(),priority=1000 WHERE place_id<>$1", [fresh]);
    assert.deepEqual(await rebuildPlacePages({ db: factDb(pg, meter()), limit: 1, concurrency: 1, purge: async () => ({ purged: true }) }), { rebuilt: 1, failed: 0, remaining: 1 });
    assert.deepEqual((await query("SELECT place_id FROM place_page WHERE stale_at IS NULL")).map(row => row.place_id), [fresh], "only the never-built page was taken");
  } finally { await pg.close(); }
});

test("the place read returns every group, only changed groups, or nothing, by the prints it is given", async () => {
  const { pg, query } = await fixture();
  try {
    const params = (held: unknown, partial: boolean) => ["AZ", [place(4)], [], STATE, false, true, true, null, false, [], held === null ? null : JSON.stringify(held), partial];
    const groups = ["registration_held", "division_ids", "agenda_texts", "publication_attempts", "registry", "governments", "divisions",
      "entities", "fields", "rosters", "comments", "sittings", "meeting_rows", "archived_meetings", "archived_documents", "archived_document_links", "parts"];
    const [whole] = await query(PLACE_PACKAGE_SQL, params(null, true));
    assert.equal(whole!.unchanged, false);
    assert.deepEqual(whole!.omitted, []);
    for (const column of groups) assert.notEqual(whole![column], null, `${column} is read without prints`);
    const prints = whole!.prints as Record<string, string>;

    const [same] = await query(PLACE_PACKAGE_SQL, params(prints, true));
    assert.equal(same!.unchanged, true);
    assert.equal(same!.prints, null, "matching prints are not sent back");
    for (const column of groups) assert.equal(same![column], null, `${column} stays behind`);

    const moved = { ...prints, rosters: "0".repeat(32) };
    const [partial] = await query(PLACE_PACKAGE_SQL, params(moved, true));
    assert.equal(partial!.unchanged, false);
    assert.deepEqual(partial!.omitted, Object.keys(prints).filter(group => group !== "rosters").sort());
    for (const column of groups) assert.equal(partial![column] === null, column !== "rosters", column);
    assert.deepEqual(partial!.rosters, [], "rows the stored page holds stay behind");
    assert.deepEqual((await query(PLACE_PACKAGE_SQL, params({ ...moved, "rosters[]": (prints["rosters[]"] as unknown as string[]).slice(1) }, true)))[0]!.rosters, (whole!.rosters as unknown[]).slice(0, 1), "only the missing row is sent");

    // A ZIP page keeps no saved rows: one changed group returns the whole read.
    const [zip] = await query(PLACE_PACKAGE_SQL, params(moved, false));
    assert.deepEqual(zip!.omitted, []);
    for (const column of groups) assert.deepEqual(zip![column], whole![column], column);
  } finally { await pg.close(); }
});

test("only a registered statement is named, and a refused name falls back to the full text", async () => {
  const { statementConfig, refusePreparedStatement } = await import("../lib/facts/db.ts");
  const named = statementConfig(PLACE_PACKAGE_SQL, ["AZ"]);
  assert.match(named.name ?? "", /^meanwhile_[a-f0-9]{32}$/);
  assert.equal(named.text, PLACE_PACKAGE_SQL);
  assert.deepEqual(named.values, ["AZ"]);
  assert.deepEqual(statementConfig("SELECT 1", []), { text: "SELECT 1", values: [] });
  refusePreparedStatement({ code: "23505" });
  assert.ok(statementConfig(PLACE_PACKAGE_SQL, []).name, "an unrelated error keeps named statements");
  refusePreparedStatement({ code: "26000" });
  assert.deepEqual(statementConfig(PLACE_PACKAGE_SQL, []), { text: PLACE_PACKAGE_SQL, values: [] });
});
