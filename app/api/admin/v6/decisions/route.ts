import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { decisionOrders } from "@/lib/control-plane/decision-cards.ts";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const headers={"cache-control":"no-store"};
export async function GET(request:NextRequest):Promise<NextResponse>{
 const guard=await guardAdminRequest({headers:request.headers,cookie:request.cookies.get(ADMIN_SESSION_COOKIE)?.value,checkOrigin:false,nowSeconds:Math.floor(Date.now()/1000)});
 if(!guard.ok)return guard.status===404?new NextResponse(null,{status:404}):NextResponse.json({says:guard.says},{status:guard.status,headers});
 try{
  const opened=await openControlPlane();if(!opened.ok)throw new Error("unread");
  const held=await opened.repos.adminConfig.read(ADMIN_CONFIG_ID);if(held&&!isAdminConfig(held.value))throw new Error("unread");
  return NextResponse.json({cards:decisionOrders(held?.value??null),observedAt:new Date().toISOString()},{headers});
 }catch{return NextResponse.json({says:"The decision cards could not be read just now."},{status:503,headers});}
}
