import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { indexReportedFinding } from "../lib/control-plane/box.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { BOX_DUE_SQL } from "../lib/control-plane/repository/pg-store.ts";
import { FINDING_SLOT_VERSIONS, SITE_WALK_LEAD } from "../lib/facts/finding-slots.ts";
import { handedLinks, settleHandedLinks } from "../lib/hunt/site-walk-handoff.ts";

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
  assert.equal((await repos.boxFindings.waitingUnder(SITE_WALK_LEAD, 10, ["al:city:city-of-dadeville"])).length, 3,
    "the next scheduled site walk still picks up these links");
  const handed = await handedLinks({ boxFindings: repos.boxFindings, governmentIds: ["al:city:city-of-dadeville"], website: "https://example.gov/", now: tomorrow, limit: 1000 });
  assert.deepEqual(handed.leads, [{ url: "https://example.gov/agendas" }]);
  assert.deepEqual(await settleHandedLinks({ boxFindings: repos.boxFindings, handed, read: new Set(["https://example.gov/agendas"]), failed: new Map(), attemptId: "tomorrow-walk", now: tomorrow }),
    { built: 3, failed: 0 });
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
