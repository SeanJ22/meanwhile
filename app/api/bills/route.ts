import { readerRoute } from "@/lib/api/reader-route";
import { seatHolderById } from "@/lib/registry/server";
import { readBillsForState } from "@/lib/sources/legiscan/reader";
export const GET = readerRoute("/api/bills", async function GET(request:Request) {
  const params=new URL(request.url).searchParams,state=params.get("state")?.toUpperCase(),member=params.get("member");
  if(!state||!/^([A-Z]{2})$/.test(state)) return Response.json({error:"A state is required"},{status:400});
  try {
    const person=member?await seatHolderById(member):null;
    const read=await readBillsForState(state,person?{person}:{});
    if(member&&!person) return Response.json({bills:[],complete:false,checkedAt:read.checkedAt});
    return Response.json({...read,bills:read.bills.sort((a,b)=>(b.statusDate??"").localeCompare(a.statusDate??""))});
  } catch {return Response.json({error:"Bill records are unavailable"},{status:503});}
});
