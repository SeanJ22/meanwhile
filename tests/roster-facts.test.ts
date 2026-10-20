import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readHeldRoster } from "../lib/civic-data/worker-held-roster.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");
const TCCC = "ocd-division/country:us/state:az/place:tucson#tucson-convention-center-commission";
const BODY = { id: TCCC, name: "Tucson Convention Center Commission", state: "AZ", parentId: "ocd-division/country:us/state:az/place:tucson" };
const NOW = new Date("2026-08-14T19:00:00Z");
const clocks = factClocks(null);

function capture(html: string, artifactId: string, observedAt = "2026-08-14T12:00:00Z"): WorkerPublicationCapture {
  return { evidence: { artifactId, contentHash: `sha256-${"b".repeat(63)}${artifactId.slice(-1)}`, text: html, acquiredByAttemptId: "attempt",
    canonicalUrl: "https://clerksboards.tucsonaz.gov/boards/15", retrievedAt: observedAt, sourceId: "clerksboards.tucsonaz.gov", methodRouteId: "held" },
  observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}
const html = readFileSync(join(ROOT, "tests", "fixtures", "clerksboards", "b15.html"), "utf8");
const members = (page: string) => readHeldRoster(page, "https://clerksboards.tucsonaz.gov/boards/15")!.rows.map((row, i) => ({
  recordId: `held:${i}`, fields: Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) }));

async function seeded() {
  const db = await factDb();
  await ensureFactEntities(db, ROOT, ["az"]);
  return db;
}

test("a saved official roster page becomes one live fact per member and title, each with its receipt, and readers see the roster", async () => {
  const db = await seeded();
  const report = await publishRosterFacts(db, { body: BODY, capture: capture(html, "ar-roster-1"), members: members(html), complete: true, producedBy: "held-roster" }, clocks, NOW);
  const { people, outcomes, ...counts } = report;
  assert.deepEqual(counts, { live: 12, confirmed: 0, held: 0, blanks: 0, departed: 0 });
  assert.equal(new Set(people.values()).size, 4);
  assert.deepEqual([...outcomes.values()].flatMap(fields => [fields.get("name"), fields.get("office")]).map(outcome => outcome && "decision" in outcome && outcome.decision), Array(8).fill("PUBLISH"));
  const { rosters, dispositions } = await readFactRosters(db.query, [TCCC]);
  assert.equal(rosters.length, 1);
  assert.deepEqual(rosters[0]!.members.map(m => [m.name, m.officeTitle]).sort(), [
    ["Alysha Ramirez Hall", "Member"], ["Jose Jimenez", "Vice Chairperson"], ["Ned Beman", "Chairperson"], ["Ronnie Reyna", "Member"]]);
  assert.equal(rosters[0]!.sourceUrl, "https://clerksboards.tucsonaz.gov/boards/15");
  assert.equal(rosters[0]!.members[0]!.fieldSources!.name!.sourceUrl, "https://clerksboards.tucsonaz.gov/boards/15");
  assert.equal(dispositions.length, 4);
  assert.ok(dispositions.every(d => d.state === "READER_ELIGIBLE"));
});

test("a re-read confirms; a complete official page that drops a member retires only that membership; a page label is never a person", async () => {
  const db = await seeded();
  await publishRosterFacts(db, { body: BODY, capture: capture(html, "ar-roster-1"), members: members(html), complete: true, producedBy: "held-roster" }, clocks, NOW);
  const again = await publishRosterFacts(db, { body: BODY, capture: capture(html, "ar-roster-1"), members: members(html), complete: true, producedBy: "held-roster" }, clocks, NOW);
  assert.equal(again.confirmed, 12);
  const without = html.replace(/<tr>(?:(?!<\/tr>)[\s\S])*Ronnie Reyna[\s\S]*?<\/tr>/, "");
  assert.ok(!without.includes("Ronnie Reyna"));
  const later = await publishRosterFacts(db, { body: BODY, capture: capture(without, "ar-roster-2", "2026-08-14T15:00:00Z"),
    members: [...members(without), { recordId: "nav", fields: { name: "Actions", office: "Member" } }], complete: true, producedBy: "held-roster" }, clocks, NOW);
  assert.equal(later.departed, 1);
  assert.equal(later.blanks, 1);
  const { rosters } = await readFactRosters(db.query, [TCCC]);
  assert.deepEqual(rosters[0]!.members.map(m => m.name).sort(), ["Alysha Ramirez Hall", "Jose Jimenez", "Ned Beman"]);
  assert.deepEqual(await db.query("SELECT stage, reason FROM blank"), [{ stage: "READ", reason: "NAME_NOT_A_PERSON" }]);
});

test("the same person read from two pages is one person; a name the page does not show leaves a blank with its reason", async () => {
  const db = await seeded();
  await publishRosterFacts(db, { body: BODY, capture: capture(html, "ar-roster-1"), members: members(html), complete: true, producedBy: "held-roster" }, clocks, NOW);
  await publishRosterFacts(db, { body: BODY, capture: capture(html, "ar-roster-3", "2026-08-14T16:00:00Z"),
    members: [{ recordId: "x", fields: { name: "Ned Beman", office: "Chairperson" } }, { recordId: "y", fields: { name: "Pat Nobody", office: "Member" } }],
    complete: false, producedBy: "parser" }, clocks, NOW);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM entity WHERE kind = 'person' AND name = 'Ned Beman'"))[0]!.n, 1);
  const blanks = await db.query("SELECT field, stage, reason FROM blank ORDER BY field");
  assert.ok(blanks.every(b => b.stage === "CHECK" && b.reason === "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY"));
  assert.ok(blanks.some(b => String(b.field).startsWith("member:")));
});
