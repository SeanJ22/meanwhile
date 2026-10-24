import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { visibleText } from "../lib/extract/visible-text.ts";
import { boundedIndexOf, checkFact, isOfficialUrl, type CheckEntity, type Claim, type SavedCopy } from "../lib/facts/check.ts";
import { factClocks, FRESHNESS_HOURS_DEFAULT } from "../lib/facts/clocks.ts";
import { decide } from "../lib/facts/decide.ts";
import { publishClaim, type PublishInput } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const page = (path: string) => readFileSync(join(FIXTURES, path), "utf8");
const NOW = new Date("2026-08-14T19:00:00Z");
const clocks = factClocks(null);
const window = clocks.windowHours;

const tucsonBoardPage = visibleText(page("clerksboards/b15.html"));
const tccc: CheckEntity = { id: "ocd-body/tucson-tccc", fullName: "Tucson Convention Center Commission", stateName: "Arizona",
  hosts: ["tucsonaz.gov"], externalIds: [] };
const boardCopy = (over: Partial<SavedCopy> = {}): SavedCopy => ({ id: 1, finalUrl: "https://clerksboards.tucsonaz.gov/boards/15",
  text: tucsonBoardPage, fetchedAt: new Date("2026-08-14T12:00:00Z"), isArchive: false, ...over });
const chair = (over: Partial<Claim> = {}): Claim => ({ entity: tccc, fieldKind: "officeholder", provenance: "OFFICIAL",
  valueText: "Ned Beman", quote: "Ned Beman Chairperson Ward 2", copy: boardCopy(), ...over });

test("a value quoted from the body's own saved .gov page passes", () => {
  assert.deepEqual(checkFact(chair(), NOW, window).ok, true);
});

test("the quote must be on the saved copy and hold the value", () => {
  assert.deepEqual(checkFact(chair({ quote: "Ned Beman Chairperson Ward 3" }), NOW, window), { ok: false, reason: "QUOTE_NOT_ON_SAVED_COPY" });
  assert.deepEqual(checkFact(chair({ valueText: "Jose Jimenez" }), NOW, window), { ok: false, reason: "VALUE_NOT_IN_QUOTE" });
  assert.equal(boundedIndexOf("$1,500", "500"), -1);
  assert.equal(boundedIndexOf("Ward 2", "2"), 5);
});

test("a page that is not about the entity fails unless it is a .gov page; a page naming it in its state passes, spelled out or abbreviated", () => {
  const vail: CheckEntity = { id: "ocd-body/vail", fullName: "Vail Unified School District", stateName: "Arizona", hosts: ["vailschooldistrict.org"], externalIds: [] };
  const elsewhere = boardCopy({ finalUrl: "https://example.com/boards/15" });
  assert.deepEqual(checkFact(chair({ entity: vail, copy: elsewhere }), NOW, window), { ok: false, reason: "PAGE_NOT_ABOUT_ENTITY" });
  assert.equal(checkFact(chair({ entity: vail }), NOW, window).ok, true, "any .gov page is official");
  const coolidge: CheckEntity = { id: "az:city:city-of-coolidge", fullName: "City Of Coolidge", stateName: "Arizona", hosts: [], externalIds: [] };
  const town = (text: string) => boardCopy({ finalUrl: "https://www.coolidgeaz.com/council", text });
  const claim = (text: string) => chair({ entity: coolidge, valueText: "(520) 723-5361", quote: "Call (520) 723-5361", copy: town(text) });
  assert.equal(checkFact(claim("Coolidge, AZ 85128. Call (520) 723-5361"), NOW, window).ok, true, "the town and its state's letters");
  assert.equal(checkFact(claim("Coolidge, Arizona 85128. Call (520) 723-5361"), NOW, window).ok, true);
  assert.deepEqual(checkFact(claim("Coolidge Pizza. Call (520) 723-5361"), NOW, window), { ok: false, reason: "PAGE_NOT_ABOUT_ENTITY" });
  const board: CheckEntity = { id: "ocd-division/country:us/state:az/place:duncan#governing", fullName: "Duncan town governing", stateName: "Arizona", hosts: [], externalIds: [] };
  assert.equal(checkFact(chair({ entity: board, valueText: "Ned Beman", copy: town("Duncan, AZ. Ned Beman Chairperson Ward 2") }), NOW, window).ok, true, "a body is named for its place");
  const eloy: CheckEntity = { id: "az:school:eloy-school-district-11", fullName: "Eloy School District 11", stateName: "Arizona", hosts: [], externalIds: [] };
  assert.equal(checkFact(chair({ entity: eloy, valueText: "Ned Beman", copy: town("Eloy, AZ. Ned Beman Chairperson Ward 2") }), NOW, window).ok, true);
  const news = boardCopy({ finalUrl: "https://news.example.com/tccc", text: `${tucsonBoardPage}\nTucson, Arizona 85701` });
  assert.equal(checkFact(chair({ copy: news, entity: { ...tccc, hosts: [] }, provenance: "NEWS" }), NOW, window).ok, true);
});

