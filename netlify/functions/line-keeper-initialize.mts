import { importRuntimeKeys } from "../../lib/core/keys-import.ts";
import { seedLineKeeper } from "../../lib/control-plane/line-keeper/runtime.ts";
import { flushDatabaseTransfer } from "../../lib/db/transfer.ts";
export const config={background:true};
/** Take the first compact reading after a production deploy; the hourly schedule keeps it current. */
export function isPublishedProductionDeploy(event:{deploy:{context?:string;publishedAt?:string|null;commitRef?:string}}):boolean {
  return event.deploy.context==="production"&&typeof event.deploy.publishedAt==="string"&&Number.isFinite(Date.parse(event.deploy.publishedAt));
}
const initializer={
  async deploySucceeded(event:{deploy:{context?:string;publishedAt?:string|null;commitRef?:string}},
    copy:()=>Promise<void>=()=>importRuntimeKeys({...process.env,COMMIT_REF:event.deploy.commitRef??process.env.COMMIT_REF},"website",new Date().toISOString()), seed:()=>Promise<unknown>=seedLineKeeper):Promise<void> {
    if(event.deploy.context!=="production") return;
    const results=await Promise.allSettled([copy(),isPublishedProductionDeploy(event)?seed():Promise.resolve()]);
    await flushDatabaseTransfer();
    if(results.some(result=>result.status==="rejected")) throw new Error("The production key copy or first line reading could not finish.");
  },
};
export default initializer;
