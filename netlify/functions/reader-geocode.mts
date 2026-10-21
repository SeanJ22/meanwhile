/** The existing public-office/address proxy, without starting the Next page server. */
import {POST} from "../../app/api/geocode/route.ts";
import {isAdminHostRequest} from "../../lib/control-plane/admin-auth.ts";
import {ADMIN_ORIGIN} from "../../lib/ops/origins.ts";

export default async function readerGeocode(request:Request):Promise<Response> {
  if(isAdminHostRequest(request.headers,ADMIN_ORIGIN))return new Response(null,{status:404,headers:{"x-robots-tag":"noindex, nofollow, noarchive"}});
  const response=await POST(request);
  response.headers.set("x-robots-tag","noindex, nofollow, noarchive");
  return response;
}

export const config={path:"/api/geocode",method:"POST"};