test("a copy older than its kind's window fails; an archive never proves a present fact", () => {
  const old = boardCopy({ fetchedAt: new Date(NOW.getTime() - (FRESHNESS_HOURS_DEFAULT.officeholder + 1) * 3_600_000) });
  assert.deepEqual(checkFact(chair({ copy: old }), NOW, window), { ok: false, reason: "COPY_OUTSIDE_FRESHNESS_WINDOW" });
  assert.deepEqual(checkFact(chair({ copy: boardCopy({ isArchive: true }) }), NOW, window), { ok: false, reason: "ARCHIVE_NEVER_PROVES_PRESENT" });
});

test("a second source only for judgment calls: unofficial portraits, a person matched across sources, and third parties on someone else", () => {
  const html = page("campaign-sites/duarte4mendham-meet-amalia.live.html");
  const duarte: CheckEntity = { id: "ocd-person/duarte", fullName: "Amalia Duarte", stateName: null, hosts: ["duarte4mendham.com"], externalIds: [] };
  const src = /src="(https:\/\/static\.wixstatic\.com\/media\/ca7840_[^"]+)"/.exec(html)![1]!;
  const copy: SavedCopy = { id: 2, finalUrl: "https://www.duarte4mendham.com/meet-amalia", text: `${visibleText(html)}\n${html}`,
    fetchedAt: new Date("2026-08-14T00:00:00Z"), isArchive: false };
  const portrait: Claim = { entity: duarte, fieldKind: "portrait", provenance: "CAMPAIGN", valueText: src, quote: src, copy };
  assert.equal(checkFact(portrait, NOW, window).ok, true, "a campaign's own portrait publishes alone");
  assert.deepEqual(checkFact({ ...portrait, provenance: "NEWS" }, NOW, window), { ok: false, reason: "SECOND_SOURCE_REQUIRED" });
  assert.deepEqual(checkFact({ ...chair(), fieldKind: "same_person_link" }, NOW, window), { ok: false, reason: "SECOND_SOURCE_REQUIRED" });
  assert.equal(checkFact({ ...chair(), provenance: "OTHER", second: { copy: boardCopy({ id: 3, finalUrl: "https://news.example.com/commission", text: `${tucsonBoardPage} Arizona` }), quote: "Ned Beman" } }, NOW, window).ok, true);
});

test("any .gov site is official", () => {
  assert.equal(isOfficialUrl("https://clerksboards.tucsonaz.gov/boards/15", []), true);
  assert.equal(isOfficialUrl("https://www.vailschooldistrict.org/board", ["vailschooldistrict.org"]), true);
  assert.equal(isOfficialUrl("https://news.example.com/vail", ["vailschooldistrict.org"]), false);
  assert.equal(isOfficialUrl("https://webapi.legistar.com/v1/pima/events?x=1", ["webapi.legistar.com/v1/pima"]), true);
  assert.equal(isOfficialUrl("https://webapi.legistar.com/v1/mesa/events", ["webapi.legistar.com/v1/pima"]), false);
  assert.equal(isOfficialUrl("https://webapi.legistar.com/v1/pimacounty/events", ["webapi.legistar.com/v1/pima"]), false);
});

test("newer and more official wins; Sean's value changes only through him", () => {
  const at = (iso: string) => new Date(iso);
  const official = { value: "A", provenance: "OFFICIAL" as const, fetchedAt: at("2026-01-01") };
  assert.equal(decide(null, official), "PUBLISH");
  assert.equal(decide(official, { ...official, fetchedAt: at("2026-02-01") }), "CONFIRM");
  assert.equal(decide(official, { value: "B", provenance: "NEWS", fetchedAt: at("2026-02-01") }), "KEEP_CURRENT");
  assert.equal(decide({ value: "B", provenance: "NEWS", fetchedAt: at("2026-02-01") }, official), "PUBLISH");
  assert.equal(decide(official, { value: "B", provenance: "OFFICIAL", fetchedAt: at("2026-02-01") }), "PUBLISH");
  assert.equal(decide(official, { value: "B", provenance: "OFFICIAL", fetchedAt: at("2025-12-01") }), "KEEP_CURRENT");
  const owner = { value: "S", provenance: "OWNER" as const, fetchedAt: at("2026-01-01") };
  assert.equal(decide(owner, { value: "B", provenance: "NEWS", fetchedAt: at("2026-03-01") }), "FLAG_OWNER");
  assert.equal(decide(owner, { value: "B", provenance: "OFFICIAL", fetchedAt: at("2026-03-01") }), "FLAG_OWNER");
  assert.equal(decide(official, { value: "S", provenance: "OWNER", fetchedAt: at("2026-03-01") }), "PUBLISH");
});

