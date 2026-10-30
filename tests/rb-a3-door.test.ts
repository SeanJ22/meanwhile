import assert from "node:assert/strict";
import test from "node:test";
import { door, decide } from "../lib/core/door.ts";
import { resolveId } from "../lib/core/resolve.ts";
import { publishClaim, restampFacts, type PublishInput } from "../lib/facts/publish.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { factDb } from "./helpers/fact-db.ts";
import { readFactStore } from "../lib/facts/admin-read.ts";
import { readCounts } from "../lib/control-plane/line-keeper/read.ts";
import { countWindow } from "../lib/counts/hour.ts";
import { readBodyFacts } from "../lib/facts/registry-overlay.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import { districtCardSources } from "../lib/officials/card-sources.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";

const now = new Date("2026-10-24T08:00:00Z");
const clocks = factClocks(null);
const purge = async () => ({ purged: true });
/** Every claim is checked: its saved copy shows the value on a line of its own, unless the test gives its own text. */
const DEFAULT_TEXT = "Example City Council Arizona\noffice_phone: 520-555-0100\n";
const input = (over: Partial<PublishInput> = {}): PublishInput => {
  const claim: PublishInput = {
    entity: { id: "az:city:example#governing", fullName: "Example City Council", stateName: "Arizona", hosts: [], externalIds: [] },
    field: "office_phone", fieldKind: "contact", value: "520-555-0100", valueText: "520-555-0100",
    quote: "", provenance: "OFFICIAL", producedBy: "rb-a9", costUsd: 0,
    copy: { id: 1, finalUrl: "https://example.gov/council", text: "", fetchedAt: now, isArchive: false }, ...over,
  };
  const quote = claim.quote || String(claim.valueText);
  const own = claim.copy.text && claim.copy.text !== DEFAULT_TEXT;
  return { ...claim, quote, copy: { ...claim.copy, text: own ? claim.copy.text : `${claim.entity.fullName} ${claim.entity.stateName}\n${claim.field}: ${quote}\n` } };
};

async function seeded(withHourlyCounts = false) {
  const db = await factDb({ withHourlyCounts });
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Example City Council','AZ')", [input().entity.id]);
  await db.query(`INSERT INTO entity(id,kind,name,state) VALUES('place-one','place','First district','AZ'),('place-two','place','Second district','AZ')`);
  await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,'place-one'),($1,'place-two')", [input().entity.id]);
  await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key)
    VALUES(1,'https://example.gov/council','https://example.gov/council',$1,$2,'first'),
    (2,'https://news.example/council','https://news.example/council',$1,$2,'second')`, [now.toISOString(), "a".repeat(64)]);
  return db;
}

test("a newer source for an unchanged value rebuilds its pages and an exact replay queues nothing", async () => {
  const db = await seeded();
  try {
    await door(db, input(), clocks, now, { purge });
    await db.query("DELETE FROM rebuild_queue");
    const next = new Date(now.getTime() + 3_600_000);
    await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key)
      VALUES(3,'https://example.gov/council','https://example.gov/council',$1,$2,'confirmation')`, [next.toISOString(), "b".repeat(64)]);
    const claim = input({ copy: { ...input().copy, id: 3, fetchedAt: next } });
    assert.equal((await door(db, claim, clocks, next, { purge }) as { decision: string }).decision, "CONFIRM");
    assert.deepEqual((await db.query("SELECT place_id FROM rebuild_queue ORDER BY place_id")).map(row => row.place_id), [input().entity.id, "place-one", "place-two"]);
    assert.equal(Number((await db.query("SELECT source_copy_id FROM checked_fact WHERE status='live'"))[0]!.source_copy_id), 3);
    await db.query("DELETE FROM rebuild_queue");
    await door(db, claim, clocks, next, { purge });
    assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue"), []);
  } finally { await db.pg.close(); }
});

