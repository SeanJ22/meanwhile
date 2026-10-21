/** Serve the same reader handler without starting the unrelated Next page server. */
import {withResponseLifetime} from "../../lib/log/after-response.ts";
import {isAdminHostRequest} from "../../lib/control-plane/admin-auth.ts";
import {ADMIN_ORIGIN} from "../../lib/ops/origins.ts";
const reader = import("../../app/api/meetings/route.ts");

export default async function readerMeetings(request: Request, context:{waitUntil(work:Promise<unknown>):void}): Promise<Response> {
  if(isAdminHostRequest(request.headers,ADMIN_ORIGIN))return new Response(null,{status:404,headers:{"x-robots-tag":"noindex, nofollow, noarchive"}});
  const {GET}=await reader;
  const response=await withResponseLifetime(work=>context.waitUntil(work),()=>GET(request));
  response.headers.set("x-wtp-reader-runtime","native");
  response.headers.set("x-robots-tag","noindex, nofollow, noarchive");
  return response;
}

export const config = {path:"/api/meetings",method:"GET"};
