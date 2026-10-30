import { LEGISTAR_COUNTS_DDL } from "../../lib/control-plane/repository/migrations/SPN-01B.ts";
import { WORK_DDL, workList } from "../../lib/core/work.ts";
import { enqueueLegistarMemberRecords } from "../../lib/sources/legistar/members-loader.ts";
import { legistarMemberPublisher } from "../../lib/sources/legistar/members-worker.ts";
import { legistarMembersPackage } from "../../lib/sources/legistar/members-publication.ts";
import type { factDb } from "./fact-db.ts";

type Db=Awaited<ReturnType<typeof factDb>>;
const ready=new WeakMap<Db,Promise<void>>();
export async function memberCore(db:Db,now:()=>Date) {
  let installed=ready.get(db);
  if(!installed){installed=(async()=>{for(const ddl of WORK_DDL)await db.pg.exec(ddl);})();ready.set(db,installed);}
  await installed;
  return workList(db.query,{owner:"member-test",leaseMs:300_000,now});
}
export async function publishLegistarFixture(input:Omit<Parameters<typeof enqueueLegistarMemberRecords>[0],"work">&{
  facts:Db;clocks:Parameters<typeof legistarMemberPublisher>[0]["clocks"];purge?:Parameters<typeof legistarMemberPublisher>[0]["purge"]}) {
  const work=await memberCore(input.facts,()=>new Date(input.now));
  const loaded=await enqueueLegistarMemberRecords({...input,work});
  const publisher=legistarMemberPublisher(input);let held=0,live=0;
  while(true){const claims=await work.claim("check",100,"legistar-members:");if(!claims.length)break;
    for(const claim of claims){const out=await publisher(claim.value as Parameters<typeof publisher>[0],input.now);live+=out.published;
      if(out.refused){held++;await work.refuse(claim,out.refused);}else await work.finish(claim);}}
  return {...loaded,members:legistarMembersPackage(input.raw,input.rows,input.now).members,held,live};
}
export const memberCountsSql=()=>LEGISTAR_COUNTS_DDL.join(";\n");
