import { hourlyLineKeeper } from "../../lib/control-plane/line-keeper/runtime.ts";
import { withResponseLifetime } from "../../lib/log/after-response.ts";
import { flushDatabaseTransfer } from "../../lib/db/transfer.ts";
/** Five minutes past every hour, including overnight. Runs on Netlify with the runner offline. */
export const config = { schedule: "5 * * * *", background:true };
export default async function lineKeeper(_request?:Request,context?:{waitUntil(work:Promise<unknown>):void}):Promise<Response> {
  await (context ? withResponseLifetime(work=>context.waitUntil(work),()=>hourlyLineKeeper()) : hourlyLineKeeper());
  await flushDatabaseTransfer();
  return new Response(null,{status:204});
}