test("scheduled source restamps queue the body and served places without queuing an unchanged repeat", async () => {
  const db = await seeded();
  try {
    const result = await door(db, input(), clocks, now, { purge });
    assert.ok("factId" in result && result.factId !== null);
    await db.query("DELETE FROM rebuild_queue");
    const next = new Date(now.getTime() + 3_600_000);
    const facts = [{ id: result.factId, entityId: input().entity.id, field: "office_phone", quote: "520-555-0100" }];
    const copy = { id: 1, text: "Call 520-555-0100", fetchedAt: next };
    assert.equal(await restampFacts(db, facts, copy), 1);
    assert.deepEqual((await db.query("SELECT place_id FROM rebuild_queue ORDER BY place_id")).map(row => row.place_id), [input().entity.id, "place-one", "place-two"]);
    await db.query("DELETE FROM rebuild_queue");
    assert.equal(await restampFacts(db, facts, copy), 0);
    assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue"), []);
  } finally { await db.pg.close(); }
});

test("both lanes reach the existing place card with their own saved field sources", async () => {
  const db = await seeded();
  try {
    await door(db, input({ field: "name", fieldKind: "officeholder", value: "Example City Council", valueText: "Example City Council" }), clocks, now, { purge });
    const address = "20 Main Street";
    await door(db, input({ field: "office_address", value: address, valueText: address, quote: address, provenance: "NEWS", acquisition: "hunter",
      copy: { ...input().copy, id: 2, finalUrl: "https://news.example/council", text: `Example City Council Arizona ${address}` } }), clocks, now, { purge });
    const provenance = { sourceUrl: null, sourceOrg: "Census", collectedAt: now.toISOString(), verifiedAt: null };
    const runtime: RegistryRuntimeReadModel = { formatVersion: 1,
      registry: { generatedAt: now.toISOString(), bodies: [{ id: input().entity.id, ocdId: "place-one", name: null, bodyClass: "GOVERNING",
        bodyOrigin: "DERIVED_FROM_DIVISION_TYPE", coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE", agendaSourceRef: null,
        meetingCadence: null, homepageUrl: null, demandCount: 0, sourceDataset: "DERIVED", provenance }],
      divisions: [{ ocdId: "place-one", label: "Example", divisionType: "place", tier: "local", state: "AZ", parentOcdId: null,
        lsad: null, funcstat: null, classfp: null, geoid: null, canonicalOcdId: null, canonicalMatch: "none", sourceDataset: "TIGER_CB2023", provenance }] },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } };
    const facts = await readBodyFacts(db.query, [input().entity.id], true);
    const card = stateCoverage({ state: "AZ", registry: runtime, version: "test" }, ["place-one"], 0, 0, [], facts).bodies[0]!;
    assert.equal(card.name, "City of Example City Council");
    assert.equal(card.officeContact?.address, address);
    const sources = districtCardSources([], [], card.officeContact?.provenance, card.fieldSources);
    assert.deepEqual(sources.filter(source => source.what === "This government's name and the area it serves" || source.what === "Where to find the office").map(source => [source.what, source.provenance.sourceUrl]),
      [["This government's name and the area it serves", "https://example.gov/council"], ["Where to find the office", "https://news.example/council"]]);
  } finally { await db.pg.close(); }
});

test("an existing canonical id resolves before the new identity SQL is installed", async () => {
  const db = await factDb({ withResolver: false });
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES('held-person','person','Held person','AL')");
    assert.deepEqual(await db.query("SELECT to_regprocedure('reader_resolve_id(text)') resolver"), [{ resolver: null }]);
    assert.equal(await resolveId("held-person", db.query), "held-person");
  } finally { await db.pg.close(); }
});

