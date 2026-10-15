/** National bulk rows spill to disk; only one reader partition enters memory at publication. */
import { createReadStream } from "node:fs";
import { mkdtemp, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { OpenDataFact } from "./model.ts";
import type { OpenDataCapture } from "./publication.ts";

/** Source values enter contents; the filesystem boundary creates and owns every path. */
async function temporaryPartition() {
  const root=await mkdtemp(join(tmpdir(),"src-so-partition-"));
  return {append:async(text:string)=>appendFile(join(root,"rows.jsonl"),text),
    read:()=>createInterface({input:createReadStream(join(root,"rows.jsonl")),crlfDelay:Infinity}),
    dispose:()=>rm(root,{recursive:true,force:true})};
}
export const OpenDataSpool={async create() {
  const sinks=new Map<string,{partition:string;state:string|null;sink:Awaited<ReturnType<typeof temporaryPartition>>}>();
  const pending=new Map<string,string[]>();let pendingBytes=0;
  async function flush() {
    for(const [key,lines]of pending)await sinks.get(key)!.sink.append(lines.join(""));
    pending.clear();pendingBytes=0;
  }
  return {
    async append(partition:string,row:OpenDataFact,capture:Omit<OpenDataCapture,"sourceRows">) {
      const key=JSON.stringify([row.state,partition]);
      if(!sinks.has(key))sinks.set(key,{partition,state:row.state,sink:await temporaryPartition()});
      const {sourceRows:_sourceRows,...metadata}=capture as OpenDataCapture;
      const line=JSON.stringify({row,capture:metadata})+"\n",lines=pending.get(key)??[];
      lines.push(line);pending.set(key,lines);pendingBytes+=Buffer.byteLength(line);
      if(pendingBytes>=8*1024*1024)await flush();
    },
    async *partitions():AsyncGenerator<{partition:string;rows:OpenDataFact[];captures:OpenDataCapture[]}> {
      await flush();
      for(const {partition,sink}of [...sinks.values()].sort((a,b)=>(a.state??"").localeCompare(b.state??"")||a.partition.localeCompare(b.partition))) {
        const records=new Map<string,OpenDataFact>(),captures=new Map<string,OpenDataCapture>();
        for await(const line of sink.read()) {
          const {row,capture}=JSON.parse(line) as {row:OpenDataFact;capture:Omit<OpenDataCapture,"sourceRows">};
          if(records.has(row.id))throw Error(`Repeated native source ID in ${partition}: ${row.id}`);
          records.set(row.id,row);
          const key=JSON.stringify(capture),prior=captures.get(key);
          if(prior)(prior.sourceRows as Record<string,unknown>[]).push(row.sourceRow);
          else captures.set(key,{...capture,sourceRows:[row.sourceRow]});
        }
        yield {partition,rows:[...records.values()],captures:[...captures.values()]};
      }
    },
    async dispose() { for(const {sink}of sinks.values())await sink.dispose(); },
  };
}};
