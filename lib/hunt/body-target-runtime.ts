import {join} from 'node:path';
import {describeWriteContext,assertWriteAllowed} from '../db/write-guard.ts';
import {readerFactDb} from '../facts/db.ts';
import {factClocks} from '../facts/clocks.ts';
import type {AdminConfig} from '../control-plane/gateway/admin-config.ts';
import {ADMIN_CONFIG_ID} from '../control-plane/gateway/admin-config.ts';
import {heldCaptureReader} from '../civic-data/worker-publication-context.ts';
import {DurableEvidenceStore} from '../control-plane/evidence/durable-store.ts';
import {VAULT_DIR} from '../control-plane/scheduler/vault.ts';
import {newFieldManualEntry,writeFieldManual} from '../control-plane/field-manual.ts';
import {sanitizedErrorDiagnostic} from '../ops/error-diagnostic.ts';
import {openControlPlane} from '../control-plane/admin-data.ts';
import type {ControlPlaneRepositories} from '../control-plane/repository/types.ts';
import type {SiteFinding} from './site-findings.ts';
import {ensureHuntBodyTarget} from './body-target.ts';
import {readHuntArtifact} from './capture-reference.ts';

export type PrepareHuntBody=(finding:SiteFinding,origin:{workItemId:string;attemptId:string})=>Promise<void>;
/** Bind sourced body identities only in the live writer runtime. Source-only
 * and production read-only checks retain the finding in the Box without writes. */
export function liveBodyIdentityWritesAllowed():boolean{
 if(process.env.WTP_RUNTIME_MODE!=='production' || !describeWriteContext().allowed || !process.env.DATABASE_URL)return false;
 try{return decodeURIComponent(new URL(process.env.DATABASE_URL).username)!=='readonly';}catch{return false;}
}
export function liveHuntBodyPreparer(input:{repos:ControlPlaneRepositories;root:string;now:()=>string}):PrepareHuntBody|undefined{
 if(!liveBodyIdentityWritesAllowed())return undefined;
 const vault=new DurableEvidenceStore(join(input.root,...VAULT_DIR));
 const facts=readerFactDb();
 let clocks:Promise<ReturnType<typeof factClocks>>|undefined;
 return async(finding,origin)=>{
  if(!['GOV-02','body.name'].includes(finding.field))return;
  try{
  assertWriteAllowed('hunter body identity');
  const sourceWork=finding.sourceWorkItemId??origin.workItemId,sourceAttempt=finding.sourceAttemptId??origin.attemptId;
  const records=(await Promise.all(finding.artifactIds.map(id=>readHuntArtifact(input.repos,sourceWork,id)))).filter(record=>record!==null);
  // This job is appending captures. A previous directory listing is not a
  // snapshot of the source files that have been saved since that read.
  const read=heldCaptureReader(vault);
  for(const record of records){
   if(record.attemptId!==sourceAttempt || !finding.artifactIds.includes(record.artifactId))continue;
   const capture=await read(record);
   if(!capture || capture.httpStatus!==200 || capture.partial)continue;
   await ensureHuntBodyTarget({facts,subjectId:finding.subjectId,name:finding.value,quote:finding.exactQuote,capture,clocks:await (clocks??=(input.repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID,{settings:true}).then(row=>factClocks(row ? row.value as AdminConfig : null)))),now:new Date(input.now())});
   return;
  }
  }catch(error){
   const at=input.now(),why=sanitizedErrorDiagnostic(error);
   await writeFieldManual(input.repos,[newFieldManualEntry('hunt-body-target',finding.subjectId,{role:'SHARED',kind:'SOURCE_PAGE',title:String(finding.value),url:finding.sourceUrl,states:[],ocdIds:[finding.subjectId.split('#')[0]],outcome:'FAILED',summary:`The finding is in the Box; body identity remains open: ${why}`,observedAt:at})],at);
  }
 };
}
/** Exa's existing reporter owns its repositories; open that same durable Box
 * only when a real production run returns a newly named body. */
export async function prepareLiveExaBody(finding:SiteFinding,origin:{workItemId:string;attemptId:string}):Promise<void>{
 if(!['GOV-02','body.name'].includes(finding.field) || !liveBodyIdentityWritesAllowed())return;
 const opened=await openControlPlane();
 if(opened.ok)await liveHuntBodyPreparer({repos:opened.repos,root:process.cwd(),now:()=>new Date().toISOString()})?.(finding,origin);
}