async function seeded() {
  const db = await factDb();
  await db.query("INSERT INTO entity (id, kind, name, state) VALUES ('ocd-division/country:us/state:az/place:tucson', 'place', 'Tucson', 'AZ')");
  await db.query("INSERT INTO entity (id, kind, name, state, parent_id) VALUES ($1, 'body', $2, 'AZ', 'ocd-division/country:us/state:az/place:tucson')", [tccc.id, tccc.fullName]);
  await db.query("INSERT INTO entity_place (entity_id, place_id) VALUES ($1, 'ocd-division/country:us/state:az/place:tucson')", [tccc.id]);
  for (const id of [1, 2, 3]) {
    await db.query(`INSERT INTO source_copy (id, url, final_url, fetched_at, http_status, sha256, blob_key)
      VALUES ($1, 'https://clerksboards.tucsonaz.gov/boards/15', 'https://clerksboards.tucsonaz.gov/boards/15', $2, 200, $3, $4)`,
    [id, `2026-08-1${id}T12:00:00Z`, "a".repeat(64), `project/freshness/source/clerksboards/${id}.html`]);
  }
  return db;
}
const claim = (over: Partial<PublishInput> = {}): PublishInput => ({ ...chair(), field: "seat:chair:holder", value: "Ned Beman",
  producedBy: "reader:clerksboards", costUsd: 0, ...over });

test("publishClaim writes one live fact alone, with its receipt, and queues its place", async () => {
  const db = await seeded();
  assert.deepEqual(await publishClaim(db, claim(), clocks, NOW), { decision: "PUBLISH", factId: 1 });
  const [fact] = await db.query("SELECT status, source_copy_id, quote, quote_start, live_at FROM fact");
  assert.equal(fact!.status, "live");
  assert.equal(Number(fact!.source_copy_id), 1);
  assert.equal(fact!.quote, "Ned Beman Chairperson Ward 2");
  assert.ok(fact!.live_at);
  const again = await publishClaim(db, claim({ copy: boardCopy({ id: 2, fetchedAt: new Date("2026-08-14T13:00:00Z") }) }), clocks, NOW);
  assert.deepEqual(again, { decision: "CONFIRM", factId: 1 });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM fact"))[0]!.n, 1);
});

test("a failing claim leaves a blank with its stage and reason; the next passing claim fills it", async () => {
  const db = await seeded();
  const news = claim({ provenance: "NEWS", copy: boardCopy({ finalUrl: "https://news.example.com/tccc" }), quote: "Ned Beman Chairperson Ward 9" });
  assert.deepEqual(await publishClaim(db, news, clocks, NOW), { blank: "QUOTE_NOT_ON_SAVED_COPY" });
  const [blank] = await db.query("SELECT stage, reason, detail, attempts FROM blank");
  assert.deepEqual({ ...blank,detail:undefined }, { stage:"CHECK",reason:"CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY",detail:undefined,attempts:1 });
  assert.deepEqual(JSON.parse(String(blank!.detail)),{sourceUrl:news.copy.finalUrl,copyId:1,fieldKind:"officeholder",provenance:"NEWS",value:"Ned Beman",valueText:"Ned Beman",quote:"Ned Beman Chairperson Ward 9",producedBy:"reader:clerksboards"});
  await publishClaim(db, claim(), clocks, NOW);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM blank"))[0]!.n, 0);
});

test("a losing value is kept with its reason; an official value Sean typed over comes back to him as a flag", async () => {
  const db = await seeded();
  await publishClaim(db, claim(), clocks, NOW);
  const news = boardCopy({ id: 3, finalUrl: "https://news.example.com/tccc", text: "Tucson Convention Center Commission Arizona chair Jose Jimenez",
    fetchedAt: new Date("2026-08-14T18:00:00Z") });
  const lost = await publishClaim(db, claim({ provenance: "NEWS", copy: news, valueText: "Jose Jimenez", value: "Jose Jimenez", quote: "chair Jose Jimenez" }), clocks, NOW);
  assert.equal("decision" in lost && lost.decision, "KEEP_CURRENT");
  assert.deepEqual(await db.query("SELECT value, status, held_reason FROM fact ORDER BY id"), [
    { value: "Ned Beman", status: "live", held_reason: null }, { value: "Jose Jimenez", status: "held", held_reason: "LOSES_TO_CURRENT" }]);
  assert.deepEqual(await publishClaim(db, claim(), clocks, NOW), { decision: "CONFIRM", factId: 1 });

  await db.query("UPDATE fact SET status = 'superseded' WHERE status = 'live'");
  await db.query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, quote, checked_at, live_at, produced_by)
    VALUES ($1, 'seat:chair:holder', '"Sean Value"', 'Sean Value', 'live', 'OWNER', '', $2, $2, 'owner')`, [tccc.id, NOW.toISOString()]);
  const flagged = await publishClaim(db, claim({ copy: boardCopy({ id: 2 }) }), clocks, NOW);
  assert.equal("decision" in flagged && flagged.decision, "FLAG_OWNER");
  assert.equal((await db.query("SELECT value FROM fact WHERE status = 'live'"))[0]!.value, "Sean Value");
  assert.deepEqual((await db.query("SELECT kind, resolved FROM owner_flag")), [{ kind: "OWNER_VALUE_CONTESTED", resolved: null }]);
});
