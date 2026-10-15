import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readHeldRoster } from "../lib/civic-data/worker-held-roster.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { AuthorityArtifactRef } from "../lib/meetings/edge-artifacts.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { factsVersion } from "../lib/facts/db.ts";
import { ensureEntity, ensureFactEntities } from "../lib/facts/entities.ts";
import type { StateFacts } from "../lib/facts/registry-overlay.ts";
import { publishBodyFacts, publishRosterFacts } from "../lib/facts/roster-facts.ts";
import { planStateFacts } from "../lib/facts/state-facts-publication.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");
const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const TCCC = `${TUCSON}#tucson-convention-center-commission`;
const BODY = { id: TCCC, name: "Tucson Convention Center Commission", state: "AZ", parentId: TUCSON };
const NOW = new Date("2026-08-14T19:00:00Z");
const html = readFileSync(join(ROOT, "tests", "fixtures", "clerksboards", "b15.html"), "utf8");
const capture = (page: string, artifactId: string, url = "https://clerksboards.tucsonaz.gov/boards/15"): WorkerPublicationCapture => ({
  evidence: { artifactId, contentHash: `sha256-${artifactId.padEnd(64, "0")}`, text: page, acquiredByAttemptId: "attempt", canonicalUrl: url,
    retrievedAt: "2026-08-14T12:00:00Z", sourceId: new URL(url).hostname, methodRouteId: "held" },
  observedAt: "2026-08-14T12:00:00Z", httpStatus: 200, transport: "REACHABLE", partial: false });
const members = (page: string) => readHeldRoster(page, "https://clerksboards.tucsonaz.gov/boards/15")!.rows.map((row, i) => ({
  recordId: `held:${i}`, fields: Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) }));

test("a fact going live moves only its state's version and queues the places of the bodies it touches; the edge reads only those bodies again", async () => {
  const db = await factDb();
  await ensureFactEntities(db, ROOT, ["az"]);
  const clocks = factClocks(null);
  await publishRosterFacts(db, { body: BODY, capture: capture(html, "a1"), members: members(html), complete: true, producedBy: "held-roster" }, clocks, NOW);
  assert.notEqual(await factsVersion(db.query, "AZ"), "facts:AZ:0");
  assert.equal(await factsVersion(db.query, "NH"), "facts:NH:0", "another state's version holds");
  assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue"), [{ place_id: TUCSON }]);

  const served: Record<string, StateFacts> = {};
  const refs: Record<string, AuthorityArtifactRef> = {};
  const publish = async () => {
    const plan = await planStateFacts(db.query, refs, async state => served[state] ?? null);
    for (const [state, entry] of Object.entries(plan.entries)) if ("value" in entry) {
      served[state] = entry.value as StateFacts;
      refs[state] = { key: `k-${state}-${entry.versionId}`, version: entry.versionId, sha: "" };
    }
    await plan.settle();
    return plan;
  };
  const first = await publish();
  assert.deepEqual([first.rebuilt, first.patched], [["AZ"], []], "a state with no served copy is read whole, once");
  assert.equal(served.AZ!.rosters.find(roster => roster.bodyId === TCCC)!.members.length, 4);
  assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue"), [], "the queued places are cleared once published");

  const unchanged = await publish();
  assert.deepEqual([unchanged.rebuilt, unchanged.patched, unchanged.bodiesRead], [[], [], 0]);
  assert.ok("carried" in unchanged.entries.AZ!, "an unmoved state is carried, never read");

  // A body with no place row still queues its own division, so its change is read.
  const council = `${TUCSON}#mayor-and-council`;
  await ensureEntity(db.query, { id: council, kind: "body", name: "Mayor and Council", state: "AZ", parentId: TUCSON });
  await publishBodyFacts(db, { bodyId: council, capture: capture("<p>The Mayor and Council meet on the first Tuesday.</p>", "a2", "https://www.tucsonaz.gov/council"),
    producedBy: "test", facts: [{ field: "meeting_cadence", value: "the first Tuesday", quote: "meet on the first Tuesday" }] }, clocks, NOW);
  const patched = await publish();
  assert.deepEqual([patched.rebuilt, patched.patched], [[], ["AZ"]]);
  const [{ place, state }] = await db.query(`SELECT (SELECT count(DISTINCT e.id) FROM entity e LEFT JOIN entity_place p ON p.entity_id = e.id
    WHERE e.kind = 'body' AND (p.place_id = $1 OR e.id > $1 || '#' AND e.id < $1 || '$')) AS place,
    (SELECT count(*) FROM entity WHERE kind = 'body' AND state = 'AZ') AS state`, [TUCSON]) as [{ place: number; state: number }];
  assert.equal(patched.bodiesRead, Number(place), "Tucson's bodies were read again");
  assert.ok(Number(place) < Number(state), `and not Arizona's ${state}`);
  assert.equal(served.AZ!.bodies[council]?.meetingCadence, "the first Tuesday");
  assert.equal(served.AZ!.rosters.find(roster => roster.bodyId === TCCC)!.members.length, 4, "the rest of the state is carried from the served copy");
});
