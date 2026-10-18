import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MEETING_BODY_WITHOUT_AGENDA } from "../lib/meetings/body-rows.ts";

test("a meeting-time read selects the exact prepared body and omits agenda text in the database", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE civic_data_reader_projections (record_class text, scope text, payload jsonb)");
    const payload = { bodyId: "board-one", snapshot: { meetings: [{ id: "sitting", startsAt: "2026-10-19T18:00:00Z" }],
      agendaDocuments: [{ text: "Long agenda text that is not needed to say when." }], sources: [{ sourceUrl: "https://example.gov/calendar" }] },
      historyScopes: ["past"] };
    await db.query("INSERT INTO civic_data_reader_projections VALUES ($1,$2,$3),($1,$4,$5)",
      ["MEETING", "body-one", payload, "body-two", { bodyId: "board-two", snapshot: { agendaDocuments: [] } }]);
    const result = await db.query<{ payload: typeof payload }>(MEETING_BODY_WITHOUT_AGENDA, ["MEETING", "body-one"]);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0]!.payload, { ...payload, snapshot: { ...payload.snapshot, agendaDocuments: [] } });
    assert.equal((await db.query(MEETING_BODY_WITHOUT_AGENDA, ["MEETING", "unheld-body"])).rows.length, 0);
  } finally { await db.close(); }
});
