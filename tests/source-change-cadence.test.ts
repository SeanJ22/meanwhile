import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { factClocks } from "../lib/facts/clocks.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { measureTranslationRoutineTask } from "../lib/translate/routine-contract.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue, routineTaskNextDueMs, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
import { factRefreshBounds, observedSourceEveryMs, readSourceChangeHistory, routineFactKind, timeSensitiveSource } from "../lib/civic-data/source-change-cadence.ts";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const AT = "2026-10-20T12:00:00.000Z";
const start = Date.parse(AT);
const portrait = ROUTINE_SOURCE_TASKS.find(task => task.id === "people-portraits-az")!;
const checked = { lastAttemptedAt: AT, lastSucceededAt: AT, lastSucceededObservedAt: AT };

test("each family receives its fact kind's configured retry floor, including portraits and derived campaigns", () => {
  const defaults = factClocks(null);
  for (const task of [...ROUTINE_SOURCE_TASKS, ...AUTOMATIC_REFRESH_TASKS]) {
    const bounds = factRefreshBounds(task);
    assert.equal(bounds.minimumRefreshMs, defaults.retryMinutes(routineFactKind(task)) * 60_000, task.id);
    assert.ok(bounds.freshnessWindowMs > 0, task.id);
  }
  assert.equal(routineFactKind(portrait), "portrait");
  const campaign = ROUTINE_SOURCE_TASKS.find(task => task.sourceId === "candidate-campaign-site-chain")!;
  assert.equal(routineFactKind(campaign), "contact");
  for (const task of [portrait, campaign]) {
    assert.equal(routineTaskNextDueMs(task, checked, start + HOUR, undefined, HOUR), start + DAY);
    assert.equal(routineTaskDue(task, checked, start + DAY - 1, undefined, HOUR), false);
    assert.equal(routineTaskDue(task, checked, start + DAY, undefined, HOUR), true);
  }
  const config = defaultAdminConfig();
  const clocks = factClocks({ ...config, settings: { ...config.settings,
    "facts.retryMinutes": Object.fromEntries(["officeholder", "contact", "comment_rule", "meeting", "agenda", "outcome", "vote", "money", "statement", "portrait", "ballot", "law", "news", "same_person_link"].map(kind => [kind, kind === "portrait" ? 120 : 1440])) } });
  const task = { ...portrait, ...factRefreshBounds(portrait, clocks) };
  assert.equal(routineTaskNextDueMs(task, checked, start, undefined, HOUR), start + 2 * HOUR);
  assert.equal(routineTaskNextDueMs({ ...portrait, minimumRefreshMs: 2 * DAY }, { lastAttemptedAt: AT, failureStreak: 16 }, start), start + 2 * DAY,
    "the existing daily failure-backoff cap cannot shorten a longer configured fact retry");
});

test("unchanged source history can slow rechecks, bounded by the fact freshness window", () => {
  assert.equal(routineTaskNextDueMs(portrait, checked, start, undefined, 5 * DAY), start + 5 * DAY);
  const bounded = { ...portrait, freshnessWindowMs: 3 * DAY };
  assert.equal(routineTaskNextDueMs(bounded, checked, start, undefined, 50 * DAY), start + 3 * DAY);
  const history = { rawHash: "a".repeat(64), observedFrom: AT, lastChangedAt: AT, changes: 0, meanChangeMs: null };
  assert.equal(observedSourceEveryMs(history, { ...checked, lastSucceededObservedAt: new Date(start + 4 * DAY).toISOString() }), 4 * DAY);
  assert.equal(observedSourceEveryMs(undefined, checked), undefined);
});

test("voting and ballot checks keep their election pace, and meetings/outcomes keep their source clock", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  for (const task of [...ROUTINE_SOURCE_TASKS, ...AUTOMATIC_REFRESH_TASKS].filter(task =>
    task.recordClass === "VOTING_SITE" || task.recordClass === "BALLOT_CANDIDACY" || task.recordClass === "MEETING_OUTCOME" || task.id.startsWith("ballot-navigation"))) {
    const due = routineTaskNextDueMs(task, { lastAttemptedAt: new Date(now).toISOString(), lastSucceededObservedAt: new Date(now).toISOString() }, now, undefined, 40 * DAY);
    const policy = task.contract.cadence.phases?.find(phase => now < Date.parse(phase.through))?.everyMs ?? task.cadenceMs;
    assert.ok(due <= now + policy, `${task.id} keeps ${policy}ms`);
  }
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.contract.schedule?.kind === "SITTING_WINDOW");
  assert.ok(meeting, "the source registry carries a sitting-window meeting contract");
  const clock = { ...checked, sittingStarts: [new Date(start + DAY).toISOString()] };
  assert.equal(routineTaskNextDueMs(meeting, clock, start, true, 40 * DAY), routineTaskNextDueMs(meeting, clock, start, true));
});

