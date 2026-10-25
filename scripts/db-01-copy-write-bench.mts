import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const [copyFile, outputFile] = process.argv.slice(2);
const copy = JSON.parse(await readFile(copyFile, "utf8"));
assert.equal(copy.branchId, "br-wandering-wildflower-ax90nnik");
assert.equal(new URL(copy.url).searchParams.has("options"), false);
const sql = neon(copy.url);
await sql.query(`CREATE TABLE db01_write_samples AS SELECT c.*,row_number() OVER (ORDER BY p.key) AS sample_n
  FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
    AND p.validation_receipt=c.validation_receipt AND p.payload=c.candidate->'readModel'
  ORDER BY p.key LIMIT 100`);
await sql.query(`CREATE FUNCTION db01_normal_write_batch(prefix text) RETURNS jsonb LANGUAGE plpgsql AS $bench$
DECLARE sample record; new_id text; stamp text; receipt jsonb; started timestamptz:=clock_timestamp(); n integer:=0;
BEGIN
  FOR sample IN SELECT * FROM db01_write_samples ORDER BY sample_n LOOP
    new_id := 'db01-'||prefix||'-'||sample.sample_n;
    stamp := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    receipt := jsonb_set(jsonb_set(sample.validation_receipt,'{candidateId}',to_jsonb(new_id)),'{validatedAt}',to_jsonb(stamp));
    INSERT INTO civic_data_candidates SELECT (jsonb_populate_record(NULL::civic_data_candidates,
      (to_jsonb(sample)-'sample_n')||jsonb_build_object('id',new_id,'state','FETCHED','validation_receipt',NULL,
        'promoted_version_id',NULL,'last_known_good_version_id',sample.id,'failure_code',NULL,'failure_detail',NULL,
        'candidate',jsonb_set(sample.candidate,'{id}',to_jsonb(new_id))))).*;
    INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES(new_id,1,'FETCHED',sample.retrieved_at,'Production-copy write replay');
    UPDATE civic_data_candidates SET state='NORMALIZED' WHERE id=new_id;
    INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES(new_id,2,'NORMALIZED',sample.retrieved_at,'Production-copy normalization replay');
    UPDATE civic_data_candidates SET state='VALIDATED',validation_receipt=receipt WHERE id=new_id;
    INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES(new_id,3,'VALIDATED',stamp::timestamptz,'Production-copy validation replay');
    UPDATE civic_data_candidates SET state='PROMOTED',promoted_version_id=new_id,last_known_good_version_id=new_id WHERE id=new_id;
    INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES(new_id,4,'PROMOTED',stamp::timestamptz,'Production-copy publication replay');
    UPDATE civic_data_promotions SET current_version_id=new_id,last_known_good_version_id=new_id,promoted_at=stamp::timestamptz,
      payload=sample.candidate->'readModel',validation_receipt=receipt WHERE key=sample.record_class||':'||sample.scope;
    n:=n+1;
  END LOOP;
  RETURN jsonb_build_object('candidates',n,'row_writes',n*9,'server_ms',extract(epoch FROM clock_timestamp()-started)*1000);
END $bench$`);
const triggers = [ ["civic_data_candidates","civic_data_candidate_clock_changed"], ["civic_data_candidate_events","civic_data_event_clock_changed"], ["civic_data_promotions","civic_data_pointer_clock_changed"] ];
const runId = Date.now().toString(36);
const samples: { mode: string; elapsedMs: number; serverMs: number; candidates: number; rowWrites: number }[] = [];
for (let pair=0;pair<5;pair++) for (const mode of pair%2 ? ["with","without"] : ["without","with"]) {
  for (const [table,trigger] of triggers) await sql.query(`ALTER TABLE ${table} ${mode === "with" ? "ENABLE" : "DISABLE"} TRIGGER ${trigger}`);
  const started=performance.now();
  const [row]=await sql.query("SELECT db01_normal_write_batch($1) AS result", [`${runId}-${mode}-${pair}`]);
  samples.push({mode,elapsedMs:performance.now()-started,serverMs:Number(row.result.server_ms),candidates:Number(row.result.candidates),rowWrites:Number(row.result.row_writes)});
}
for (const [table,trigger] of triggers) await sql.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const result={branchId:copy.branchId,method:"Five alternating pairs; 100 real candidate envelopes per batch; full create/normalize/validate/promote and pointer advancement; existing integrity triggers stay enabled; client times include commit and deferred checks; no startup settings",
  samples,withoutTriggersMs:median(samples.filter(row=>row.mode==="without").map(row=>row.elapsedMs)),withTriggersMs:median(samples.filter(row=>row.mode==="with").map(row=>row.elapsedMs))};
await writeFile(outputFile,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
