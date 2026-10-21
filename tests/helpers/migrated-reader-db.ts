import {readFileSync} from "node:fs";
import {canonicalCivicDataHash} from "../../lib/civic-data/canonical-hash.ts";
import {PGlite} from "@electric-sql/pglite";
import {VALIDATION_CHECKS, type RoutineRecordClass} from "../../lib/civic-data/types.ts";

/** Reader SQL runs against every real production migration, including constraints and triggers. */
export async function migratedReaderDb() {
  const pg = new PGlite();
  const migrations = new URL("../../lib/db/migrations/",import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json",migrations),"utf8")) as {entries:{tag:string}[]};
  for (const {tag} of journal.entries) await pg.exec(readFileSync(new URL(`${tag}.sql`,migrations),"utf8"));
  const publish = async ({id,value,at,recordClass,scope,sourceId,payloadHash}: {id:string;value:unknown;at:string;recordClass:RoutineRecordClass;scope:string;sourceId:string;payloadHash?:string}) => {
    const key = `${recordClass}:${scope}`, hash = payloadHash ?? canonicalCivicDataHash(value);
    const receipt = {contractVersion:2,decision:"GOOD",candidateId:id,sourceId,recordClass,scope,validatedAt:at,
      checks:VALIDATION_CHECKS.map(check=>({check,verdict:"PASS",code:"HELD",detail:"Metadata fixture"})),excludedFacts:[]};
    const candidate = {id,sourceId,recordClass,scope,identities:[],readModel:value,
      retrieval:{succeeded:true,retrievedAt:at,rawHash:null},normalization:{parserVersion:"metadata-test",normalizedHash:hash},
      temporal:{sourceThrough:"2026-10-19"}};
    await pg.transaction(async tx => {
      await tx.query(`INSERT INTO civic_data_candidates
        (id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,source_through,parser_version,identity,candidate,
         validation_receipt,promoted_version_id,last_known_good_version_id,normalized_hash)
        VALUES($1,$6,$7,$2,'PROMOTED',true,$3,'2026-10-19','metadata-test','[]',$4,$5,$1,$1,$8)`,
      [id,scope,at,JSON.stringify(candidate),JSON.stringify(receipt),sourceId,recordClass,hash]);
      for (const [index,state] of ["FETCHED","NORMALIZED","VALIDATED","PROMOTED"].entries()) {
        await tx.query(`INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES($1,$2,$3,$4,'Metadata fixture')`,[id,index+1,state,at]);
      }
      await tx.query(`INSERT INTO civic_data_promotions
        (key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
        VALUES($1,$7,$8,$2,$3,$3,$4,$5,$6)
        ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,last_known_good_version_id=excluded.last_known_good_version_id,
          promoted_at=excluded.promoted_at,payload=excluded.payload,validation_receipt=excluded.validation_receipt`,
      [key,scope,id,at,JSON.stringify(value),JSON.stringify(receipt),sourceId,recordClass]);
    });
  };
  return {pg,publish};
}