test("an existing canonical id wins over another source's alias without merging people", async () => {
  const db = await seeded();
  try {
    await db.pg.exec(`INSERT INTO entity(id,kind,name,state) VALUES('ocd-person/one','person','First person','AL'),
      ('ocd-person/two','person','Second person','AL');
      INSERT INTO entity_external_id(entity_id,scheme,value) VALUES('ocd-person/two','campaign-person:AL','ocd-person/one')`);
    for (const id of ["ocd-person/one", "ocd-person/two"]) {
      const { entity: _entity, ...claim } = input();
      assert.equal((await door(db, { ...claim, subjectId: id }, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    }
    assert.deepEqual((await db.query("SELECT entity_id FROM fact ORDER BY entity_id")).map(row => row.entity_id), ["ocd-person/one", "ocd-person/two"]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM entity WHERE kind='person'"))[0]!.n, 2);
  } finally { await db.pg.close(); }
});

test("an official field publishes checked on its saved line, and an exact repeat changes nothing", async () => {
  const db = await seeded(true);
  try {
    const claim = input();
    assert.deepEqual(await door(db, claim, clocks, now, { purge }), { decision: "PUBLISH", factId: 1 });
    const snapshot = () => db.query(`SELECT jsonb_build_object('facts',(SELECT jsonb_agg(f) FROM fact f),
      'watermarks',(SELECT jsonb_agg(w) FROM fact_watermark w),'sources',(SELECT jsonb_agg(s) FROM source_copy s),
      'blanks',(SELECT jsonb_agg(b) FROM blank b),'flags',(SELECT jsonb_agg(o) FROM owner_flag o),
      'queues',(SELECT jsonb_agg(q) FROM rebuild_queue q),'counts',(SELECT jsonb_agg(c) FROM count_hour c)) AS value`);
    const before = await snapshot();
    assert.deepEqual(await door(db, claim, clocks, new Date(now.getTime() + 3_600_000), { purge }), { decision: "CONFIRM", factId: 1 });
    assert.deepEqual(await snapshot(), before);
    assert.notEqual((await db.query("SELECT quote_start FROM fact"))[0]!.quote_start, null, "the quote was found on the saved copy");
    assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue ORDER BY place_id"), [{ place_id: input().entity.id }, { place_id: "place-one" }, { place_id: "place-two" }]);
    assert.deepEqual(await db.query(`SELECT state,sum(n)::int AS n FROM count_hour
      WHERE left(step,3)='v1:' AND substring(step FROM 4)::jsonb->>1='fact:live'
        AND substring(step FROM 4)::jsonb->>2='in' GROUP BY state`), [{ state: "AZ", n: 1 }]);
  } finally { await db.pg.close(); }
});

test("a portal linked by a registered government site is official", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'government.example.org')", [input().entity.id]);
    const claim = input({ copy: { ...input().copy, finalUrl: "https://portal.example/meetings/1" } });
    const outcome = await door(db, { ...claim, linkingPage: { url: "https://government.example.org/meetings",
      html: '<a href="https://portal.example/meetings">Public meetings</a>' } }, clocks, now, { purge });
    assert.equal("decision" in outcome && outcome.decision, "PUBLISH");
    assert.deepEqual(await db.query("SELECT provenance_kind FROM fact"), [{ provenance_kind: "OFFICIAL" }]);
  } finally { await db.pg.close(); }
});

test("a government's CivicClerk embed delegates only its named tenant", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'government.example.org')", [input().entity.id]);
    const linkingPage = { url: "https://government.example.org/meetings", html: '<script>window.clerkEmbedProps = {"tenant":"example"};</script><script src="https://civicclerkcdn.azureedge.net/publicportal-live/embed.js"></script>' };
    const claim = input({ copy: { ...input().copy, finalUrl: "https://example.portal.civicclerk.com/event/1" } });
    const outcome = await door(db, { ...claim, linkingPage }, clocks, now, { purge });
    assert.equal("decision" in outcome && outcome.decision, "PUBLISH");
    await door(db, { ...input({ field: "office_email", provenance: "OTHER", copy: { ...input().copy, finalUrl: "https://other.portal.civicclerk.com/event/1" } }), linkingPage }, clocks, now, { purge });
    assert.deepEqual(await db.query("SELECT field,provenance_kind FROM fact ORDER BY field"), [{ field: "office_email", provenance_kind: "OTHER" }, { field: "office_phone", provenance_kind: "OFFICIAL" }]);
  } finally { await db.pg.close(); }
});

