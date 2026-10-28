import {readerRoute} from "@/lib/api/reader-route";
import {matching,refuse,rejectUnknown} from "@/lib/api/params";
import {factReader} from "@/lib/facts/db";
import {readSavedBodyRoster} from "@/lib/reader/body-roster";
import {readerPlaceCacheHeaders} from "@/lib/reader/cache";

export const runtime='nodejs';

/** Opening a body reads the one membership answer its page builder saved. */
export const GET=readerRoute('/api/reader/roster',async(request:Request)=>{
  const params=new URL(request.url).searchParams,unknown=rejectUnknown(params,['body']);
  if(!unknown.ok)return refuse(unknown.error);
  const body=matching(params,'body',/^.{1,512}$/,{default:null});
  if(!body.ok)return refuse(body.error);
  if(!body.value)return refuse('body is required');
  try{
    const query=factReader();
    if(!query)throw new Error('FACT_STORE_DATABASE_URL_MISSING');
    const saved=await readSavedBodyRoster(query,body.value);
    if(!saved)return Response.json({error:"This body's members could not be loaded"},{status:404,headers:{'Cache-Control':'no-store'}});
    return Response.json(saved.roster,{headers:{...readerPlaceCacheHeaders([saved.id]),"Netlify-Vary": "query=body"}});
  }catch(error){
    console.error('READER_ROSTER_LOAD_FAILED',error);
    return Response.json({error:"This body's members could not be loaded"},{status:503,headers:{'Cache-Control':'no-store'}});
  }
});
