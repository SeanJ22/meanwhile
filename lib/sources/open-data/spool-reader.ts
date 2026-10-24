/** The temporary source spool's shared decoder and bounded reader-location iteration. */
import type { DatabaseSync } from "node:sqlite";
import type { OpenDataFact } from "./model.ts";
import type { OpenDataCapture } from "./publication.ts";

export interface OpenDataSpoolReadOptions {
  /** EPA drains its work once; Socrata's default read remains repeatable for later joins. */
  readonly consume?: boolean;
  /** Chunk limits bound working memory, without dropping any source row. */
  readonly maxRows?: number;
  readonly maxBytes?: number;
}
export interface OpenDataSpoolPartition {id:number;partition:string;state:string|null;duplicate?:string}
export interface OpenDataSpoolSchema {keys:readonly string[];keyBytes:number}
export type OpenDataSpoolCaptureMetadata=Omit<OpenDataCapture,"sourceRows">;
interface StoredMember {sequence:number;row_id:number;capture_id:number;body:Uint8Array;raw_bytes:number}
export const OPEN_DATA_SPOOL_READ_ROWS=1000;
const CHUNK_BYTES=4*1024*1024;

function unpack(schemaId:number,values:unknown[],schemas:readonly OpenDataSpoolSchema[]) {
  const schema=schemas[schemaId];
  if(!schema||schema.keys.length!==values.length)throw Error("Temporary source row schema differs from its captured cells.");
  return Object.fromEntries(schema.keys.map((key,index)=>[key,values[index]]));
}
export function decodeOpenDataSpoolFact(body:Uint8Array,schemas:readonly OpenDataSpoolSchema[]):OpenDataFact {
  const [headId,head,factsId,facts,sourceId,source]=JSON.parse(Buffer.from(body).toString("utf8")) as [number,unknown[],number,unknown[],number,unknown[]];
  return {...unpack(headId,head,schemas),fields:unpack(factsId,facts,schemas),sourceRow:unpack(sourceId,source,schemas)} as unknown as OpenDataFact;
}

export function createOpenDataSpoolReader({database,sinks,schemas,metadataById,dispose}:{
  database:Pick<DatabaseSync,"prepare">;
  sinks:Map<string,OpenDataSpoolPartition>;
  schemas:readonly OpenDataSpoolSchema[];
  metadataById:readonly OpenDataSpoolCaptureMetadata[];
  dispose:()=>Promise<void>;
}) {
  const readMembers=database.prepare(`SELECT m.sequence,m.row_id,m.capture_id,f.body,f.raw_bytes FROM members m JOIN facts f ON f.id=m.row_id
    WHERE m.partition_id=? AND m.sequence>? ORDER BY m.sequence LIMIT ${OPEN_DATA_SPOOL_READ_ROWS}`);
  return async function* partitions(options:OpenDataSpoolReadOptions={}):AsyncGenerator<{partition:string;state:string|null;rows:OpenDataFact[];captures:OpenDataCapture[]}> {
    const chunked=options.consume||options.maxRows!==undefined||options.maxBytes!==undefined;
    const maxRows=options.maxRows??(options.consume?OPEN_DATA_SPOOL_READ_ROWS:Infinity),maxBytes=options.maxBytes??(options.consume?CHUNK_BYTES:Infinity);
    for(const sink of [...sinks.values()].sort((a,b)=>(a.state??"").localeCompare(b.state??"")||a.partition.localeCompare(b.partition))) {
      if(sink.duplicate)throw Error(`Repeated native source ID in ${sink.partition}: ${sink.duplicate}`);
      let rows:OpenDataFact[]=[],bytes=0,after=0,part=0;
      const sources=new Map<number,OpenDataCapture>();
      const value=()=>({partition:chunked?`${sink.partition}:part:${part++}`:sink.partition,state:sink.state,rows,captures:[...sources.values()]});
      for(;;){
        const batch=readMembers.all(sink.id,after) as unknown as StoredMember[];
        if(!batch.length)break;
        for(const member of batch){
          if(rows.length&&(rows.length>=maxRows||bytes+member.raw_bytes>maxBytes)){
            yield value();
            rows=[];bytes=0;sources.clear();
          }
          const row=decodeOpenDataSpoolFact(member.body,schemas);
          rows.push(row);bytes+=member.raw_bytes;after=member.sequence;
          const prior=sources.get(member.capture_id);
          if(prior)(prior.sourceRows as Record<string,unknown>[]).push(row.sourceRow);
          else sources.set(member.capture_id,{...metadataById[member.capture_id],sourceRows:[row.sourceRow]});
        }
      }
      if(rows.length)yield value();
      if(options.consume)sinks.delete(JSON.stringify([sink.state,sink.partition]));
    }
    // Deleting individual rows cannot shrink SQLite's file and rewrites its indexes on every chunk.
    // Consuming work is never read again; discard the whole temporary database when the drain completes.
    if(options.consume)await dispose();
  };
}
