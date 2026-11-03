import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { indexReportedFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { BOX_DUE_SQL } from "../lib/control-plane/repository/pg-store.ts";
import { FINDING_SLOT_VERSIONS, SITE_WALK_LEAD } from "../lib/facts/finding-slots.ts";
import { leadsOn } from "../lib/core/leads.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { factDb } from "./helpers/fact-db.ts";

test("document, meeting and government links never enter the Box: they go on the work list as one link each, and a never-tried legacy row is filed there by the publisher", async t => {
  const repos = createMemoryRepositories(), facts = await factDb();
  t.after(() => facts.pg.close());
  for (const ddl of WORK_DDL) await facts.pg.exec(ddl);
  leadsOn(() => workList(facts.query, { owner: "test" }));
  const now = "2026-10-23T08:00:00.000Z", tomorrow = "2026-10-24T08:00:00.000Z";
  for (const [index, field] of ["DOC-02", "MTG-01", "GOV-03"].entries()) {
    const finding = { subjectId: "al:city:city-of-dadeville#governing", field, value: "https://example.gov/agendas", exactQuote: "Agendas",
      sourceUrl: "https://example.gov/", artifactIds: [], subjectHint: null, index };
    const input = { workItemId: "hunt", attemptId: "today", missionPart: null, finding };
    const row = await indexReportedFinding(repos.boxFindings, input, now);
    assert.equal(row.row, null, "the Box holds no link");
    await indexReportedFinding(repos.boxFindings, { ...input, attemptId: "tomorrow" }, tomorrow);
  }
  assert.deepEqual(await repos.boxFindings.list(), []);
  const [lead, ...others] = (await facts.query("SELECT * FROM work")) as unknown as { url: string; kind: string; tier: string; sources: string[]; reports: { foundOn: string; quote: string }[] }[];
  assert.equal(others.length, 0, "one address is one row");
  assert.deepEqual([lead!.kind, lead!.tier, lead!.url, lead!.sources], ["lead", "coverage", "https://example.gov/agendas", ["https://example.gov/"]]);
  assert.deepEqual([lead!.reports.length, lead!.reports[0]!.foundOn, lead!.reports[0]!.quote], [1, "https://example.gov/", "Agendas"], "the page it was found on and the quote are kept");
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
