import { join } from "node:path";
import { readerFactDb,preparedStatement } from "../lib/facts/db.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "../lib/ops/neon-request-deadline.ts";
import { legistarMemberWork,seedLegistarMemberWork } from "../lib/sources/legistar/members-queue.ts";
import { loadLegistarMemberTenant,type MemberRecordWork } from "../lib/sources/legistar/members-loader.ts";
import { legistarMemberPublisher } from "../lib/sources/legistar/members-worker.ts";
import { HICCUPS_BEFORE_STOPPING,newMemberStats,runLegistarMemberWorkers } from "../lib/sources/legistar/members-work.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { withFactConfirmations } from "../lib/facts/confirmation.ts";
import { controlPlaneQuery } from "../lib/core/work.ts";
import { askOnRelease,laneTurn,slotOrLeave } from "../lib/ops/lane-turn.ts";

prepareProductionCivicDataWrite();
const load=newMemberStats(),check=newMemberStats(),both=(key:keyof typeof load)=>load[key]+check[key];
const turn=laneTurn(()=>`Legistar members: ${both("claimed")} claimed, ${both("done")} done, ${both("released")} released, ${both("failed")} failed`);
askOnRelease(turn.ask);
// A database request settles within STANDING_NEON_REQUEST_DEADLINE_MS: claiming stops two before the pass deadline, work still running one before.
const turnEndAt=passDeadlineFromEnv()-STANDING_NEON_REQUEST_DEADLINE_MS,pause=()=>new Promise(done=>setTimeout(done,5_000));
const stopRequested=()=>turn.stop()||Date.now()>=turnEndAt-STANDING_NEON_REQUEST_DEADLINE_MS;
const turnEnd=Number.isFinite(turnEndAt)?AbortSignal.timeout(Math.max(1,turnEndAt-Date.now())):undefined;
const slots=routineProcessSlots({admissionsOpen:()=>!stopRequested()});
const release=await slotOrLeave(slots.acquire("legistar-members-worker.mts",Date.now()+60_000));
try {
  const query=controlPlaneQuery(),connection=readerFactDb(),list=legistarMemberWork(query,`legistar-members:${process.pid}`);
  const facts={query:connection.query,transaction:<T,>(work:(query:typeof connection.query)=>Promise<T>)=>connection.transaction(query=>work((text,params)=>query(preparedStatement(text),params)))};
  const vault=new DurableEvidenceStore(join(process.cwd(),...VAULT_DIR));
  await seedLegistarMemberWork(list,query);
  let adminVersion:string|undefined,clocks=factClocks(null);
  const settings=async()=>{
    const [row]=await query(`SELECT md5((value->'settings')::text) AS version, jsonb_build_object('settings',jsonb_build_object('facts.freshnessHours',value#>'{settings,facts.freshnessHours}',
      'facts.retryMinutes',value#>'{settings,facts.retryMinutes}')) AS value FROM cp_admin_config WHERE id='current'`);
    if(row?.version===adminVersion)return false;
    clocks=factClocks((row?.value??null) as Parameters<typeof factClocks>[0]);adminVersion=String(row?.version);return true;
  };
  await settings();
  let publish=legistarMemberPublisher({facts,vault,clocks});
  const heartbeat=setInterval(()=>turn.beat(),60_000);
  const seed=setInterval(()=>{void seedLegistarMemberWork(list,query).then(settings).then(changed=>{if(changed)publish=legistarMemberPublisher({facts,vault,clocks});}).catch(error=>{console.error(error);turn.ask();});},60_000);
  try {
    await Promise.all([
      runLegistarMemberWorkers({list,kind:"load",concurrency:2,stats:load,stopRequested,turnEnd,sleep:ms=>new Promise(done=>setTimeout(done,ms)),log:console.error,
        run:async(claim,signal)=>{await loadLegistarMemberTenant({facts,doors:query,work:list,vault,slug:claim.subjectId!.slice("legistar-members:".length),now:new Date().toISOString(),signal});}}),
      (async()=>{let hiccups=0;while(!stopRequested()){
        try {
          // Each saved response shares one check time in this turn, so unchanged fields are confirmed together, not one transaction per record.
          const checkedAt=new Map<string,string>();
          const before=check.claimed;
          await withFactConfirmations(facts,()=>runLegistarMemberWorkers({list,kind:"check",concurrency:4,maxClaims:100,stats:check,stopRequested,turnEnd,log:console.error,
            run:async(claim,signal)=>{
              signal.throwIfAborted();const value=claim.value as MemberRecordWork,key=`${value.source.copyId}:${value.source.artifact.retrievedAt}`;
              if(!checkedAt.has(key))checkedAt.set(key,new Date().toISOString());
              return publish(value,checkedAt.get(key)!);
            }}));
          hiccups=0;if(check.claimed===before)await pause();
        } catch(error) {
          // One failed batch is logged and the turn goes on; the list still holds whatever is owed.
          console.error(sanitizedErrorDiagnostic(error));if(++hiccups>=HICCUPS_BEFORE_STOPPING)throw error;await pause();
        }
      }})(),
    ]);
  }finally{clearInterval(heartbeat);clearInterval(seed);}
}finally{release();}
process.exit(0); // cut-off work may still hold a connection
