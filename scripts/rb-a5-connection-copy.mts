/** Replay one public production fact through a real claimed row, the connected door and the place-page reader. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import type { PGlite } from "@electric-sql/pglite";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { workList } from "../lib/core/work.ts";

const root = resolve(process.argv[2] ?? "."), file = resolve(process.argv[3] ?? ".scratch/rb-a5/reader-source.json");
const connected = (path: string) => import(pathToFileURL(resolve(root, path)).href);
const snapshot = JSON.parse(await readFile(file, "utf8")) as {
  role: string; capturedAt: string; entities: Record<string, unknown>[]; places: Record<string, unknown>[];
  entityPlaces: Record<string, unknown>[]; sourceCopies: Record<string, unknown>[];
  facts: Record<string, unknown>[]; hosts: Record<string, unknown>[];
};
assert.equal(snapshot.role, "readonly");
assert.equal(snapshot.facts.length, 1);
const { migratedReaderDb } = await connected("tests/helpers/migrated-reader-db.ts");
const { pg } = await migratedReaderDb() as { pg: PGlite };
const pool = new Pool({ host: "/tmp", port: 55435, database: "postgres", user: "agent" });
try {
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const facts: FactDb = { transaction: work => pg.transaction(tx => work(async (text, params = []) =>
    (await tx.query<Record<string, unknown>>(text, [...params])).rows)) };
  const entities = [...new Map([...snapshot.places, ...snapshot.entities].map(entity => [entity.id, entity])).values()];
  await query(`INSERT INTO entity(id,kind,name,state,parent_id)
    SELECT id,kind,name,state,parent_id FROM jsonb_to_recordset($1::jsonb) AS e(id text,kind text,name text,state text,parent_id text)`, [JSON.stringify(entities)]);
  for (const source of snapshot.sourceCopies) await query(`INSERT INTO source_copy
    SELECT * FROM jsonb_populate_record(NULL::source_copy,$1::jsonb)`, [JSON.stringify(source)]);
  for (const place of snapshot.entityPlaces) await query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)", [place.entity_id, place.place_id]);
  for (const host of snapshot.hosts) await query("INSERT INTO entity_host(entity_id,host) VALUES($1,$2)", [host.entity_id, host.host]);
  const { BOOTSTRAP_DDL } = await connected("lib/control-plane/repository/pg-schema.ts");
  await pg.exec((BOOTSTRAP_DDL as string[]).find(sql => sql.startsWith("CREATE TABLE IF NOT EXISTS cp_work_items ("))!);

  const original = snapshot.facts[0]!, source = snapshot.sourceCopies[0]!, place = snapshot.places[0]!;
  const phone = original.field === "office_phone";
  assert.ok(phone || original.field === "meeting_cadence", "Use a held contact or meeting claim for the connection probe");
  assert.equal((await query("SELECT count(*)::int n FROM fact WHERE entity_id=$1 AND field=$2", [original.entity_id, original.field]))[0]!.n, 0);
  const list = workList(async (text, params = []) => (await pool.query(text, [...params])).rows, { owner: "connection-copy" });
  const added = await list.add({ kind: "check", state: String(place.state), placeId: String(place.id), subjectId: String(original.entity_id),
    url: String(source.final_url), field: String(original.field), value: original.value, quote: String(original.quote),
    sources: [`source-copy:${source.id}`], source: { productionFactId: original.id, copyId: source.id }, priority: 1_000_000 });
  const [claim] = await list.claim("check", 1);
  assert.equal(claim!.id, added.id);
  const { door } = await connected("lib/core/door.ts");
  const now = new Date();
  const outcome = await door(facts, { subjectId: claim!.subjectId, field: claim!.field,
    fieldKind: phone ? "contact" : "meeting", value: claim!.value, valueText: String(claim!.value), quote: claim!.quote,
    provenance: original.provenance_kind, acquisition: "loader", producedBy: "rb-a5-production-copy", costUsd: 0,
    sourceField: { record: original, key: "value" },
    copy: { id: Number(source.id), finalUrl: String(source.final_url), fetchedAt: new Date(String(source.fetched_at)),
      isArchive: false, get text(): string { throw new Error("The official loader must use its parsed source field"); } },
  }, factClocks(null), now, { purge: async () => ({ purged: true }) });
  assert.equal(outcome.decision, "PUBLISH");
  assert.equal(await list.finish(claim!), true);
  const { readPlacePackage } = await connected("lib/reader/place.ts");
  const page = await readPlacePackage({ state: String(place.state), divisionIds: [String(place.id)], bodyFactsOnly: true }, query) as {
    bodies: { id: string; fields: { officePhone?: string; fieldSources?: Record<string, { sourceUrl: string }>;
      meetingCadence?: string; meetingCadenceSource?: { sourceUrl: string } } }[];
  };
  const shown = page.bodies.find(body => body.id === original.entity_id);
  const shownValue = phone ? shown?.fields.officePhone : shown?.fields.meetingCadence;
  const shownSource = phone ? shown?.fields.fieldSources?.officePhone : shown?.fields.meetingCadenceSource;
  assert.equal(shownValue, original.value);
  assert.equal(shownSource?.sourceUrl, source.url);
  assert.equal((await query("SELECT count(*)::int n FROM rebuild_queue WHERE place_id=$1", [place.id]))[0]!.n, 1);
  if (process.argv[4]) {
    type Body = Record<string, unknown> & { bodyId: string };
    const baseline = JSON.parse(await readFile(resolve(process.argv[4]), "utf8")) as { coverage: { bodies: Body[] };
      stateResponse?: { value: { coverage?: { bodies?: Body[] } } }; meetings: unknown[] };
    const projected = structuredClone(baseline);
    const before = structuredClone(baseline);
    for (const body of [...before.coverage.bodies, ...(before.stateResponse?.value.coverage?.bodies ?? [])]) {
      if (body.bodyId !== original.entity_id) continue;
      if (phone) body.officeContact = { ...(body.officeContact as object), phone: null };
      else body.meetingCadence = null;
    }
    let updated = 0;
    for (const body of [...projected.coverage.bodies, ...(projected.stateResponse?.value.coverage?.bodies ?? [])]) {
      if (body.bodyId !== original.entity_id) continue;
      if (phone) {
        body.officeContact = { ...(body.officeContact as object), phone: shownValue, provenance: shownSource };
        body.fieldSources = { ...(body.fieldSources as object), officePhone: shownSource };
      } else body.meetingCadence = { text: shownValue, sourceUrl: shownSource!.sourceUrl };
      updated++;
    }
    assert.ok(updated > 0, "The copied fact must belong to a body already on this place page");
    assert.deepEqual(projected.meetings, baseline.meetings);
    assert.deepEqual(projected.coverage.bodies.map(body => body.bodyId), baseline.coverage.bodies.map(body => body.bodyId));
    await writeFile(resolve(dirname(file), "place-copy-response.json"), JSON.stringify(projected));
    await writeFile(resolve(dirname(file), "place-before-response.json"), JSON.stringify(before));
  }
  const result = { at: now.toISOString(), sourceRole: snapshot.role, capturedAt: snapshot.capturedAt, workId: claim!.id,
    placeId: place.id, subjectId: original.entity_id, sourceCopyId: source.id, sourceUrl: source.url,
    originalProductionFactId: original.id, doorDecision: outcome.decision,
    field: original.field, placePageReaderValue: shownValue, reader: "readPlacePackage", queuedForPageRebuild: true };
  await writeFile(resolve(dirname(file), "connection-proof.json"), JSON.stringify(result, null, 2));
  console.log(result);
} finally { await pool.end(); await pg.close(); }
