/** Disposable source work: a fact is stored once, with small references from its reader locations. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpenDataFact } from "./model.ts";
import type { OpenDataCapture } from "./publication.ts";
import { createOpenDataSpoolReader,OPEN_DATA_SPOOL_READ_ROWS as CHUNK_ROWS,type OpenDataSpoolReadOptions,type OpenDataSpoolPartition as Partition,type OpenDataSpoolCaptureMetadata as Metadata } from "./spool-reader.ts";

export type { OpenDataSpoolReadOptions } from "./spool-reader.ts";

export const OpenDataSpool={async create() {
  // No publisher value enters a path; SQLite is temporary work, never a publication authority.
  const root=await mkdtemp(join(tmpdir(),"src-so-spool-"));
  const database=new DatabaseSync(join(root,"rows.sqlite"));
  database.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-32768;
    CREATE TABLE facts(id INTEGER PRIMARY KEY,body BLOB NOT NULL,raw_bytes INTEGER NOT NULL);
    CREATE TABLE members(sequence INTEGER PRIMARY KEY,partition_id INTEGER NOT NULL,row_id INTEGER NOT NULL,capture_id INTEGER NOT NULL,native_id TEXT NOT NULL);`);
  const insertFact=database.prepare("INSERT INTO facts(body,raw_bytes) VALUES(?,?)");
  const insertMember=database.prepare("INSERT OR IGNORE INTO members(partition_id,row_id,capture_id,native_id) VALUES(?,?,?,?)");
  const sinks=new Map<string,Partition>(),captures=new Map<string,number>(),metadataById:Metadata[]=[];
  const schemas:{keys:string[];keyBytes:number}[]=[],schemaIds=new Map<string,number>(),lastSchemas=[-1,-1,-1];
  const readPartitions=createOpenDataSpoolReader({database,sinks,schemas,metadataById,dispose});
  function pack(value:object,slot:number) {
    const record=value as Record<string,unknown>,keys:string[]=[],values:unknown[]=[];
    for(const key of Object.keys(record)){
      const value=record[key];
      if(value===undefined||typeof value==="function"||typeof value==="symbol")continue;
      keys.push(key);values.push(value);
    }
    let schemaId=lastSchemas[slot],schema=schemas[schemaId];
    if(!schema||keys.length!==schema.keys.length||keys.some((key,index)=>key!==schema.keys[index])){
      const key=JSON.stringify(keys),held=schemaIds.get(key);schemaId=held??schemas.length;
      if(held===undefined){schemaIds.set(key,schemaId);schemas.push({keys,keyBytes:keys.reduce((n,key)=>n+Buffer.byteLength(JSON.stringify(key))+1,0)});}
      lastSchemas[slot]=schemaId;schema=schemas[schemaId];
    }
    const json=JSON.stringify(values);
    return {schemaId,json,bytes:Buffer.byteLength(json)+schema.keyBytes};
  }
  // The immediate ZIP/cell pair shares its object. Weak keys never retain a country's rows.
  const savedRows=new WeakMap<OpenDataFact,{id:number;nativeId:string}>();
  const savedCaptures=new WeakMap<object,number>();
  let pending=0,pendingBytes=0,transaction=false,closed=false,draining=false,indexed=false;
  const begin=()=>{if(!transaction){database.exec("BEGIN");transaction=true;}};
  const flush=()=>{if(transaction){database.exec("COMMIT");transaction=false;}pending=0;pendingBytes=0;};
  function index() {
    if(indexed)return;
    // Sorting once avoids random index writes for every source row; no row is exposed before uniqueness passes.
    database.exec("CREATE INDEX IF NOT EXISTS members_partition_order ON members(partition_id,sequence)");
    try {database.exec("CREATE UNIQUE INDEX members_identity ON members(partition_id,native_id)");}
    catch(error){
      if(!/UNIQUE constraint failed/.test(error instanceof Error?error.message:String(error)))throw error;
      const duplicate=database.prepare("SELECT partition_id,native_id FROM members GROUP BY partition_id,native_id HAVING count(*)>1 LIMIT 1").get() as {partition_id:number;native_id:string}|undefined;
      if(!duplicate)throw error;
      const sink=[...sinks.values()].find(row=>row.id===duplicate.partition_id);
      throw Error(`Repeated native source ID in ${sink?.partition??duplicate.partition_id}: ${duplicate.native_id}`);
    }
    indexed=true;
  }
  async function dispose() {
    try {
      if(!closed){
        // Failed SQLite writes may already have rolled back; discarding work must not mask that source failure.
        try {if(database.isTransaction)database.exec("ROLLBACK");}
        finally {database.close();closed=true;transaction=false;}
      }
    } finally {
      sinks.clear();captures.clear();metadataById.length=0;schemas.length=0;schemaIds.clear();
      await rm(root,{recursive:true,force:true});
    }
  }
  return {
    async append(partition:string,row:OpenDataFact,capture:Omit<OpenDataCapture,"sourceRows">) {
      if(closed||draining)throw Error("Open-data spool is already consuming its temporary rows.");
      const key=JSON.stringify([row.state,partition]);
      let sink=sinks.get(key);
      if(!sink){sink={id:sinks.size+1,partition,state:row.state};sinks.set(key,sink);}
      let captureId=savedCaptures.get(capture);
      if(captureId===undefined){
        const {sourceRows:_sourceRows,...metadata}=capture as OpenDataCapture;
        const captureKey=JSON.stringify(metadata);
        captureId=captures.get(captureKey);
        if(captureId===undefined){captureId=captures.size;captures.set(captureKey,captureId);metadataById[captureId]=JSON.parse(captureKey) as Metadata;}
        savedCaptures.set(capture,captureId);
      }
      begin();
      let saved=savedRows.get(row);
      if(saved&&saved.nativeId!==row.id)throw Error("A spooled source identity changed between reader locations.");
      if(!saved){
        // Repeated column names are held once; exact source cells and normalized values stay on their row.
        const {sourceRow,fields,...rest}=row,head=pack(rest,0),facts=pack(fields,1),source=pack(sourceRow,2);
        const body=Buffer.from(`[${head.schemaId},${head.json},${facts.schemaId},${facts.json},${source.schemaId},${source.json}]`);
        // Array/object punctuation has equal size; count the reconstructed fields/sourceRow member names too.
        const rawBytes=head.bytes+facts.bytes+source.bytes+23;
        saved={id:Number(insertFact.run(body,rawBytes).lastInsertRowid),nativeId:row.id};savedRows.set(row,saved);pendingBytes+=body.byteLength;
      }
      const inserted=insertMember.run(sink.id,saved.id,captureId,row.id);
      if(Number(inserted.changes)===0)sink.duplicate=row.id;
      if(++pending>=CHUNK_ROWS||pendingBytes>=8*1024*1024)flush();
    },
    async *partitions(options:OpenDataSpoolReadOptions={}):AsyncGenerator<{partition:string;state:string|null;rows:OpenDataFact[];captures:OpenDataCapture[]}> {
      if(closed)return;
      for(const limit of [options.maxRows,options.maxBytes])if(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<=0))throw Error("Open-data spool chunk limits must be positive integers.");
      if(draining)throw Error("Open-data spool already has a consuming reader.");
      flush();index();
      if(options.consume)draining=true;
      yield* readPartitions(options);
    },
    dispose,
  };
}};
