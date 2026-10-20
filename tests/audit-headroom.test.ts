import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { withLiveAuditCatalog } from "../lib/control-plane/workers/live-audit-catalog.ts";
import { areasForPass, curatedReaderCatalog } from "../lib/control-plane/workers/live-audit.ts";
import { LIVE_AUDIT_DEFAULT_POLICY } from "../lib/control-plane/audit-policy.ts";
import { LossStudyRows, runLossStudy } from "../lib/method/loss-study-run.ts";
import type { LossLesson, LossReading } from "../lib/method/study-all-losses.ts";
import { studyAllLosses } from "./helpers/loss-study.ts";
import { withHistoryIndex } from "../lib/control-plane/workers/streamed-history.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { runTaskPlaces } from "../lib/health/resident-task-run.ts";
import { taskTargets, type ResidentTask, type TaskRun } from "../lib/health/resident-tasks.ts";
import { openSurfaceFixes } from "../lib/health/surface-fixes.ts";
import { samplePublishedZips, withResidentZipSelection } from "../lib/ops/published-zip-selection.ts";
import { sampleZips } from "../lib/health/worst-case-speed.ts";
import { TASK_ZIPS_KEY } from "../lib/control-plane/live-audit-log.ts";

const NOW = "2026-10-20T12:00:00.000Z";
test("a national curated audit publication is read a page at a time; only the selected area names and pools leave scratch storage", async () => {
  const db = new PGlite();
  const records = Array.from({length: 95}, (_,index) => ({id: `fact-${index}`, bodyId: `body-${index % 19}`,
    sourceUrl: `https://clerk.example.gov/${index}`, verifiedAt: NOW, quote: `Saved evidence for ${index}: ` + "official text ".repeat(200)}));
  const payload = {kind: "official-filings", records}, encoded = partitionCivicPayload(payload);
  let largestPage = 0, pages = 0;
  const query: ReadOnlyQuery = async statements => {
    const out = [];
    for (const statement of statements) {
      const rows = (await db.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
      if (statement.text.startsWith("WITH selected_source")) {
        const count = rows.filter(row => row.row_kind === "record").length;
        largestPage = Math.max(largestPage, count); pages++;
      }
      out.push(rows);
    }
    return out;
  };
  try {
    await db.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    for (const part of encoded.parts) await db.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [part.hash, JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(db, {id: "v1", sourceId: "source", recordClass: "CURATED_READER_RECORD", scope: "fixture",
      readModel: payload, storedReadModel: encoded.value, at: NOW});
    const expected = curatedReaderCatalog("official-filings", records), policy = {...LIVE_AUDIT_DEFAULT_POLICY, areasPerPass: 3};
    await withLiveAuditCatalog(async ({catalog, readable, unread}) => {
      assert.equal(readable, 1); assert.deepEqual(unread, []);
      await assert.rejects(catalog.areas(), /BOUNDED_AREA_SELECTION/);
      const selected = await catalog.areasForPass!("pass", policy);
      assert.deepEqual(selected, areasForPass(await expected.areas(), "pass", policy));
      for (const area of selected) assert.deepEqual(await catalog.factsInArea(area, 2), await expected.factsInArea(area, 2));
    }, {query, publications: [{family: "official-filings", scope: "fixture"}]});
    assert.equal(largestPage, 32); assert.equal(pages, 3);
    await db.exec("UPDATE civic_data_candidates SET state='REFUSED'");
    await withLiveAuditCatalog(async ({catalog, readable, unread}) => {
      assert.equal(readable, 0); assert.equal(unread.length, 1);
      assert.deepEqual(await catalog.areasForPass!("pass", policy), []);
    }, {query, publications: [{family: "official-filings", scope: "fixture"}]});
  } finally { await db.close(); }
});

test("disk loss summaries equal the complete fixture study, including failure dominance, shared traits and repeated page faults", async () => {
  const readings: LossReading[] = [];
  const traits = new Map<string, {platform: string; state: string}>();
  for (let index = 0; index < 700; index++) {
    const place = `place-${index}`, failed = index < 400;
    traits.set(place, {platform: failed ? "calendar-a" : "calendar-b", state: index % 2 ? "az" : "nh"});
    readings.push({kind: "shut-door", subject: "meetings", subjectWords: "meeting doors", placeId: place, failed, at: NOW});
    if (index < 3) {
      readings.push({kind: "shut-door", subject: "meetings", subjectWords: "meeting doors", placeId: place, failed: false, at: NOW});
      readings.push({kind: "front-end", subject: "deadline", subjectWords: "the deadline label", placeId: place, failed: index < 2, at: NOW});
    }
  }
  const expected = studyAllLosses(readings, traits, NOW), actual: LossLesson[] = [];
  await withHistoryIndex(async db => {
    const study = new LossStudyRows(db);
    for (const reading of readings) study.addReading(reading);
    for (const [place, held] of traits) study.addTraits(place, held);
    await study.finish(NOW, async lesson => {actual.push(lesson);});
  });
  assert.deepEqual(actual, expected);
  const repos = createMemoryRepositories();
  const fail = async (): Promise<never> => { throw Error("country collection read"); };
  const out = await runLossStudy({...repos, doors: {...repos.doors, list: fail}, obligations: {...repos.obligations, list: fail},
    workItems: {...repos.workItems, list: fail, listWhere: fail}, liveAudits: {...repos.liveAudits, readAll: fail}}, NOW, async () => {});
  assert.deepEqual(out, {readings: 0, failures: 0, lessons: 0, unread: []});
});

test("resident tasks publish each place before starting the next without dropping any newly published ZIP", async () => {
  const task = {id: "who-governs-this-place", title: "Who governs", start: "home"} as ResidentTask;
  const actualId = Object.keys((await import("../lib/health/resident-tasks.ts")).TASK_SCRIPTS)[0];
  const selected = {...task, id: actualId};
  const events: string[] = [], zips = ["00001", "00002", "00003"];
  let clock = Date.parse(NOW);
  const out = await runTaskPlaces({zips, queued: new Set(zips), tasks: [selected], askZips: 0, runId: "fixture", now: () => new Date(clock++).toISOString(),
    run: async (_task, zip, profile) => { events.push(`run:${zip}`); return {taskId: actualId, title: "fixture", zip, profile, steps: [], taps: 0,
      deadEnd: null, missing: [], tapBudget: 1, worstMs: 1, verdict: "PASS", says: "usable"} as TaskRun; },
    record: async pass => {assert.equal(pass.zips.length, 1); events.push(`saved:${pass.zips[0]}`);}});
  assert.equal(out.places, 3);
  assert.equal(out.passed, taskTargets([selected], [zips[0]], 0).length * zips.length);
  assert.ok(events.indexOf("saved:00001") < events.indexOf("run:00002"));
  assert.ok(events.indexOf("saved:00002") < events.indexOf("run:00003"));
});

test("speed's link fixes read exact link-sweep metadata instead of the country's door configurations", async () => {
  const repos = createMemoryRepositories();
  const fail = async (): Promise<never> => {throw Error("country doors read");};
  const result = await openSurfaceFixes({...repos, doors: {...repos.doors, list: fail, listNarrowed: fail}},
    {at: NOW, budgetMs: 3000, zips: [], rows: [], passed: 0, failed: 0}, NOW);
  assert.deepEqual(result.opened, []);
});

test("published ZIP sampling and the complete new-resident queue use disk indexes, including lifetime task membership", async () => {
  const places = Array.from({length: 91}, (_,index) => ({zip: String(10000 + index), lat: index, lng: -index, unused: "unused manifest text ".repeat(200)}));
  const fetchImpl = async () => new Response(JSON.stringify({unneeded: "unneeded national metadata ".repeat(20_000), places}));
  const options = {origin: "https://example.gov", fetchImpl, count: 3, now: NOW};
  assert.deepEqual(await samplePublishedZips(options), sampleZips(places.map(row => row.zip), 3, NOW));
  const repos = createMemoryRepositories();
  for (const place of places.slice(0, 10)) await repos.liveAudits.append(TASK_ZIPS_KEY, place.zip, {kind: "TASK_ZIP", zip: place.zip, at: NOW}, NOW);
  const narrow = {...repos, liveAudits: {...repos.liveAudits, read: async (): Promise<never> => {throw Error("whole task ZIP history read");}}};
  await withResidentZipSelection({...options, repos: narrow, queuedOnly: false}, async selection => {
    assert.equal(selection.published, 91); assert.equal(selection.queuedCount, 81); assert.equal(selection.selected, 81);
    let count = 0, previous = "";
    for await (const zip of selection.zips) {assert.ok(zip > previous); assert.ok(selection.queued.has(zip)); previous = zip; count++;}
    assert.equal(count, 81, "every never-run place still runs even beyond the rotating sample size");
  });
  for (const place of places.slice(10)) await repos.liveAudits.append(TASK_ZIPS_KEY, place.zip, {kind: "TASK_ZIP", zip: place.zip, at: NOW}, NOW);
  await withResidentZipSelection({...options, repos: narrow, queuedOnly: false}, async selection => {
    const selected: string[] = []; for await (const zip of selection.zips) selected.push(zip);
    assert.equal(selection.queuedCount, 0);
    assert.deepEqual(selected, sampleZips(places.map(row => row.zip), 3, NOW));
  });
});
