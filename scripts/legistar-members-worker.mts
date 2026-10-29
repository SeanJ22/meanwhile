import { join } from "node:path";
import { readerFactDb,preparedStatement } from "../lib/facts/db.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { legistarDoorQuery,legistarMemberWork,seedLegistarMemberWork } from "../lib/sources/legistar/members-queue.ts";
import { loadLegistarMemberTenant,type MemberRecordWork } from "../lib/sources/legistar/members-loader.ts";
import { legistarMemberPublisher } from "../lib/sources/legistar/members-worker.ts";
import { runLegistarMemberWorkers } from "../lib/sources/legistar/members-work.ts";
import { withFactConfirmations } from "../lib/facts/confirmation.ts";

prepareProductionCivicDataWrite();
let drain=false;
process.on("SIGTERM",()=>{drain=true;});
process.on("message",message=>{if(message&&typeof message==="object"&&"kind"in message&&message.kind==="RUNTIME_RELEASE_DRAIN")drain=true;});
const stopRequested=()=>drain||Date.now()>=passDeadlineFromEnv();
const slots=routineProcessSlots({admissionsOpen:()=>!stopRequested()});
const release=await slots.acquire("legistar-members-worker.mts",Date.now()+60_000);
try {
  const query=legistarDoorQuery(),connection=readerFactDb(),list=legistarMemberWork(query,`legistar-members:${process.pid}`);
  const facts={query:connection.query,transaction:<T,>(work:(query:typeof connection.query)=>Promise<T>)=>
    connection.transaction(query=>work((text,params)=>query(preparedStatement(text),params)))};
  const vault=new DurableEvidenceStore(join(process.cwd(),...VAULT_DIR));
  await seedLegistarMemberWork(query);
  let adminVersion:string|undefined,clocks=factClocks(null);
  const settings=async()=>{
    const [row]=await query(`SELECT md5((value->'settings')::text) AS version FROM cp_admin_config WHERE id='current'`);
    if(row?.version!==adminVersion){
      const [admin]=await query(`SELECT jsonb_build_object('settings',jsonb_build_object('facts.freshnessHours',value#>'{settings,facts.freshnessHours}',
        'facts.retryMinutes',value#>'{settings,facts.retryMinutes}')) AS value FROM cp_admin_config WHERE id='current'`);
      clocks=factClocks((admin?.value??null) as Parameters<typeof factClocks>[0]);adminVersion=String(row?.version);return true;
    }
    return false;
  };
  await settings();
  let publish=legistarMemberPublisher({facts,vault,clocks});
  const heartbeat=setInterval(()=>{console.log("Legistar members: workers running");},60_000);
  const seed=setInterval(()=>{void seedLegistarMemberWork(query).then(settings).then(changed=>{if(changed)publish=legistarMemberPublisher({facts,vault,clocks});})
    .catch(error=>{console.error(error);drain=true;});},60_000);
  try {
    await Promise.all([
      runLegistarMemberWorkers({list,kind:"load",concurrency:2,stopRequested,sleep:ms=>new Promise(done=>setTimeout(done,ms)),log:console.error,
        run:async(claim,signal)=>{await loadLegistarMemberTenant({facts,doors:query,work:list,vault,slug:claim.subjectId!.slice("legistar-members:".length),now:new Date().toISOString(),signal});}}),
      (async()=>{while(!stopRequested()){
        // Each saved response shares one check time in this turn, so unchanged fields
        // are confirmed together rather than opening one confirmation transaction per record.
        const checkedAt=new Map<string,string>();
        const stats=await withFactConfirmations(facts,()=>runLegistarMemberWorkers({list,kind:"check",concurrency:4,maxClaims:100,stopRequested,log:console.error,
          run:async(claim,signal)=>{
            signal.throwIfAborted();const value=claim.value as MemberRecordWork;
            const key=`${value.source.copyId}:${value.source.artifact.retrievedAt}`;
            if(!checkedAt.has(key))checkedAt.set(key,new Date().toISOString());
            return publish(value,checkedAt.get(key)!);
          }}));
        if(!stats.claimed)await new Promise(done=>setTimeout(done,5_000));
      }})(),
    ]);
  }finally{clearInterval(heartbeat);clearInterval(seed);}
}finally{release();}
