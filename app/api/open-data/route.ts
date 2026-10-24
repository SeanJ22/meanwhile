import { readerRoute } from "@/lib/api/reader-route";
import { NextResponse } from "next/server";
import { readerOpenData,OpenDataCursorError } from "@/lib/sources/open-data/reader";
import { jurisdictionFromOcdId } from "@/lib/coverage/states";
import { openDataReaderRecord } from "@/lib/sources/open-data/model";
export const GET = readerRoute("/api/open-data", async function GET(request:Request) {
  const params=new URL(request.url).searchParams, division=params.get("division"),zip=params.get("zip"),bodyId=params.get("body");
  const cursor=params.get("cursor");
  if(!division && !zip || division && !jurisdictionFromOcdId(division) || zip && !/^\d{5}$/.test(zip))return NextResponse.json({error:"A US division or ZIP is required."},{status:400});
  try {
    const read=await readerOpenData({divisionIds:division?[division]:[],zip,bodyId,cursor});
    return NextResponse.json({...read,records:read.records.map(openDataReaderRecord)},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if(error instanceof OpenDataCursorError)return NextResponse.json({reset:error.reason==="CHANGED",error:error.message},{status:error.reason==="CHANGED"?409:400});
    return NextResponse.json({records:[],unavailable:["open-data"],notHeld:[]},{status:503});
  }
});
