import { readerRoute } from "@/lib/api/reader-route";
import { seatHolderById } from "@/lib/registry/server";
import { readHeldPersonIdentity } from "@/lib/officials/person-read";
import { statePeopleScopeForId } from "@/lib/officials/people-identity";
import { readBillsForState,readBulkProjection } from "@/lib/sources/legiscan/reader";
import {LEGISCAN_BULK_SCOPE} from "@/lib/sources/legiscan/bills";
export const GET = readerRoute("/api/bills", async function GET(request:Request) {
  const params=new URL(request.url).searchParams,state=params.get("state")?.toUpperCase(),member=params.get("member");
  if(!state||!/^([A-Z]{2})$/.test(state)) return Response.json({error:"A state is required"},{status:400});
  try {
    const person=member?await(statePeopleScopeForId(member)?readHeldPersonIdentity(member):seatHolderById(member)):null;
    if(member&&!person){
      const index=await readBulkProjection(LEGISCAN_BULK_SCOPE);
      return Response.json({bills:[],complete:false,checkedAt:index.kind==="PROMOTED"&&index.value.kind==="INDEX"?index.metadata.retrievedAt:null});
    }
    const read=await readBillsForState(state,person?{person}:{});
    return Response.json({...read,bills:read.bills.sort((a,b)=>(b.statusDate??"").localeCompare(a.statusDate??""))});
  } catch {return Response.json({error:"Bill records are unavailable"},{status:503});}
});
