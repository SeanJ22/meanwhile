import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
import { runtimeCivicReadCache,type CivicReadCache } from "../../db/civic-read-cache.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import type { ArchiveSourceOpen } from "../archive-download.ts";
import { streamCsvObjects } from "../prl/streaming.ts";
import { readOpenDataPartition,saveOpenDataPartition } from "./artifacts.ts";
import { echoMinimumGap,type EchoMinimumGap } from "./echo-gaps.ts";
import { OPEN_DATA_PARSER,type OpenDataPartitionRef,type OpenDataReport } from "./model.ts";
import { normalizeEcho } from "./normalize.ts";
import type { OpenDataCapture } from "./publication.ts";
import { OpenDataSpool } from "./spool.ts";

export interface EchoProjectionProgress {
  readonly context:string;
  readonly position:number;
  readonly partitions:readonly OpenDataPartitionRef[];
  readonly replaced:readonly string[];
  readonly reports:readonly OpenDataReport[];
}
interface EchoSourceProgress {
  readonly formatVersion:1;
  readonly context:string;
  readonly position:number;
  readonly records:number;
  readonly complete:boolean;
  readonly slices:readonly OpenDataPartitionRef[];
  readonly gaps:readonly EchoMinimumGap[];
  readonly projection?:EchoProjectionProgress;
}
const NAMESPACE="source-probe-progress:v1",KEY="epa-echo:national";
const hash=(value:unknown)=>createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex");
const SOURCE_CHUNK_ROWS=10_000;

/** Source work already acquired by this standing job. Only exact archive bytes and the parser can reuse its cursor. */
export async function echoSourceProgress(input:{archive:ArchiveSourceOpen;capture:OpenDataCapture;vault:EvidenceStore;signal:AbortSignal;
  now:()=>string;progress?:CivicReadCache}) {
  const cache=input.progress??runtimeCivicReadCache().jobState();
  const context=hash([OPEN_DATA_PARSER,input.archive.sourceSha256,input.archive.member,input.archive.publishedAt,input.archive.retrievedAt]);
  const held=await cache.readCheckpoint<EchoSourceProgress>(NAMESPACE,KEY);
  let state:EchoSourceProgress=held?.formatVersion===1&&held.context===context?held:
    {formatVersion:1,context,position:0,records:0,complete:false,slices:[],gaps:[]};
  const save=async()=>cache.checkpoint(NAMESPACE,KEY,state);
  return {
    projection:()=>state.projection,
    async saveProjection(projection:EchoProjectionProgress){state={...state,projection};await save();},
    async clearProjection(){const {projection:_projection,...source}=state;state=source;await save();},
    async acquire() {
      if(state.complete) {
        // Kept minimum-fact gaps remain ordinary retry work, even when the source bytes match.
        if(!state.gaps.length)return;
        const spool=await OpenDataSpool.create(),gaps:EchoMinimumGap[]=[],slices=[...state.slices];
        let recovered=0;
        try {
          for(const heldGap of state.gaps) {
            input.signal.throwIfAborted();
            const record=heldGap.fact.record as {sourceRow?:Record<string,unknown>}|undefined,raw=record?.sourceRow;
            if(!raw)throw Error("EPA minimum-fact retry has no captured source row.");
            const gap=echoMinimumGap(raw);
            if(gap)gaps.push(gap);
            else {await spool.append("source",normalizeEcho(raw,input.archive.retrievedAt,input.archive.publishedAt),input.capture);recovered++;}
          }
          if(recovered)for await(const partition of spool.partitions({consume:true,maxRows:1000,maxBytes:4*1024*1024}))
            slices.push(await saveOpenDataPartition({source:"epa-echo",...partition,partition:`source:${slices.length}`,now:input.now()},input.vault));
          const {projection,...source}=state;
          state={...source,records:state.records+recovered,gaps,slices,...(!recovered&&projection?{projection}:{})};await save();
        } finally {await spool.dispose();}
        return;
      }
      let spool=await OpenDataSpool.create(),position=state.position,records=state.records;
      const slices=[...state.slices],gaps=[...state.gaps];
      let pending=0,flushing=false;
      const flush=async()=>{
        if(!pending)return;
        flushing=true;
        for await(const partition of spool.partitions({consume:true,maxRows:1000,maxBytes:4*1024*1024})) {
          slices.push(await saveOpenDataPartition({source:"epa-echo",...partition,partition:`source:${slices.length}`,now:input.now()},input.vault));
        }
        state={formatVersion:1,context,position,records,complete:false,slices:[...slices],gaps:[...gaps]};
        await save();await spool.dispose();spool=await OpenDataSpool.create();pending=0;flushing=false;
      };
      try {
        let cursor=0;
        for await(const raw of streamCsvObjects(input.archive.textChunks)) {
          input.signal.throwIfAborted();
          if(cursor++<state.position)continue;
          const gap=echoMinimumGap(raw);
          if(gap)gaps.push(gap);
          else {await spool.append("source",normalizeEcho(raw,input.archive.retrievedAt,input.archive.publishedAt),input.capture);records++;}
          position++;pending++;
          if(pending>=SOURCE_CHUNK_ROWS)await flush();
        }
        await input.archive.accept?.();
        if(!records)throw Error("EPA exporter has no facility rows; prior data remain live.");
        await flush();state={...state,position,records,complete:true,gaps:[...gaps]};await save();
      } catch(error) {if(!flushing)await flush();throw error;}
      finally {await spool.dispose();}
    },
    gaps:()=>state.gaps,
    async *rows() {
      if(!state.complete)throw Error("EPA source parsing has unfinished work.");
      for(const reference of state.slices) {
        input.signal.throwIfAborted();
        for(const row of (await readOpenDataPartition("epa-echo",reference,input.vault)).records)yield row;
      }
    },
  };
}
