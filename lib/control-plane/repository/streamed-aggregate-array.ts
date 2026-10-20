import { JsonFileCursor,jsonWatchKey,type JsonSink } from "./json-file-stream.ts";
import { arrayPageLimit } from "./aggregate-array.ts";
import { jsonTextAtPath,type AggregateArrayQuery,type AggregateArrayRetention,type Persisted } from "./types.ts";
import { withHistoryIndex,type HistoryIndex } from "../workers/streamed-history.ts";

interface ScanOptions {
  readonly field?:string|readonly string[];readonly query?:AggregateArrayQuery;
  readonly watch?:readonly (readonly string[])[];
  readonly member?:(ordinal:number,scalars:ReadonlyMap<string,string|null>)=>Promise<void>|void;
  readonly valueProjection?:import("./types.ts").RecordProjection;
  readonly watchRoot?:readonly{readonly path:readonly string[];readonly observe:(value:unknown)=>void}[];
}
const text=(value:unknown)=>value===null||typeof value==='object'?null:String(value);
export async function scanAggregateFile(file:string,options:ScanOptions={}):Promise<Persisted<unknown>&{values:unknown[];next:number|null;nextKey?:string|null;isArray?:boolean}>{
  const cursor=new JsonFileCursor(file),metadata:Record<string,unknown>={},values:unknown[]=[],projected:string[]=[];let isArray=false,sawValue=false,last=options.query?.after??0,scalarValue:unknown;
  const keepsValue=options.valueProjection!==undefined&&Object.keys(options.valueProjection).length>0;
  const limit=options.query?arrayPageLimit(options.query):0;
  const ordered:{key:string;ordinal:number;value:unknown}[]=[];
  try{
    await cursor.value(undefined,undefined,[],{watch:new Map([
      ...["id","revision","updatedAt"].map(key=>[jsonWatchKey([key]),(value:unknown)=>{metadata[key]=value;}] as const),
      ...keepsValue?[[jsonWatchKey(["value"]),(value:unknown)=>{scalarValue=value;}]as const]:[],
      ...options.watchRoot?.map(watch=>[jsonWatchKey(["value",...watch.path]),watch.observe]as const)??[],
    ]),
      start:path=>{if(path.length===1&&path[0]==="value")sawValue=true;},
      objects:async(path,input)=>{
        if(path.length!==1||path[0]!=="value"||options.valueProjection===undefined)return false;
        await input.value(part=>{projected.push(part);},options.valueProjection);return true;
      },
      arrays:async(path,input)=>{
        if(path.length===1&&path[0]==="value"&&keepsValue){await input.value(part=>{projected.push(part);});return true;}
        const field = typeof options.field === "string" ? [options.field] : options.field;
        if(!field||path.length!==field.length+1||path[0]!=="value"||field.some((key,index)=>path[index+1]!==key))return false;
        isArray=true;
        await input.array(async index=>{
          const ordinal=index+1,scalars=new Map<string,string|null>(),parts:string[]=[];
          const wanted=!!options.query&&(options.query.order!==undefined||ordinal>(options.query.after??0)&&values.length<limit);
          const paths=[...options.watch??[],...options.query?.match?[options.query.match.path]:[],...options.query?.order?[options.query.order.path]:[]];
          const watch=new Map(paths.map(path=>[jsonWatchKey(path),(value:unknown)=>{scalars.set(jsonWatchKey(path),text(value));}]));
          await input.value(wanted?part=>{parts.push(part);}:undefined,wanted?options.query?.projection:undefined,[],{watch});
          await options.member?.(ordinal,scalars);
          if(wanted&&(!options.query?.match||scalars.get(jsonWatchKey(options.query.match.path))===options.query.match.value)){
            if(options.query?.order){
              const key=scalars.get(jsonWatchKey(options.query.order.path));
              if(key!==null&&key!==undefined&&(options.query.order.after===undefined||key>options.query.order.after)){
                ordered.push({key,ordinal,value:JSON.parse(parts.join(""))});
                ordered.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:a.ordinal-b.ordinal);if(ordered.length>limit)ordered.pop();
              }
            }else{values.push(JSON.parse(parts.join("")));last=ordinal;}
          }
        });return true;
      }});await cursor.finish();
    if(typeof metadata.id!=="string"||typeof metadata.revision!=="number"||!Number.isSafeInteger(metadata.revision)||metadata.revision<1||typeof metadata.updatedAt!=="string"||!sawValue)throw new Error("Invalid persisted aggregate envelope");
    if(options.query?.order)values.push(...ordered.map(row=>row.value));
    return{id:metadata.id,revision:Number(metadata.revision),updatedAt:metadata.updatedAt,value:projected.length?JSON.parse(projected.join("")):scalarValue!==undefined?scalarValue:{},values,
      next:options.query&&!options.query.order&&values.length===limit?last:null,
      ...options.field?{isArray}:{},
      ...options.query?.order?{nextKey:ordered.length===limit?ordered.at(-1)!.key:null}:{}};
  }finally{await cursor.close();}
}
interface ArrayPatch {field:string;keyPath:readonly string[];key:string;next:unknown|null;retention?:AggregateArrayRetention;fields?:Readonly<Record<string,unknown>>}