test("a registered government API and its portal keep the same CivicClerk tenant", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'example.api.civicclerk.com/v1')", [input().entity.id]);
    const outcome = await door(db, input({ copy: { ...input().copy, finalUrl: "https://example.portal.civicclerk.com/event/1" } }), clocks, now, { purge });
    assert.equal("decision" in outcome && outcome.decision, "PUBLISH");
    await door(db, input({ field: "office_email", provenance: "OTHER", copy: { ...input().copy, finalUrl: "https://other.portal.civicclerk.com/event/1" } }), clocks, now, { purge });
    assert.deepEqual(await db.query("SELECT field,provenance_kind FROM fact ORDER BY field"), [{ field: "office_email", provenance_kind: "OTHER" }, { field: "office_phone", provenance_kind: "OFFICIAL" }]);
  } finally { await db.pg.close(); }
});

test("a registered Legistar API keeps its tenant's portal and document delivery host official", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'webapi.legistar.com/v1/example')", [input().entity.id]);
    for (const [index, url] of ["https://example.legistar.com/MeetingDetail.aspx?ID=1", "https://example.legistar1.com/example/meetings/2026/agenda.pdf", "https://legistar2.granicus.com/example/meetings/2026/agenda.pdf"].entries()) {
      const result = await door(db, input({ field: `document_${index}`, copy: { ...input().copy, finalUrl: url } }), clocks, now, { purge });
      assert.equal("decision" in result && result.decision, "PUBLISH");
    }
    await door(db, input({ field: "wrong_tenant", provenance: "OTHER", copy: { ...input().copy, finalUrl: "https://other.legistar1.com/other/agenda.pdf" } }), clocks, now, { purge });
    await door(db, input({ field: "wrong_granicus_tenant", provenance: "OTHER", copy: { ...input().copy, finalUrl: "https://legistar2.granicus.com/other/meetings/2026/agenda.pdf" } }), clocks, now, { purge });
    assert.deepEqual(await db.query("SELECT field,provenance_kind FROM fact WHERE field LIKE 'wrong%' ORDER BY field"),
      [{ field: "wrong_granicus_tenant", provenance_kind: "OTHER" }, { field: "wrong_tenant", provenance_kind: "OTHER" }]);
  } finally { await db.pg.close(); }
});

test("a registered government site keeps its www spelling official", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'www.example.org')", [input().entity.id]);
    const result = await door(db, input({ copy: { ...input().copy, finalUrl: "https://www.example.org/council" } }), clocks, now, { purge });
    assert.equal("decision" in result && result.decision, "PUBLISH");
  } finally { await db.pg.close(); }
});

