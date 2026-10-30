import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { askGapsProvider } from "../lib/control-plane/scheduler/providers/ask-gaps.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { keepAskGapRows } from "../lib/control-plane/scheduler/ask-gap-rows.ts";
import { heldReading } from "./helpers/ask-gap-unit.ts";

const NOW = "2026-09-24T12:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima#governing";
const unread = () => ({ kind: "UNREAD" as const, why: "test" });
const meeting = { id: "legistar:pima:1901", bodyId: PIMA, startsAt: "2026-10-06T09:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: null, provenance: { collectedAt: "2026-09-24T10:00:00.000Z" } };
const pass = (meetings: readonly (typeof meeting)[]) =>
  buildRegistry([askGapsProvider({ holdings: () => heldReading({ meetings, documents: [], sittings: [], now: Date.parse(NOW), clockOf: unread }) })], { root: ".", nowIso: NOW });

test("each gap Ask would state is one waiting row in a series named by its obligation, put there once, and finished when the gap is gone", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const rows = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const list = workList(rows, { owner: "gap-test", now: () => new Date(NOW) });
  const gaps = pass([meeting]);
  const wanted = gaps.units.map(unit => unit.obligation.id).sort();
  assert.ok(wanted.length > 0);

  await keepAskGapRows(list, gaps.units, true, "az");
  await keepAskGapRows(list, gaps.units, true, "az");
  assert.deepEqual((await rows("SELECT series FROM work WHERE status = 'waiting' ORDER BY series")).map(row => row.series), wanted, "one row for each gap the provider yields, put once however often the pass runs");
  const [row] = await rows("SELECT kind, subject_id, value FROM work LIMIT 1");
  assert.equal(row!.kind, "recheck");
  assert.equal(row!.subject_id, PIMA);

  await keepAskGapRows(list, [], false, "az");
  assert.equal((await rows("SELECT count(*)::int AS n FROM work WHERE status = 'waiting'"))[0]!.n, wanted.length, "a provider that could not read retires nothing");
  await keepAskGapRows(list, [], true, "ca");
  assert.equal((await rows("SELECT count(*)::int AS n FROM work WHERE status = 'waiting'"))[0]!.n, wanted.length, "another state's clean read leaves this state's rows");
  await keepAskGapRows(list, [], true, "az");
  assert.equal((await rows("SELECT count(*)::int AS n FROM work WHERE status = 'waiting'"))[0]!.n, 0, "a clean read with no gap finishes the rows");
  assert.equal((await rows("SELECT count(*)::int AS n FROM work WHERE status = 'done'"))[0]!.n, wanted.length);
});
