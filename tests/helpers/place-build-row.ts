import {PLACE_PACKAGE_SQL} from "../../lib/reader/place-builder.ts";
import type {Query} from "../../lib/facts/publish.ts";

/** Queue and territory fixtures replace only the source selection; the fingerprint, transfer and saved-page SQL run unchanged. */
export function fixturePlaceBuild(query:Query,text:string,params:readonly unknown[]|undefined,row:Record<string,unknown>) {
  const columns=Object.entries(row).map(([key,value])=>{
    if(!/^[a-z_]+$/.test(key))throw Error("Invalid fixture column");
    return `'${JSON.stringify(value).replaceAll("'","''")}'::jsonb AS ${key}`;
  });
  const types=['text','text[]','text[]','text','boolean','boolean','boolean','text[]','boolean','text[]','text'];
  const input=`SELECT ${columns.join(',')} FROM (SELECT ${types.map((type,i)=>`$${i+1}::${type} AS p${i}`).join(',')}) parameters`;
  return query(text.replace(PLACE_PACKAGE_SQL,input),params);
}