test("a checked sidebar preserves the agenda while an official API field publishes its document directly", async () => {
  const db = await seeded();
  try {
    const current = "https://example.gov/council/agenda";
    const later = new Date(now.getTime() + 60_000), latest = new Date(now.getTime() + 120_000);
    const api = "https://webapi.legistar.com/v1/example/Events/10";
    await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES
      (3,'https://example.gov/council','https://example.gov/council',$1,$2,'sidebar'),(4,$3,$3,$4,$5,'api')`,
    [later.toISOString(), "c".repeat(64), api, latest.toISOString(), "d".repeat(64)]);
    await door(db, input({ field: "agenda_url", fieldKind: "agenda", value: current, valueText: current }), clocks, now, { purge });
    const video = "https://www.youtube.com/@ExampleCouncil";
    const checked = await door(db, input({ field: "agenda_url", fieldKind: "agenda", value: video, valueText: video, quote: video, acquisition: "walker",
      copy: { id: 3, finalUrl: "https://example.gov/council", fetchedAt: later, text: `Example City Council Arizona ${video}`, isArchive: false } }), clocks, later, { purge });
    assert.equal("decision" in checked && checked.decision, "KEEP_CURRENT");
    const document = "https://documents.example/files/session-2026.pdf";
    const published = await door(db, input({ field: "agenda_url", fieldKind: "agenda", value: document, valueText: document,
      copy: { id: 4, finalUrl: api, fetchedAt: latest, text: `Example City Council Arizona\nagenda_url: ${document}\n`, isArchive: false } }), clocks, latest, { purge });
    assert.equal("decision" in published && published.decision, "PUBLISH");
    assert.deepEqual(await db.query("SELECT value FROM fact WHERE field='agenda_url' AND status='live'"), [{ value: document }]);
  } finally { await db.pg.close(); }
});

test("a newer official value replaces OTHER and a repeat of a losing fact creates no second row", async () => {
  const db = await seeded();
  try {
    const other = input({ provenance: "OTHER", copy: { ...input().copy, id: 2, finalUrl: "https://news.example/council",
      text: "Example City Council Arizona Call 520-555-0199", fetchedAt: new Date(now.getTime() - 3_600_000) },
    value: "520-555-0199", valueText: "520-555-0199", quote: "Call 520-555-0199" });
    assert.equal((await door(db, other, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    assert.equal((await door(db, input(), clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    await door(db, other, clocks, now, { purge });
    const before = await db.query("SELECT * FROM fact ORDER BY id");
    await door(db, other, clocks, now, { purge });
    assert.deepEqual(await db.query("SELECT * FROM fact ORDER BY id"), before);
    assert.equal((await db.query("SELECT value FROM fact WHERE status='live'"))[0]!.value, input().value);
  } finally { await db.pg.close(); }
});

test("Open States and Legistar API fields, and a portal linked by government, are checked like any other official source", async () => {
  const db = await seeded();
  try {
    for (const url of ["https://v3.openstates.org/people/123", "https://webapi.legistar.com/v1/pima/Bodies", "https://api.legiscan.com/?op=getBill"]) {
      const claim = input({ field: url, provenance: "REFERENCE", copy: { ...input().copy, finalUrl: url } });
      assert.equal((await door(db, claim, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    }
    const outcome = await door(db, { ...input({ field: "portal_phone", value: "520-555-0123", valueText: "520-555-0123", copy: { ...input().copy, finalUrl: "https://portal.example/council" } }),
      linkingPage: { url: "https://example.gov/", html: '<a href="https://portal.example/council">Council</a>' } }, clocks, now, { purge });
    assert.equal((outcome as { decision: string }).decision, "PUBLISH");
    assert.equal((await db.query("SELECT value FROM fact WHERE field='portal_phone'"))[0]!.value, "520-555-0123");
  } finally { await db.pg.close(); }
});

test("a campaign or advocacy site cannot publish a fact about someone else, and refusal is recorded once", async () => {
  const db = await seeded();
  try {
    const claim = input({ provenance: "CAMPAIGN", sourceSubjectId: "another-person", quote: "Call 520-555-0100",
      copy: { ...input().copy, id: 2, finalUrl: "https://campaign.example/", text: "Example City Council Arizona Call 520-555-0100" } });
    assert.deepEqual(await door(db, claim, clocks, now), { refused: "CAMPAIGN_OTHER_SUBJECT" });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact"))[0]!.n, 0);
    assert.deepEqual(await publishClaim(db, claim, clocks, now), { blank: "CAMPAIGN_OTHER_SUBJECT" });
    assert.equal((await db.query("SELECT attempts FROM blank"))[0]!.attempts, 1);
  } finally { await db.pg.close(); }
});

test("a government directory link preserves a campaign site's scope and source rank", async () => {
  const db = await seeded();
  try {
    const claim = { ...input({ provenance: "CAMPAIGN", sourceSubjectId: "another-person", quote: "Call 520-555-0100",
      copy: { ...input().copy, id: 2, finalUrl: "https://campaign.example/", text: "Example City Council Arizona Call 520-555-0100" } }),
      linkingPage: { url: "https://example.gov/candidates", html: '<a href="https://campaign.example/">Campaign website</a>' } };
    assert.deepEqual(await door(db, claim, clocks, now, { purge }), { refused: "CAMPAIGN_OTHER_SUBJECT" });
    assert.equal("decision" in await door(db, { ...claim, sourceSubjectId: claim.entity.id }, clocks, now, { purge }), true);
    assert.deepEqual(await db.query("SELECT provenance_kind,quote_start FROM fact"), [{ provenance_kind: "CAMPAIGN", quote_start: 29 }]);
  } finally { await db.pg.close(); }
});

test("nonofficial claims use clocks.ts; a failed quote leaves the old caller its blank", async () => {
  const db = await seeded();
  try {
    const claim = input({ provenance: "NEWS", quote: "Call 520-555-0100", fieldKind: "meeting",
      copy: { ...input().copy, id: 2, finalUrl: "https://news.example/", text: "Example City Council Arizona Call 520-555-0100",
        fetchedAt: new Date(now.getTime() - 48 * 3_600_000) } });
    assert.equal((await door(db, claim, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    assert.deepEqual(await publishClaim(db, { ...claim, quote: "invented words" }, clocks, now), { blank: "QUOTE_NOT_ON_SAVED_COPY" });
  } finally { await db.pg.close(); }
});

test("a hunter's claim is checked against its saved copy even when it cites a government page", async () => {
  const db = await seeded();
  try {
    const claim = input({ acquisition: "hunter", quote: "invented words", copy: { ...input().copy, text: "Example City Council Arizona unrelated words" } });
    assert.deepEqual(await door(db, claim, clocks, now), { refused: "QUOTE_NOT_ON_SAVED_COPY" });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact"))[0]!.n, 0);
  } finally { await db.pg.close(); }
});

test("an unchanged saved fact replays after its freshness window without refreshing it or opening a blank", async () => {
  const db = await seeded();
  try {
    const claim = input({ provenance: "NEWS", quote: "Call 520-555-0100", copy: { ...input().copy, id: 2,
      finalUrl: "https://news.example/", text: "Example City Council Arizona Call 520-555-0100" } });
    await door(db, claim, clocks, now, { purge });
    const before = await db.query("SELECT * FROM fact");
    assert.deepEqual(await door(db, claim, clocks, new Date(now.getTime() + 900 * 3_600_000), { purge }), { decision: "CONFIRM", factId: 1 });
    assert.deepEqual(await db.query("SELECT * FROM fact"), before);
    assert.deepEqual(await db.query("SELECT * FROM blank"), []);
  } finally { await db.pg.close(); }
});

test("a real later observation of the same source bytes advances its checked date once and adds no delivery", async () => {
  const db = await seeded(true);
  try {
    await door(db, input(), clocks, now, { purge });
    const next = new Date(now.getTime() + 3_600_000);
    const claim = input({ copy: { ...input().copy, fetchedAt: next } });
    await door(db, claim, clocks, next, { purge });
    const before = await db.query("SELECT id,value,checked_at,source_copy_id FROM checked_fact");
    assert.equal(new Date(before[0]!.checked_at as string).toISOString(), next.toISOString());
    await door(db, claim, clocks, new Date(next.getTime() + 3_600_000), { purge });
    assert.deepEqual(await db.query("SELECT id,value,checked_at,source_copy_id FROM checked_fact"), before);
    assert.deepEqual(await db.query(`SELECT sum(n)::int AS n FROM count_hour
      WHERE left(step,3)='v1:' AND substring(step FROM 4)::jsonb->>1='fact:live'
        AND substring(step FROM 4)::jsonb->>2='in'`), [{ n: 1 }]);
  } finally { await db.pg.close(); }
});

test("one call creates the board a government names and publishes its fact under that board", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('az:city:example','government','Example City','AZ','place-one')");
    const { entity: _entity, ...claim } = input();
    const outcome = await door(db, { ...claim, subjectId: "unheld-board",
      board: { governmentId: "az:city:example", name: "Planning Commission" } }, clocks, now, { purge });
    assert.equal((outcome as { decision: string }).decision, "PUBLISH");
    const [board] = await db.query("SELECT e.kind,e.name,e.parent_id FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.id=$1", [(outcome as { factId: number }).factId]);
    assert.deepEqual(board, { kind: "body", name: "Planning Commission", parent_id: "az:city:example" });
    assert.equal((await db.query("SELECT reader_resolve_id('unheld-board')=(SELECT entity_id FROM fact WHERE id=$1) AS same", [(outcome as { factId: number }).factId]))[0]!.same, true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM entity WHERE name='Planning Commission'"))[0]!.n, 1);
    await door(db, { ...claim, subjectId: "unheld-board", board: { governmentId: "az:city:example", name: "Planning Commission" } }, clocks, now, { purge });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact"))[0]!.n, 1);
  } finally { await db.pg.close(); }
});

test("board-creation metadata cannot redirect an already resolved subject", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('az:city:example','government','Example City','AZ','place-one')");
    const outcome = await door(db, { ...input(), board: { governmentId: "az:city:example", name: "Planning Commission" } }, clocks, now, { purge });
    assert.equal((outcome as { decision: string }).decision, "PUBLISH");
    assert.deepEqual(await db.query("SELECT entity_id FROM fact"), [{ entity_id: input().entity.id }]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM entity WHERE name='Planning Commission'"))[0]!.n, 0);
  } finally { await db.pg.close(); }
});

test("an API and a government-linked portal can name an unheld board through the same official lane", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('az:city:example','government','Example City','AZ','place-one')");
    for (const [index, url] of ["https://webapi.legistar.com/v1/example/Bodies", "https://portal.example/council"].entries()) {
      const source = index + 3;
      await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES($1,$2,$2,$3,$4,$2)",
        [source, url, now.toISOString(), "c".repeat(64)]);
      const { entity: _entity, ...claim } = input();
      const name = index === 0 ? "API Planning Commission" : "Portal Planning Commission";
      const outcome = await door(db, { ...claim, subjectId: `unheld-${index}`, copy: { ...claim.copy, id: source, finalUrl: url, text: `${name} of Example City, Arizona\noffice_phone: 520-555-0100\n` },
        board: { governmentId: "az:city:example", name },
        ...(index === 1 ? { linkingPage: { url: "https://example.gov/", html: '<a href="https://portal.example/council">Council</a>' } } : {}) }, clocks, now, { purge });
      assert.equal((outcome as { decision: string }).decision, "PUBLISH");
      assert.equal((await db.query("SELECT e.name FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.id=$1", [(outcome as { factId: number }).factId]))[0]!.name, name);
    }
  } finally { await db.pg.close(); }
});

test("the door resolves a native id through RB-A1 without changing any saved id", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'legistar-body','BodyId:123')", [input().entity.id]);
    const { entity: _entity, ...claim } = input();
    assert.equal((await door(db, { ...claim, subjectId: "BodyId:123" }, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    assert.equal((await db.query("SELECT entity_id FROM fact"))[0]!.entity_id, input().entity.id);
    assert.deepEqual(await db.query("SELECT entity_id,value FROM entity_external_id"), [{ entity_id: input().entity.id, value: "BodyId:123" }]);
  } finally { await db.pg.close(); }
});

test("a held official source with an older source label replays unchanged and still outranks a later news claim", async () => {
  const db = await seeded();
  try {
    await door(db, input(), clocks, now, { purge });
    await db.query("UPDATE fact SET provenance_kind='REFERENCE'");
    const before = await db.query("SELECT * FROM fact");
    await door(db, input({ provenance: "REFERENCE" }), clocks, now, { purge });
    assert.deepEqual(await db.query("SELECT * FROM fact"), before);
    const claim = input({ provenance: "NEWS", value: "520-555-0199", valueText: "520-555-0199", quote: "Call 520-555-0199",
      copy: { ...input().copy, id: 2, finalUrl: "https://news.example/council", text: "Example City Council Arizona Call 520-555-0199" } });
    assert.equal((await door(db, claim, clocks, now, { purge }) as { decision: string }).decision, "KEEP_CURRENT");
  } finally { await db.pg.close(); }
});

test("all source ranks are respected, newest wins within a rank, and every conflicting system value flags the owner", () => {
  const side = (provenance: PublishInput["provenance"], value: string, time = now) => ({ provenance, value, fetchedAt: time });
  const ranks = ["OFFICIAL", "REFERENCE", "NEWS", "CAMPAIGN", "OTHER"] as const;
  for (let i = 0; i < ranks.length - 1; i++) {
    assert.equal(decide(side(ranks[i + 1]!, "old"), side(ranks[i]!, "new")), "PUBLISH");
    assert.equal(decide(side(ranks[i]!, "old"), side(ranks[i + 1]!, "new", new Date(now.getTime() + 1))), "KEEP_CURRENT");
  }
  assert.equal(decide(side("FILING", "old"), side("OFFICIAL", "new", new Date(now.getTime() + 1))), "PUBLISH");
  assert.equal(decide(side("NEWS", "old"), side("NEWS", "new", new Date(now.getTime() + 1))), "PUBLISH");
  for (const rank of ranks) assert.equal(decide(side("OWNER", "typed"), side(rank, "system")), "FLAG_OWNER");
});

test("new and compatibility writers share one hourly count through a replacement and exact repeat", async () => {
  const db = await seeded(true);
  try {
    await door(db, input(), clocks, now, { purge });
    const checked = input({ field: "meeting_cadence", fieldKind: "meeting", provenance: "NEWS", quote: "Every Tuesday",
      value: "Every Tuesday", valueText: "Every Tuesday", copy: { ...input().copy, id: 2, finalUrl: "https://news.example/council",
        text: "Example City Council Arizona meets Every Tuesday" } });
    await publishClaim(db, checked, clocks, now, { purge });
    const next = new Date(now.getTime() + 3_600_000);
    await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key)
      VALUES(3,'https://example.gov/council','https://example.gov/council',$1,$2,'next-hour')`, [next.toISOString(), "b".repeat(64)]);
    const claim = input({ value: "520-555-0123", valueText: "520-555-0123", copy: { ...input().copy, id: 3, fetchedAt: next } });
    assert.equal((await door(db, claim, clocks, next, { purge }) as { decision: string }).decision, "PUBLISH");
    assert.equal((await db.query("SELECT value FROM fact WHERE field='office_phone' AND status='live'"))[0]!.value, claim.value);
    const reading = await readFactStore(async statements => {
      const rows = [];
      for (const statement of statements) rows.push(await db.query(statement.text, statement.params));
      return rows;
    });
    assert.deepEqual(reading.blanks, []);
    const window=countWindow(new Date(Date.now()+3_600_000).toISOString());
    const counts=await readCounts({query:db.query},window.from,window.through);
    const live=counts.find(row=>row.state==='AZ'&&row.stage==='fact:live')!;
    assert.equal(live.total,2);
    assert.equal(live.observedIn,3,'each new or replacement fact counts once, independent of its caller');
    assert.equal(live.observedOut,1,'the superseded fact leaves live stock once');
    assert.deepEqual(await db.query("SELECT step FROM count_hour WHERE left(step,3)<>'v1:' AND step<>'counter start'"),[]);
    const before=await db.query('SELECT * FROM count_hour ORDER BY state,hour,step');
    assert.equal((await door(db,claim,clocks,next,{purge}) as {decision:string}).decision,'CONFIRM');
    assert.deepEqual(await db.query('SELECT * FROM count_hour ORDER BY state,hour,step'),before);
  } finally { await db.pg.close(); }
});
