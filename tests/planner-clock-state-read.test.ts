import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../lib/db/schema.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readPlannerRoutineClock } from "../lib/civic-data/planner-clock-state-read.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import { serializeUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";

test("planner source clocks match the original clock on real migrations without sorting candidate payloads", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const name of ["0025_typical_fixer","0030_database_transfer_daily","0031_civic_payload_parts","0036_ne01"])
    await pg.exec(readFileSync(`lib/db/migrations/${name}.sql`, "utf8"));
  const db = Object.assign(drizzle(pg,{schema}),{batch: (queries: PromiseLike<unknown>[]) => Promise.all(queries)});
  const oldRead = (PostgresRoutineDataStore.prototype as unknown as {
    readClock(source: string, recordClass: string, scope: string, parser?: string): Promise<unknown>;
  }).readClock.bind({db});
  let task = { sourceId: "legistar-outcomes",recordClass: "MEETING_OUTCOME" as "MEETING" | "MEETING_OUTCOME",scope: "US-AZ:county:pima:legistar-outcomes" };
  let bytes = 0;
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement => {
    const rows = (await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows;
    bytes += Buffer.byteLength(JSON.stringify(rows)); return rows;
  }));
  const parity = async (parser?: string) => assert.deepEqual(await readPlannerRoutineClock(task,"az",query,parser),
    await oldRead(task.sourceId,task.recordClass,task.scope,parser));
  await parity();
  await assert.rejects(readPlannerRoutineClock(task,"nh",query),/PLANNER_CLOCK_STATE_BOUNDARY/);
  const receipt = (id: string) => ({ contractVersion: 2,decision: "GOOD",candidateId: id,...task,
    validatedAt: "2026-10-10T00:00:00.000Z",excludedFacts: [],checks: VALIDATION_CHECKS.map(check => ({ check,verdict: "PASS",code: "OK",detail: "verified" })) });
  const put = async (id: string,observed: string,options: { state?: string;check?: string;imported?: boolean;parser?: string } = {}) => {
    const candidate = { id,...task,retrieval: { retrievedAt: "2026-10-10T00:00:00.000Z",...(options.check ? { sourceCheck: {
      checkedAt: options.check,httpStatus: 200,rawHash: "a".repeat(64),requestedUrl: "https://pima.gov/meetings",finalUrl: "https://pima.gov/meetings",
    } } : {}) },normalization: { parserVersion: options.parser ?? "v1" },
      ...(options.imported ? { bootstrapImport: { kind: "TRUSTED_LKG_IMPORT" } } : {}),
      readModel: { unused: "evidence".repeat(options.imported ? 2 : 100_000) } };
    await pg.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
      VALUES($1,$2,$3,$4,$5,true,'2026-10-10','2026',$6,'{}',$7,$8,$1,$1)`,
      [id,task.sourceId,task.recordClass,task.scope,options.state ?? "PROMOTED",options.parser ?? "v1",JSON.stringify(candidate),JSON.stringify(receipt(id))]);
    await pg.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,1,'FETCHED',$2,'fetched')",[id,observed]);
    return candidate;
  };
  const point = async (id: string,at: string) => pg.query(`INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$5,$5,$6,'{}',$7)
    ON CONFLICT(key) DO UPDATE SET current_version_id=EXCLUDED.current_version_id,last_known_good_version_id=EXCLUDED.last_known_good_version_id,
      promoted_at=EXCLUDED.promoted_at,validation_receipt=EXCLUDED.validation_receipt`,
    [`${task.recordClass}:${task.scope}`,task.sourceId,task.recordClass,task.scope,id,at,JSON.stringify(receipt(id))]);
  await put("good","2026-10-10T01:00:00Z"); await point("good","2026-10-10T02:00:00Z"); await parity();
  await put("failed","2026-10-11T01:00:00Z",{state:"PARSE_INVALID"}); await parity();
  await put("replay","2026-10-12T01:00:00Z",{check:"2026-10-10T03:00:00Z"});
  await point("replay","2026-10-12T02:00:00Z"); await parity();
  assert.equal((await readPlannerRoutineClock(task,"az",query)).lastAttemptedAt,"2026-10-11T01:00:00.000Z",
    "an older observed attempt can be newer than a replay's provider check");
  await put("future-check","2026-10-13T01:00:00Z",{check:"2026-10-14T00:00:00Z"}); await point("future-check","2026-10-13T02:00:00Z"); await parity();
  await put("imported","2026-10-15T00:00:00Z",{imported:true}); await point("imported","2026-10-15T01:00:00Z"); await parity();
  await put("after-import","2026-10-16T00:00:00Z",{state:"PARSE_INVALID"}); await parity();
  await point("good","2026-10-10T02:00:00Z");
  const confirmation = { kind: "UNCHANGED_CONFIRMATION_V1" as const,...task,pointerKey:`${task.recordClass}:${task.scope}`,
    versionId:"good",parserVersion:"v1",readModelHash:"a".repeat(64),basis:"READ_MODEL_RECOMPUTED" as const,
    observedAt:"2026-10-17T01:00:00.000Z",retrieval:{requestedUrl:"https://pima.gov/meetings",finalUrl:"https://pima.gov/meetings",
      httpStatus:200,rawHash:"a".repeat(64),retrievedAt:"2026-10-17T00:00:00.000Z"},stamps:null };
  await pg.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES('good',2,'PROMOTED',$1,$2)",
    [confirmation.observedAt,serializeUnchangedConfirmation(confirmation)]);
  await parity(); await parity("v1"); await parity("v2");
  await pg.query("UPDATE civic_data_promotions SET last_known_good_version_id='other' WHERE current_version_id='good'"); await parity();
  for (let index=0;index<40;index++) await put(`import-page-${index}`,`2026-10-18T00:${String(index).padStart(2,"0")}:00Z`,{imported:true});
  await parity();
  for (let index=2;index<43;index++) await put(`micro-import-${index}`,`2026-10-20T00:00:00.500${String(index).padStart(3,"0")}Z`,{imported:true});
  await put("micro-live","2026-10-20T00:00:00.500001Z"); await parity();
  assert.equal((await readPlannerRoutineClock(task,"az",query)).lastAttemptedAt,"2026-10-20T00:00:00.500Z",
    "pagination keeps the exact Postgres timestamp while public clocks use milliseconds");
  task = { sourceId:"calendar",recordClass:"MEETING",scope:"US-AZ:held-calendar" };
  await put("calendar-good","2026-10-19T01:00:00Z"); await point("calendar-good","2026-10-19T02:00:00Z");
  await pg.query("UPDATE civic_data_promotions SET payload=$1 WHERE current_version_id='calendar-good'",
    [JSON.stringify({meetings:[{startsAt:"2026-10-21T12:00:00Z"},{startsAt:null},{startsAt:"2026-10-22T12:00:00Z"}]})]);
  await parity();
  assert.deepEqual((await readPlannerRoutineClock(task,"az",query)).sittingStarts,["2026-10-21T12:00:00Z","2026-10-22T12:00:00Z"]);
  assert.ok(bytes < 200_000,"clock data never transfers the retained read model");
});
