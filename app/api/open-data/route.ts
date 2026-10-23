import { readerRoute } from "@/lib/api/reader-route";
import { NextResponse } from "next/server";
import { readerOpenData } from "@/lib/sources/open-data/reader";
import { jurisdictionFromOcdId } from "@/lib/coverage/states";
export const GET = readerRoute("/api/open-data", async function GET(request:Request) {
  const params=new URL(request.url).searchParams, division=params.get("division"),zip=params.get("zip"),bodyId=params.get("body");
  const offsetText=params.get("offset")??"0",offset=/^\d+$/.test(offsetText)?Number(offsetText):NaN;
  if(!division && !zip || division && !jurisdictionFromOcdId(division) || zip && !/^\d{5}$/.test(zip))return NextResponse.json({error:"A US division or ZIP is required."},{status:400});
  if(!Number.isSafeInteger(offset))return NextResponse.json({error:"A valid page offset is required."},{status:400});
  try {
    const read=await readerOpenData({divisionIds:division?[division]:[],zip,bodyId});
    const records=read.records.slice(offset,offset+50).map(row=>({...row,sourceRow:row.kind==="SOCRATA_DATASET"?
      {resource:{id:row.nativeIds.socrata_id,name:row.title},metadata:{domain:row.nativeIds.domain}}:
      {REGISTRY_ID:row.nativeIds.registry_id,FAC_NAME:row.title}}));
    return NextResponse.json({...read,records,total:read.records.length,nextOffset:offset+records.length<read.records.length?offset+records.length:null},{headers:{"Cache-Control":"no-store"}});
  } catch {return NextResponse.json({records:[],unavailable:["open-data"],notHeld:[]},{status:503});}
});
