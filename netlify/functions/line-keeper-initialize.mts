import { seedLineKeeper } from "../../lib/control-plane/line-keeper/runtime.ts";
export const config={background:true};
/** Remove the retired inventory after a production deploy; the hourly job reads the writer counters. */
export function isPublishedProductionDeploy(event:{deploy:{context?:string;publishedAt?:string|null}}):boolean {
  return event.deploy.context==="production"&&typeof event.deploy.publishedAt==="string"&&Number.isFinite(Date.parse(event.deploy.publishedAt));
}
const initializer={
  async deploySucceeded(event:{deploy:{context?:string;publishedAt?:string|null}}):Promise<void> {
    if(!isPublishedProductionDeploy(event)) return;
    await seedLineKeeper();
  },
};
export default initializer;
