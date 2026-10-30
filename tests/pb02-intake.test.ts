import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { indexReportedFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { BOX_DUE_SQL, BOX_LINKS_SQL, BOX_MOVED_SQL } from "../lib/control-plane/repository/pg-store.ts";
import { FINDING_SLOT_VERSIONS, SITE_WALK_LEAD } from "../lib/facts/finding-slots.ts";
import { LEAD_DDL, WORK_DDL, workList } from "../lib/core/work.ts";
import { moveBoxLinks } from "../lib/sources/box-links.ts";

test("document, meeting and government links never enter due, including tomorrow and after another class changes", async t => {
  const repos = createMemoryRepositories(), pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec("CREATE TABLE cp_box_findings(id text PRIMARY KEY, value jsonb)");
  const now = "2026-10-23T08:00:00.000Z", tomorrow = "2026-10-24T08:00:00.000Z";
  for (const [index, field] of ["DOC-02", "MTG-01", "GOV-03"].entries()) {
    const finding = { subjectId: "al:city:city-of-dadeville#governing", field, value: "https://example.gov/agendas", exactQuote: "Agendas",
      sourceUrl: "https://example.gov/", artifactIds: [], subjectHint: null, index };
    const input = { workItemId: "hunt", attemptId: "today", missionPart: null, finding };
    const row = await indexReportedFinding(repos.boxFindings, input, now);
    assert.equal(row.waitingFor?.reason, SITE_WALK_LEAD);
    // A legacy never-tried row already exists when the same hunt result is read again.
    const stored = await repos.boxFindings.mustRead(row.id);
    await repos.boxFindings.compareAndSet(row.id, stored.revision, { ...row, waitingFor: undefined }, now);
    await indexReportedFinding(repos.boxFindings, input, now);
    await indexReportedFinding(repos.boxFindings, { ...input, attemptId: "tomorrow" }, tomorrow);
    const held = (await repos.boxFindings.mustRead(row.id)).value;
    assert.equal(held.waitingFor?.reason, SITE_WALK_LEAD);
    await pg.query("INSERT INTO cp_box_findings VALUES ($1, $2)", [held.id, held]);
  }
  for (const slots of [FINDING_SLOT_VERSIONS, { ...FINDING_SLOT_VERSIONS, rosters: FINDING_SLOT_VERSIONS.rosters! + 1 }]) {
    assert.deepEqual(await repos.boxFindings.due({ slots, now: tomorrow, limit: 1000 }), []);
    assert.deepEqual((await pg.query(BOX_DUE_SQL, [JSON.stringify(slots), tomorrow, 1000])).rows, []);
  }
  for (const ddl of [...WORK_DDL, ...LEAD_DDL]) await pg.exec(ddl);
  const list = workList(async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows, { owner: "mover", now: () => new Date(tomorrow) });
  assert.equal(await moveBoxLinks({ box: repos.boxFindings, list, now: () => new Date(tomorrow) }), 3, "the three links leave the Box");
  assert.deepEqual((await pg.query("SELECT kind, url, state, subject_id FROM work")).rows, [{ kind: "lead", url: "https://example.gov/agendas", state: "AL", subject_id: "al:city:city-of-dadeville#governing" }],
    "and are one link to read");
  assert.equal(await moveBoxLinks({ box: repos.boxFindings, list, now: () => new Date(tomorrow) }), 0, "nothing moves twice");
  assert.deepEqual(await repos.boxFindings.due({ slots: FINDING_SLOT_VERSIONS, now: tomorrow, limit: 1000 }), []);
});

test("retired source hashes do not requeue unchanged classes on deployment; old seat refusals do retry", async t => {
  const repos = createMemoryRepositories(), pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec("CREATE TABLE cp_box_findings(id text PRIMARY KEY, value jsonb)");
  const now = "2026-10-23T08:00:00.000Z";
  for (const [id, kind, refusal] of [["document", "site walk", null], ["seat", "other", "SEAT_NOT_IN_QUOTE"]] as const) {
    const row = { id, subjectId: "al:city:city-of-dadeville#governing", state: refusal ? "refused" : "waiting", refusal,
      waitingFor: { class: kind, slots: "416c9cc838906e94", reason: refusal ?? SITE_WALK_LEAD }, attempts: [{ builder: "fact-publisher" }] };
    await pg.query("INSERT INTO cp_box_findings VALUES ($1,$2)", [id,row]);
    await repos.boxFindings.put(id, row as never, now);
  }
  assert.deepEqual((await repos.boxFindings.due({ slots: FINDING_SLOT_VERSIONS, now, limit: 1000 })).map(row => row.id), ["seat"]);
  assert.deepEqual((await pg.query<{ id: string }>(BOX_DUE_SQL, [JSON.stringify(FINDING_SLOT_VERSIONS),now,1000])).rows.map(row => row.id), ["seat"]);
});

test("the database moves waiting links out of the Box in small rows and one statement", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec("CREATE TABLE cp_box_findings(id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL)");
  const row = (id: string, reason: string | null, state = "waiting") => ({ id, state, subjectId: "fl:county:county-of-hernando#governing", sourceUrl: "http://www.hernandocounty.us/", lastRecordedAt: "2026-10-22T13:51:46.148Z",
    fact: { field: "MTG-01", value: `https://hernandocountyfl.legistar.com/Calendar.aspx?${id}` }, origins: [{ resultKey: "hunt:packet:fl:county:county-of-hernando" }], claim: null,
    ...(reason ? { waitingFor: { class: "site walk", slots: "1", reason } } : {}) });
  for (const value of [row("a", SITE_WALK_LEAD), row("b", SITE_WALK_LEAD), row("c", "NO_READER_FIELD"), row("d", null), row("e", SITE_WALK_LEAD, "built")])
    await pg.query("INSERT INTO cp_box_findings VALUES ($1, 1, now(), $2)", [value.id, value]);
  const links = (await pg.query<Record<string, unknown>>(BOX_LINKS_SQL, [SITE_WALK_LEAD, 10])).rows;
  assert.deepEqual(links.map(link => link.id), ["a", "b"]);
  assert.deepEqual({ ...links[0] }, { id: "a", url: "https://hernandocountyfl.legistar.com/Calendar.aspx?a", subject_id: "fl:county:county-of-hernando#governing", found_on: "http://www.hernandocounty.us/",
    found_at: "2026-10-22T13:51:46.148Z", government_id: "fl:county:county-of-hernando", result_kind: "hunt:packet:" });
  assert.equal((await pg.query(BOX_MOVED_SQL, [["a", "e"], "2026-10-30T12:00:00Z"])).rows.length, 1, "only a waiting finding moves");
  const [moved] = (await pg.query<{ value: { state: string; buildResultId: string }; revision: string }>("SELECT value, revision FROM cp_box_findings WHERE id = 'a'")).rows;
  assert.deepEqual([moved!.value.state, moved!.value.buildResultId, String(moved!.revision)], ["built", "lead", "2"]);
  assert.deepEqual((await pg.query<{ id: string }>(BOX_LINKS_SQL, [SITE_WALK_LEAD, 10])).rows.map(link => link.id), ["b"]);
});
