/** Admin-only readings. An off alerts switch needs only a point read, never a full brief. */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { openControlPlane } from "../admin-data.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { ALERTS_ON_SETTING, readSetting } from "../settings.ts";
import { readReports } from "../reports/read-reports.ts";
import { readBrief, readerProblemRows } from "./brief.ts";
const headers={"cache-control":"no-store"};
export async function briefGet(request:NextRequest,which:"brief"|"alerts"|"daily-brief"|"reader-problems"):Promise<NextResponse>{
 const guard=await guardAdminRequest({headers:request.headers,cookie:request.cookies.get(ADMIN_SESSION_COOKIE)?.value,checkOrigin:false,nowSeconds:Math.floor(Date.now()/1000)});
 if(!guard.ok)return guard.status===404?new NextResponse(null,{status:404}):NextResponse.json({says:guard.says},{status:guard.status,headers});
 try{
  const at=new Date().toISOString();
  if(which==="reader-problems") {const reports=await readReports(at);return NextResponse.json({rows:readerProblemRows(reports),unread:reports.sites.some(s=>s.kind==="UNREADABLE"),observedAt:at},{headers});}
  const opened=await openControlPlane();if(!opened.ok)throw new Error("unread");
  if(which==="brief")return NextResponse.json(await readBrief(opened.repos,at),{headers});
  const held=await opened.repos.adminConfig.read(ADMIN_CONFIG_ID);if(held&&!isAdminConfig(held.value))throw new Error("unread");
  if(which==="daily-brief")return NextResponse.json({latest:held?.value.latestBrief??null,observedAt:at},{headers});
  const on=readSetting(held?.value??null,ALERTS_ON_SETTING,false);
  return NextResponse.json({on,alerts:on?(await readBrief(opened.repos,at)).fresh.alerts:[],observedAt:at},{headers});
 }catch{return NextResponse.json({says:"The brief could not be read just now."},{status:503,headers});}
}
