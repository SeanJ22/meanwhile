import { NextResponse,type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { openControlPlane } from "../admin-data.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { readAssignmentCyclePage } from "../expansion/assignment-reading.ts";
import { readFreshnessReportPage,readFreshnessTextReportPage } from "./freshness-report-read.ts";

const NO_STORE={"cache-control":"private, no-store, max-age=0"};
export function validateFreshnessReportQuery(params:URLSearchParams):
  {readonly ok:true;readonly cycleId:string|null;readonly page:number;readonly section:"incidents"|"runtimeConditions"|"lines"|"assignments"}|{readonly ok:false;readonly code:string}{
  if([...params.keys()].some(key=>key!=="cycleId"&&key!=="page"&&key!=="section"))return{ok:false,code:"UNKNOWN_PARAMETER"};
  if(params.getAll("cycleId").length>1||params.getAll("page").length>1||params.getAll("section").length>1)return{ok:false,code:"DUPLICATE_PARAMETER"};
  const cycleId=params.get("cycleId"),page=params.get("page")??"0",section=params.get("section")??"incidents";
  if(cycleId!==null&&(!/^freshness-cycle:[A-Za-z0-9._:-]+$/.test(cycleId)||cycleId.length>240))return{ok:false,code:"INVALID_CYCLE"};
  if(!/^(0|[1-9][0-9]*)$/.test(page)||!Number.isSafeInteger(Number(page)))return{ok:false,code:"INVALID_PAGE"};
  if(section!=="incidents"&&section!=="runtimeConditions"&&section!=="lines"&&section!=="assignments")return{ok:false,code:"INVALID_SECTION"};
  return{ok:true,cycleId,page:Number(page),section};
}

/** An authenticated, on-demand page from a recorded cycle. No production writes. */
export async function v6FreshnessReportGet(request:NextRequest,deps:{readonly open?:typeof openControlPlane}={}):Promise<NextResponse>{
  const guard=await guardAdminRequest({headers:request.headers,cookie:request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin:false,nowSeconds:Math.floor(Date.now()/1000)});
  if(!guard.ok)return guard.status===404?new NextResponse(null,{status:404,headers:NO_STORE}):NextResponse.json({says:guard.says},{status:guard.status,headers:NO_STORE});
  const query=validateFreshnessReportQuery(request.nextUrl.searchParams);
  if(!query.ok)return NextResponse.json({code:query.code},{status:400,headers:NO_STORE});
  try{
    const opened=await(deps.open??openControlPlane)();
    if(!opened.ok)return NextResponse.json({says:"The freshness report store could not be read."},{status:503,headers:NO_STORE});
    const read=query.section==="incidents"?await readFreshnessReportPage(opened.repos,query):
      query.section==="assignments"?await readAssignmentCyclePage(opened.repos,query):await readFreshnessTextReportPage(opened.repos,{...query,section:query.section});
    return read.kind==="READ"?NextResponse.json(read.value,{headers:NO_STORE}):NextResponse.json({says:read.says},{status:read.kind==="UNAVAILABLE"?503:404,headers:NO_STORE});
  }catch{return NextResponse.json({says:"This report page could not be read just now. Its contents are unknown, not empty."},{status:503,headers:NO_STORE});}
}
