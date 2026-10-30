import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { BLANK_PLANNER_CURSOR, keepPlannerList, planBlankChanges } from "../lib/hunt/blank-planner.ts";
import { readPassCursor } from "../lib/facts/db.ts";
import { factDb } from "./helpers/fact-db.ts";

const PIMA = "ocd-division/country:us/state:az/county:pima";
const COCONINO = "ocd-division/country:us/state:az/county:coconino";
const DAY = 86_400_000;

async function open() {
  const facts = await factDb();
  await facts.pg.exec(readFileSync(new URL("../lib/db/migrations/SPN-01B4_blank_changes.sql", import.meta.url), "utf8"));
  const work = new PGlite();
  for (const ddl of WORK_DDL) await work.exec(ddl);
  const query = async (text: string, params: readonly unknown[] = []) => (await work.query<Record<string, unknown>>(text, [...params])).rows;
  for (const [id, kind, name] of [[PIMA, "place", "Pima County"], [COCONINO, "place", "Coconino County"], [`${PIMA}#board`, "body", "Board"], [`${PIMA}#clerk`, "body", "Clerk"],
    ["person:jane", "person", "Jane"], ["person:nowhere", "person", "Nowhere"]]) await facts.query("INSERT INTO entity(id,kind,name,state) VALUES($1,$2,$3,'AZ')", [id, kind, name]);
  for (const [entity, place] of [[`${PIMA}#board`, PIMA], [`${PIMA}#clerk`, PIMA], ["person:jane", PIMA], ["person:jane", COCONINO]])
    await facts.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)", [entity, place]);
  const blank = (entity: string, field: string) => facts.query("INSERT INTO blank(entity_id,field,stage,reason,next_try_at) VALUES($1,$2,'ACQUIRE','missing',now())", [entity, field]);
  return { facts, work, query, blank, close: async () => { await work.close(); await facts.pg.close(); } };
}

test("blanks that changed become one standing hunt for each place they sit in, once, and the cursor moves only forward", async t => {
  const { facts, query, blank, close } = await open();
  t.after(close);
  const at = new Date("2026-10-30T12:00:00Z");
  const list = workList(query, { owner: "planner", now: () => at });
  await blank(`${PIMA}#board`, "agenda_url");
  await blank(`${PIMA}#clerk`, "phone");
  await blank("person:jane", "photo");
  await blank("person:nowhere", "photo");

  const first = await planBlankChanges({ facts: facts.query, list, now: () => at.toISOString() });
  assert.deepEqual(first, { changed: 4, places: 2, added: 2 }, "an entity with no place plans nothing");
  const rows = await query("SELECT kind, tier, series, place_id, subject_id, priority, value, origin, status FROM work ORDER BY place_id");
  assert.deepEqual(rows.map(row => [row.kind, row.tier, row.series, row.status, row.priority]), [
    ["hunt", "coverage", `blank:${COCONINO}`, "waiting", 1],
    ["hunt", "coverage", `blank:${PIMA}`, "waiting", 3],
  ], "one row a place, ordered by how many blanks it holds open");
  assert.deepEqual([rows[0]!.value, rows[0]!.origin, rows[0]!.subject_id], [{ plain: false, paid: false }, { from: "planner" }, COCONINO]);
  assert.ok(await readPassCursor(facts.query, BLANK_PLANNER_CURSOR));

  assert.deepEqual(await planBlankChanges({ facts: facts.query, list, now: () => at.toISOString() }), { changed: 0, places: 0, added: 0 }, "nothing changed, nothing read again");
  await facts.query("UPDATE blank SET reason = 'still missing', updated_at = now() + interval '1 minute' WHERE entity_id = $1", [`${PIMA}#board`]);
  assert.deepEqual(await planBlankChanges({ facts: facts.query, list, now: () => at.toISOString() }), { changed: 1, places: 1, added: 0 }, "a place with a live hunt is not given a second");
  assert.equal((await query("SELECT count(*)::int AS n FROM work"))[0]!.n, 2);
});

test("a big catch-up is read a page at a time and resumes where it stopped", async t => {
  const { facts, query, blank, close } = await open();
  t.after(close);
  const list = workList(query, { owner: "planner" });
  for (const field of ["a", "b", "c", "d", "e"]) await blank(`${PIMA}#board`, field);
  const seen: number[] = [];
  for (let pass = 0; pass < 4; pass += 1) seen.push((await planBlankChanges({ facts: facts.query, list, now: () => new Date().toISOString(), page: 2 })).changed);
  assert.deepEqual(seen, [2, 2, 1, 0]);
});

test("a standing hunt is served only where money was pointed, and comes again on its clock", async t => {
  const { facts, query, blank, close } = await open();
  t.after(close);
  let at = new Date("2026-10-30T12:00:00Z");
  const list = workList(query, { owner: "planner", now: () => at });
  await blank(`${PIMA}#board`, "agenda_url");
  await blank("person:jane", "photo");
  await planBlankChanges({ facts: facts.query, list, now: () => at.toISOString() });

  assert.equal(await list.ready(["hunt"], { fundedSubjects: [] }), false, "no money pointed anywhere: the hunts wait as standing work");
  assert.equal((await list.claim(["hunt"], 5, { fundedSubjects: [] })).length, 0);
  assert.equal(await list.ready(["hunt"], { fundedSubjects: [COCONINO] }), true);
  const [claim, ...rest] = await list.claim(["hunt"], 5, { fundedSubjects: [COCONINO] });
  assert.deepEqual([claim!.subjectId, rest.length], [COCONINO, 0], "only the funded place is served");
  assert.equal((await list.claim(["hunt"], 5)).length, 1, "a claim with no limit serves what is left");

  assert.equal(await list.finish(claim!, 5 * DAY), true);
  await blank("person:jane", "bio");
  await planBlankChanges({ facts: facts.query, list, now: () => at.toISOString() });
  assert.equal((await query("SELECT count(*)::int AS n FROM work WHERE series = $1", [`blank:${COCONINO}`]))[0]!.n, 1, "a hunt waiting out its clock is not repeated early");
  at = new Date(at.getTime() + 6 * DAY);
  assert.deepEqual(await keepPlannerList(list, at.getTime()), { spawned: 1, retired: 0 });
  assert.equal((await query("SELECT count(*)::int AS n FROM work WHERE series = $1 AND status = 'waiting'", [`blank:${COCONINO}`]))[0]!.n, 1, "its next row is made");
});
