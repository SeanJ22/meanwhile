/**
 * What the Scout results measure is drawn week by week; a week with no record is a gap, never a zero.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { SCOUT_LEARNING_SQL, buildLearningTrends, type WeekLearningRow } from "../lib/control-plane/admin-view/learning-trends.ts";

function row(week: string, over: Partial<WeekLearningRow> = {}): WeekLearningRow {
  return {
    week, walks: 10, pairRecorded: 10, handed: 4, usedRecorded: 4, usedWalks: 1, reusedDoors: 2, rebuiltRecorded: 10, rebuiltRoutes: 1,
    resumed: 5, resumedFound: 2, fresh: 5, freshFound: 1, found: 3, usd: 6, unpriced: 0, ...over,
  };
}

test("MW-027: no rows means no weeks and no measured series, never a row of zeros", () => {
  const t = buildLearningTrends([], "2026-09-25T12:00:00.000Z");
  assert.deepEqual(t.weeks, []);
  assert.equal(t.series.handed.measuredWeeks, 0);
  assert.equal(t.series.handed.says, "Not recorded in any of the 0 weeks on record.");
  assert.equal(t.escalations.says, "No paid walk is on record, so no model escalation is either.");
});

test('route reuse splits by recorded finder and leaves unattributed history as a gap', () => {
  const trends = buildLearningTrends([row('2026-09-07'), row('2026-09-21', { finderAttributed: 5, scoutReusedDoors: 2, detectiveReusedDoors: 3 })], '2026-09-25T12:00:00Z');
  assert.equal(trends.series.detectiveReused.points[0]!.value, null);
  assert.equal(trends.series.detectiveReused.points[2]!.value, 3);
  assert.equal(trends.series.scoutReused.points[2]!.value, 2);
});

test("one decoded Scout aggregate preserves null markers, refused walks, finder attribution and untimed door reuse",async()=>{
 const pg=new PGlite();try{
  await pg.exec("CREATE TABLE cp_log_scout_results(record jsonb);CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,value jsonb)");
  for(const[id,value]of [['scout',{foundBy:'SCOUT'}],['detective',{foundBy:'DETECTIVE'}],['other',{foundBy:'OTHER'}],['health',{kind:'WRITE_HEALTH',payload:{count:3}}]] as const)await pg.query('INSERT INTO cp_field_manual_entries VALUES($1,$2::jsonb)',[id,JSON.stringify(value)]);
  const rows=[{startedAt:'2026-10-19T12:00:00Z',inheritedFieldManual:2,inheritedFieldManualEntryIds:['scout','detective'],usedFieldManualEntryIds:['scout','scout','detective','other'],rebuiltExistingRoutes:['x'],resumedFromRungs:1,outcome:'EVIDENCE_FOUND',usd:2,modelClass:'haiku',escalatedFrom:'sonnet'},
   {startedAt:'2026-10-20T12:00:00Z',inheritedFieldManual:null,usedFieldManualEntryIds:[],rebuiltExistingRoutes:null,resumedFromRungs:null,outcome:'ROUTE_CANDIDATE',usd:null,modelClass:null},
   {startedAt:'2026-10-21T12:00:00Z',refusal:['stopped'],resumedFromRungs:3,outcome:'EVIDENCE_FOUND',usd:4},
   {usedFieldManualEntryIds:['scout'],inheritedFieldManualEntryIds:['scout'],usd:'unparseable but not timed'},'not an object'];
  for(const record of rows)await pg.query('INSERT INTO cp_log_scout_results VALUES($1::jsonb)',[JSON.stringify(record)]);
  const result=await pg.query<{week_rows:unknown;door_row:unknown;named_rows:unknown;write_errors:string}>(SCOUT_LEARNING_SQL);
  assert.deepEqual(result.rows[0],{week_rows:[{wk:'2026-10-19',walks:3,pair_recorded:2,handed:1,used_recorded:1,used_walks:1,reused_doors:4,finder_attributed:3,scout_reused:2,detective_reused:1,rebuilt_recorded:1,rebuilt_routes:1,resumed:1,resumed_found:1,fresh:1,fresh_found:1,found:2,usd:6,unpriced:1,ladder_recorded:2,escalated:1}],
   door_row:{walks:3,given:3,used:5,since:'2026-10-19T12:00:00Z'},named_rows:[{id:'scout',n:3},{id:'detective',n:1},{id:'other',n:1}],write_errors:'3'});
 }finally{await pg.close();}
});
