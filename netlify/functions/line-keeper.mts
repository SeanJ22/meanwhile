import { hourlyLineKeeper } from "../../lib/control-plane/line-keeper/runtime.ts";
/** Five minutes past every hour, including overnight. Runs on Netlify with the runner offline. */
export const config = { schedule: "5 * * * *", background:true };
export default async function lineKeeper():Promise<Response> {
  await hourlyLineKeeper();
  return new Response(null,{status:204});
}
