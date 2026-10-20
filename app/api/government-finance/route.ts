import { readerRoute } from "@/lib/api/reader-route";
import { NextResponse } from "next/server";
import { readGovernmentBudgets } from "@/lib/civic-data/government-budgets";
import { scopedManualContractScope } from "@/lib/civic-data/scoped-manual-contracts";

export const GET = readerRoute("/api/government-finance", async function GET(request:Request) {
  const query=new URL(request.url).searchParams,division=query.get("division")??"",bodyId=query.get("body")??"";
  try {scopedManualContractScope("government-budgets",division);if(!bodyId)throw new Error("missing body");}
  catch{return NextResponse.json({error:"A US division and body are required."},{status:400});}
  try {
    const read=await readGovernmentBudgets(division);
    if(read.kind==="STORE_UNREACHABLE")return NextResponse.json({status:"UNAVAILABLE",records:[]},{status:503});
    return NextResponse.json({division,bodyId,status:read.kind==="PROMOTED"?"HELD":"NOT_HELD",
      records:read.kind==="PROMOTED"?read.value.records.filter(row=>row.bodyId===bodyId):[],versionId:read.metadata.versionId},
      {headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({status:"UNAVAILABLE",records:[]},{status:503});}
});