/** Copy unrelated fields and strings directly from disk; only array decisions and submitted finite fields are retained. */
export async function rewriteAggregateFile(file:string,out:JsonSink,metadata:Pick<Persisted<unknown>,"id"|"revision"|"updatedAt">,
  fields:Readonly<Record<string,unknown>>,patch?:ArrayPatch):Promise<void>{
  const rewrite=async(db?:HistoryIndex)=>{
    let matches=0,count=0,sourceCount=0;
    if(patch){
      db!.exec("CREATE TABLE decisions(i INTEGER PRIMARY KEY,matched INTEGER NOT NULL,discard INTEGER NOT NULL,oldest TEXT NOT NULL); CREATE TABLE drops(i INTEGER PRIMARY KEY)");
      const insert=db!.prepare("INSERT INTO decisions VALUES(?,?,?,?)");
      const retention=patch.retention,watch=[patch.keyPath,...retention?[retention.discardPath,retention.oldestPath,...retention.discardAlso?[retention.discardAlso.path]:[],...retention.pruneBefore?[retention.pruneBefore.path]:[]]:[]];
      const drop=db!.prepare("INSERT OR IGNORE INTO drops VALUES(?)");
      const account=(ordinal:number,matched:boolean,scalar:(path:readonly string[])=>string|null)=>{
        if(matched)matches++;
        if(matched&&patch.next===null){insert.run(ordinal,1,0,"");return;}
        if(retention?.pruneBefore&&Date.parse(scalar(retention.pruneBefore.path)??"")<Date.parse(retention.pruneBefore.at)){
          insert.run(ordinal,matched?1:0,0,"");drop.run(ordinal);return;
        }
        count++;const discard=!!retention&&scalar(retention.discardPath)===retention.discardValue&&(!retention.discardAlso||scalar(retention.discardAlso.path)===retention.discardAlso.value);
        insert.run(ordinal,matched?1:0,discard?1:0,retention?scalar(retention.oldestPath)??"":"");
      };
      await scanAggregateFile(file,{field:patch.field,watch,member:(ordinal,scalars)=>{
        sourceCount=ordinal;const matched=scalars.get(jsonWatchKey(patch.keyPath))===patch.key;
        account(ordinal,matched,path=>matched?jsonTextAtPath(patch.next,path):scalars.get(jsonWatchKey(path))??null);
      }});
      if(!matches&&patch.next!==null)account(sourceCount+1,false,path=>jsonTextAtPath(patch.next,path));
      if(retention&&count>retention.limit)db!.prepare("INSERT OR IGNORE INTO drops SELECT i FROM decisions WHERE discard=1 ORDER BY oldest,i LIMIT ?").run(count-retention.limit);
    }
    const cursor=new JsonFileCursor(file);let wrote=false;
    await out(`{"id":${JSON.stringify(metadata.id)},"revision":${metadata.revision},"updatedAt":${JSON.stringify(metadata.updatedAt)},"value":`);
    try{
      await cursor.value(undefined,undefined,[],{objects:async(path,input)=>{
        if(path.length!==1||path[0]!=="value")return false;wrote=true;
        const replacements:Record<string,unknown>={...fields,...patch?{...patch.fields??{},updatedAt:metadata.updatedAt}:{}};
        const seen=new Set<string>();
        const writeArray=async()=>{
          let written=0;const emit=async(value:unknown)=>{if(written++)await out(',');await out(JSON.stringify(value));};
          await out('[');
          if(await input.peek()==='[')await input.array(async index=>{
            const ordinal=index+1,row=db!.prepare("SELECT matched FROM decisions WHERE i=?").get(ordinal);
            const dropped=db!.prepare("SELECT i FROM drops WHERE i=?").get(ordinal);
            if(dropped||row?.matched==='1'||Number(row?.matched)===1){await input.value();if(!dropped&&patch!.next!==null)await emit(patch!.next);}
            else{if(written++)await out(',');await input.value(out);}
          });else await input.value();
          if(!matches&&patch!.next!==null&&!db!.prepare("SELECT i FROM drops WHERE i=?").get(sourceCount+1))await emit(patch!.next);
          await out(']');
        };
        await input.object(async(key,emit)=>{
          seen.add(key);
          if(Object.prototype.hasOwnProperty.call(replacements,key)){await input.value();if(emit)await emit(JSON.stringify(replacements[key]));}
          else if(patch&&key===patch.field)await writeArray();
          else await input.value(emit);
        },out,undefined,async append=>{
          for(const [key,value]of Object.entries(replacements))if(!seen.has(key))await append(key,value);
          if(patch&&!seen.has(patch.field)&&!Object.prototype.hasOwnProperty.call(replacements,patch.field)){
            // No old array exists; insertion is its sole possible member.
            const dropped=db!.prepare("SELECT i FROM drops WHERE i=?").get(sourceCount+1);
            await append(patch.field,patch.next===null||dropped?[]:[patch.next]);
          }
        });return true;
      }});await cursor.finish();if(!wrote)throw new Error("Aggregate field merge requires an object value");await out('}\n');
    }finally{await cursor.close();}
  };
  if(patch)await withHistoryIndex(db=>rewrite(db));else await rewrite();
}