test("election explainers and owed district plans keep their own ballot pace through November 3", () => {
  const translation = measureTranslationRoutineTask("OH");
  const geography = ROUTINE_SOURCE_TASKS.find(task => task.id === "census-geography-overlaps")!;
  for (const task of [translation, geography]) {
    assert.equal(routineFactKind(task), "ballot");
    assert.equal(timeSensitiveSource(task, start), true);
    const before = { lastAttemptedAt: AT };
    assert.equal(routineTaskDue(task, before, start + task.retryMs - 1), false);
    assert.equal(routineTaskDue(task, before, start + task.retryMs), true,
      `${task.id} retains its installed election retry rather than an officeholder delay`);
    const after = Date.parse("2026-11-05T12:00:00.000Z"), at = new Date(after).toISOString();
    assert.equal(timeSensitiveSource(task, after), false);
    const floor = factRefreshBounds(task).minimumRefreshMs;
    assert.equal(routineTaskDue(task, { lastAttemptedAt: at }, after + floor - 1), false,
      "after the election the configured ballot retry floor applies");
    assert.equal(routineTaskDue(task, { lastAttemptedAt: at }, after + floor), true);
  }
  assert.equal(routineTaskDue(translation, checked, start + translation.cadenceMs - 1), false);
  assert.equal(routineTaskDue(translation, checked, start + translation.cadenceMs), true);
});

test("an unfinished member-office pass continues before its daily retry floor", () => {
  const task = AUTOMATIC_REFRESH_TASKS.find(task => task.id === "member-offices")!;
  assert.equal(routineTaskDue(task, { ...checked, continuationPending: true }, start + 1, undefined, 40 * DAY), true);
  assert.equal(routineTaskDue(task, { ...checked, lastAttemptedAt: new Date(start + HOUR).toISOString(), continuationPending: true }, start + 2 * HOUR), false,
    "a real failed source attempt keeps its configured retry");
});

test("Postgres derives source movement from exact scope/parser/hash format; promotions and large bodies do not count", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,
    parser_version text,state text,acquisition_succeeded boolean,raw_hash text,candidate jsonb,retrieved_at timestamptz);
    CREATE TABLE civic_data_candidate_events(candidate_id text,sequence int,at timestamptz);
    CREATE TABLE civic_data_promotions(source_id text,record_class text,scope text,current_version_id text);`);
  const task: RoutineSourceTask = { ...portrait, parserVersion: "people/1" };
  const add = async (id: string, day: number, hash: string, basis: string | null, overrides: { scope?: string; parser?: string; state?: string } = {}) => {
    const candidate = { retrieval: { ...(basis ? { rawHashBasis: basis } : {}) }, readModel: "large held record".repeat(20_000) };
    await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,$5,$6,true,$7,$8::jsonb,$9)",
      [id, task.sourceId, task.recordClass, overrides.scope ?? task.scope, overrides.parser ?? task.parserVersion,
        overrides.state ?? "PROMOTED", hash.repeat(64), JSON.stringify(candidate), new Date(start + day * DAY).toISOString()]);
    await pg.query("INSERT INTO civic_data_candidate_events VALUES($1,1,$2)", [id, new Date(start + day * DAY).toISOString()]);
  };
  await add("old-hash-format", -20, "f", null);
  await add("first", 0, "a", "SOURCE_CONTENT_V1");
  await add("same-content-new-version", 1, "a", "SOURCE_CONTENT_V1");
  await add("changed", 2, "b", "SOURCE_CONTENT_V1");
  await add("unchanged-again", 3, "b", "SOURCE_CONTENT_V1");
  await add("other-state", 4, "c", "SOURCE_CONTENT_V1", { scope: "US-CA:portraits" });
  await add("other-parser", 4, "d", "SOURCE_CONTENT_V1", { parser: "people/0" });
  await add("failed", 4, "e", "SOURCE_CONTENT_V1", { state: "CANNOT_TELL" });
  await pg.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4)", [task.sourceId, task.recordClass, task.scope, "unchanged-again"]);
  let bytes = 0;
  const history = await readSourceChangeHistory(async (text, params) => {
    const result = (await pg.query<Record<string, unknown>>(text, [...(params ?? [])])).rows;
    bytes += JSON.stringify(result).length;
    return result;
  }, [task]);
  assert.deepEqual(history.get(task.id), { rawHash: "b".repeat(64), observedFrom: AT,
    lastChangedAt: new Date(start + 2 * DAY).toISOString(), changes: 1, meanChangeMs: 2 * DAY });
  assert.ok(bytes < 512, `history response is ${bytes} bytes despite megabytes of held bodies`);
  await pg.query("UPDATE civic_data_promotions SET current_version_id=$1",["old-hash-format"]);
  assert.equal((await readSourceChangeHistory(async(text,params)=>(await pg.query<Record<string,unknown>>(text,[...(params ?? [])])).rows,[task])).size,0,
    "an untyped legacy hash cannot teach the scheduler that a changing native source is unchanged");
});
