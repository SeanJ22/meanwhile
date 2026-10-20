import { listedBoxRepository, type BoxFinding } from "../box.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import type { LeadOrder } from "../leads/order.ts";
import { memoryWebsitePacing } from "../website-pacing.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { unavailableActiveWorkClaims } from "./active-work-claims.ts";
import { withStreamedFieldManualMerge } from "./streamed-field-manual-merge.ts";
import { scanAggregateFile,rewriteAggregateFile } from "./streamed-aggregate-array.ts";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
/** Durable filesystem store. Every write is an exclusive create, so compare-and-set and append are arbitrated by the filesystem. */

import { appendFile, link, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../scheduler/durable.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import type { SpendWindow } from "../spend-window.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type {
  PromotionPipelineRecord,
  WindowIncident,
  WindowIntent,
  WindowRunRecord,
} from "../promotion/types.ts";
import path from "node:path";

import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { BudgetLedger } from "../budget.ts";
import type { CostEntry } from "../cost.ts";
import { fingerprint,contentHash } from "../ids.ts";
import type { RouteTask } from "../route-task.ts";
import type { Escalation, WorkItem } from "../work-item.ts";
import type {
  CacheObservationRecord,
  OwnerDecisionIntent,
  OwnerDigestRecord,
  OwnerSnapshot,
  OwnerSnapshotState,
  RunnerHeartbeat,
} from "../owner-surface.ts";
import type { OwnerSnapshotTotals, SpilledInbox, StateTotals } from "../owner-snapshot-totals.ts";
import type { FieldManualEntry } from "../field-manual.ts";
import { fieldManualRows } from "./field-manual-rows.ts";
import { aggregateFixMap, type FixMapRow } from "../../method/fix-map.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
import type { AgentJobRecord } from "../gateway/agent-job.ts";
import type { MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { CandidateStore } from "../../method/candidate.ts";
import { budgetRepositoryFrom } from "./shared.ts";
import {
  AppendOnlyViolation,
  ConcurrentModification,
  CorruptPersistedState,
  RepositoryLockHeld,
  UnknownAggregate,
  canonicalJson,
  heldSlotKeys,
  jsonTextAtPath,
  projectRecord,
  reconcileIdempotentAppend,
  reconcileIdempotentPut,
  type AggregateRepository,
  type FieldManualRepository,
  type AppendOnlyRepository,
  type AppendOutcome,
  type ArtifactRecord,
  type ChangedReadOptions,
  type ChangedLogReadOptions,
  type ChangedRecord,
  type ControlPlaneRepositories,
  type DispositionCommit,
  type HeldSlots,
  type PassCursor,
  type LockManager,
  type Persisted,
  type PutOutcome,
  type RecordedTransition,
  type RecordProjection,
} from "./types.ts";

/** Unique per write without randomness: process id plus a per-process counter. */
let tempCounter = 0;
function tempPath(target: string): string {
  tempCounter += 1;
  return `${target}.${process.pid}.${tempCounter}.tmp`;
}

/** The readable prefix is for humans; the `fingerprint` suffix makes the name injective. */
function fileNameFor(key: string): string {
  const readable = key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return `${readable}-${fingerprint([key])}`;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isEexist(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

/**
 * All-or-nothing exclusive create: write a complete temp file, then `link` it into place (EEXIST when the
 * target exists). Where `link` is unavailable, an exclusive `open(path, "wx")` plus write lets a concurrent
 * reader briefly see an empty file, which reads as `CorruptPersistedState`, never a wrong answer.
 */
async function exclusiveCreate(target: string, contents: string): Promise<boolean> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = tempPath(target);
  await writeFile(temp, contents, "utf8");
  try {
    await link(temp, target);
    return true;
  } catch (error) {
    if (isEexist(error)) return false;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EPERM" && code !== "ENOSYS" && code !== "EXDEV" && code !== "EOPNOTSUPP") {
      throw error;
    }
    let handle;
    try {
      handle = await open(target, "wx");
    } catch (openError) {
      if (isEexist(openError)) return false;
      throw openError;
    }
    try {
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
    return true;
  } finally {
    await rm(temp, { force: true });
  }
}

/** The same exclusive revision commit, with the replacement streamed to its complete temporary file. */
async function exclusiveStreamCreate(target:string,write:(sink:(text:string)=>Promise<void>)=>Promise<void>):Promise<boolean>{
  await mkdir(path.dirname(target),{recursive:true});const temporary=tempPath(target);
  const file=await open(temporary,"wx");
  try{
    await write(async text=>{const bytes=Buffer.from(text);let at=0;while(at<bytes.length){const part=await file.write(bytes,at,bytes.length-at);if(!part.bytesWritten)throw new Error("Aggregate stream write made no progress");at+=part.bytesWritten;}});
    await file.close();
    try{await link(temporary,target);return true;}
    catch(error){if(isEexist(error))return false;if(!["EPERM","ENOSYS","EXDEV","EOPNOTSUPP"].includes((error as NodeJS.ErrnoException).code??""))throw error;}
    let output;try{output=await open(target,"wx");}catch(error){if(isEexist(error))return false;throw error;}
    try{for await(const chunk of createReadStream(temporary))await output.writeFile(chunk);}finally{await output.close();}return true;
  }finally{await file.close().catch(()=>{});await rm(temporary,{force:true});}
}

/** ENOENT is the only absence; every other failure is raised, never returned as null. */
async function readJsonFile<T>(file: string, validate: (parsed: unknown) => T): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return null;
    throw new CorruptPersistedState(file, `read failed: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CorruptPersistedState(
      file,
      `${(error as Error).message} (${raw.length} byte(s) on disk, not valid JSON)`,
    );
  }
  return validate(parsed);
}

/** The on-disk shape of an aggregate. Validated on every read, never assumed. */
function validateEnvelope<T>(file: string, kind: string, parsed: unknown): Persisted<T> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptPersistedState(file, `expected a ${kind} envelope object, found ${typeof parsed}`);
  }
  const row = parsed as Partial<Persisted<T>>;
  if (typeof row.id !== "string") {
    throw new CorruptPersistedState(file, `${kind} envelope has no string id`);
  }
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 1) {
    throw new CorruptPersistedState(
      file,
      `${kind} envelope has revision ${String(row.revision)}, which cannot order a ` +
        "compare-and-set. A revision that is not a positive integer makes every CAS unsound.",
    );
  }
  if (typeof row.updatedAt !== "string") {
    throw new CorruptPersistedState(file, `${kind} envelope has no string updatedAt`);
  }
  if (row.value === undefined) {
    throw new CorruptPersistedState(file, `${kind} envelope has no value`);
  }
  return { id: row.id, revision: row.revision, updatedAt: row.updatedAt, value: row.value as T };
}

/** A missing kind directory is empty; a missing root is corruption. */
async function listDirectory(root: string, dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (!isEnoent(error)) {
      throw new CorruptPersistedState(dir, `directory listing failed: ${(error as Error).message}`);
    }
  }
  try {
    await stat(root);
  } catch {
    throw new CorruptPersistedState(
      root,
      "the store root itself is absent. This is not an empty store; it is a store we can no " +
        "longer reach, and the two must never return the same answer",
    );
  }
  return [];
}

/** One file per revision (`<id>.r<n>.json`); taking a revision is winning an exclusive create, and the loser is refused with `ConcurrentModification`. */
export function fileAggregateRepository<T>(
  root: string,
  kind: string,
  folder: string,
): AggregateRepository<T> & Pick<FieldManualRepository,"compareAndSetMergedEntry"> {
  const dir = path.join(root, "aggregates", folder);
  const baseFor = (id: string): string => fileNameFor(id);
  const fileForRevision = (id: string, revision: number): string =>
    path.join(dir, `${baseFor(id)}.r${revision}.json`);

  /** Revisions present for one id, ascending. */
  const revisionsOf = async (id: string): Promise<number[]> => {
    const prefix = `${baseFor(id)}.r`;
    const names = await listDirectory(root, dir);
    const revisions: number[] = [];
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
      const middle = name.slice(prefix.length, name.length - ".json".length);
      if (!/^\d+$/.test(middle)) continue;
      revisions.push(Number(middle));
    }
    return revisions.sort((a, b) => a - b);
  };

  const readRevision = async (id: string, revision: number): Promise<Persisted<T> | null> => {
    const file = fileForRevision(id, revision);
    return readJsonFile<Persisted<T>>(file, (parsed) => validateEnvelope<T>(file, kind, parsed));
  };

  const read = async (id: string): Promise<Persisted<T> | null> => {
    const revisions = await revisionsOf(id);
    if (revisions.length === 0) return null;
    const latest = revisions[revisions.length - 1];
    const row = await readRevision(id, latest);
    if (row === null) {
      // Listed but not found on read: the store changed underneath us, which is not an absence.
      throw new CorruptPersistedState(
        fileForRevision(id, latest),
        `revision ${latest} was listed in ${dir} and then could not be read`,
      );
    }
    return row;
  };

  const readStreamMetadata=async(file:string)=>{
    try{return await scanAggregateFile(file);}
    catch(error){throw new CorruptPersistedState(file,(error as Error).message);}
  };
  const readNarrowed=async(id:string,projection:RecordProjection):Promise<Persisted<unknown>|null>=>{
    const revisions=await revisionsOf(id);if(!revisions.length)return null;const file=fileForRevision(id,revisions.at(-1)!);
    try{const {values:_values,next:_next,...row}=await scanAggregateFile(file,{valueProjection:projection});return row;}
    catch(error){throw new CorruptPersistedState(file,(error as Error).message);}
  };
  const readArrayType=async(id:string,path:readonly string[],expectedRevision?:number):Promise<boolean|null>=>{
    const revisions=await revisionsOf(id);if(!revisions.length)return null;
    const file=fileForRevision(id,expectedRevision??revisions.at(-1)!);
    try{return (await scanAggregateFile(file,{field:path})).isArray??false;}
    catch(error){throw new CorruptPersistedState(file,(error as Error).message);}
  };

  const latestFiles=async()=>{
    const names = (await listDirectory(root, dir)).filter((n) => n.endsWith(".json"));
    const latestByBase = new Map<string, number>();
    for (const name of names) {
      const match = /^(.*)\.r(\d+)\.json$/.exec(name);
      if (match === null) continue;
      const [, base, revision] = match;
      const current = latestByBase.get(base);
      if (current === undefined || Number(revision) > current) {
        latestByBase.set(base, Number(revision));
      }
    }
    return [...latestByBase.entries()].sort().map(([base,revision])=>path.join(dir,`${base}.r${revision}.json`));
  };
  const filtered=async(jsonPath:readonly string[],wanted:ReadonlySet<string>|string,projection?:RecordProjection)=>{
    const out:Persisted<unknown>[]=[];
    for(const file of await latestFiles()){
      try{
      let selected:string|null=null;
      const metadata=await scanAggregateFile(file,{watchRoot:[{path:jsonPath,observe:value=>{selected=value===null||typeof value==='object'?null:String(value);}}]});
      if(selected===null||!(typeof wanted==="string"?(selected as string).startsWith(wanted):wanted.has(selected)))continue;
      if(projection){const{values:_values,next:_next,...row}=await scanAggregateFile(file,{valueProjection:projection});out.push(row);}
      else{const row=await readRevision(metadata.id,metadata.revision);if(!row)throw new CorruptPersistedState(file,"the selected revision disappeared");out.push(row);}
      }catch(error){if(error instanceof CorruptPersistedState)throw error;throw new CorruptPersistedState(file,(error as Error).message);}
    }return out.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  };
  const list = async (): Promise<readonly Persisted<T>[]> => {
    const rows: Persisted<T>[] = [];
    for (const file of await latestFiles()) {
      const row = await readJsonFile<Persisted<T>>(file, (parsed) =>
        validateEnvelope<T>(file, kind, parsed),
      );
      if (row === null) {
        throw new CorruptPersistedState(
          file,
          "the file was listed in this directory and then could not be read",
        );
      }
      rows.push(row);
    }
    return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };

  return {
    read,

    compareAndSetMergedEntry:async(id,expectedRevision,entry,now)=>{
      if(id!==entry.id)throw new Error("FIELD_MANUAL_MERGE_ID_MISMATCH");
      const revisions=await revisionsOf(id),latest=revisions.at(-1)??null;
      if(latest!==expectedRevision)throw new ConcurrentModification(kind,id,expectedRevision??0,latest);
      if(latest===null){
        const won=await exclusiveStreamCreate(fileForRevision(id,1),async out=>{await out(JSON.stringify({id,revision:1,updatedAt:now,value:entry})+"\n");});
        if(!won)throw new ConcurrentModification(kind,id,0,(await revisionsOf(id)).at(-1)??null);
        return{revision:1,changed:true};
      }
      const source=fileForRevision(id,latest),metadata=await readStreamMetadata(source);
      if(metadata.id!==id||metadata.revision!==latest)throw new CorruptPersistedState(source,"aggregate identity or revision disagrees with its filename");
      return withStreamedFieldManualMerge(source,entry,async(write,changed)=>{
        if(!changed)return{revision:latest,changed:false};
        const revision=latest+1;
        const won=await exclusiveStreamCreate(fileForRevision(id,revision),async out=>{
          await out(`{"id":${JSON.stringify(id)},"revision":${revision},"updatedAt":${JSON.stringify(now)},"value":`);
          await write(out);await out("}\n");
        });
        if(!won)throw new ConcurrentModification(kind,id,latest,(await revisionsOf(id)).at(-1)??null);
        return{revision,changed:true};
      });
    },

    readArrayPage:async(id,field,query={})=>{
      const revisions=await revisionsOf(id);if(!revisions.length)return null;
      const file=fileForRevision(id,revisions.at(-1)!);
      try{const row=await scanAggregateFile(file,{field,query});if(row.id!==id||row.revision!==revisions.at(-1))throw new Error("aggregate identity or revision disagrees with its filename");return{id:row.id,revision:row.revision,updatedAt:row.updatedAt,values:row.values,next:row.next,...row.nextKey!==undefined?{nextKey:row.nextKey}:{}};}
      catch(error){throw new CorruptPersistedState(file,(error as Error).message);}
    },
    compareAndSetFields:async(id,expectedRevision,fields,now)=>{
      const revisions=await revisionsOf(id),latest=revisions.at(-1)??null;
      if(latest!==expectedRevision)throw new ConcurrentModification(kind,id,expectedRevision,latest);
      const source=fileForRevision(id,latest),metadata=await readStreamMetadata(source);
      if(metadata.id!==id||metadata.revision!==latest)throw new CorruptPersistedState(source,"aggregate identity or revision disagrees with its filename");
      const next={id,revision:expectedRevision+1,updatedAt:now};
      const won=await exclusiveStreamCreate(fileForRevision(id,next.revision),out=>rewriteAggregateFile(source,out,next,fields));
      if(!won)throw new ConcurrentModification(kind,id,expectedRevision,(await revisionsOf(id)).at(-1)??null);
      return{...next,value:fields};
    },
    compareAndSetArrayItem:async(id,expectedRevision,field,keyPath,key,value,now,retention,fields)=>{
      const revisions=await revisionsOf(id),latest=revisions.at(-1)??null;
      if(latest!==expectedRevision)throw new ConcurrentModification(kind,id,expectedRevision,latest);
      const source=fileForRevision(id,latest),metadata=await readStreamMetadata(source);
      if(metadata.id!==id||metadata.revision!==latest)throw new CorruptPersistedState(source,"aggregate identity or revision disagrees with its filename");
      const next={id,revision:expectedRevision+1,updatedAt:now};
      const won=await exclusiveStreamCreate(fileForRevision(id,next.revision),out=>rewriteAggregateFile(source,out,next,{},
        {field,keyPath,key,next:value,retention,fields}));
      if(!won)throw new ConcurrentModification(kind,id,expectedRevision,(await revisionsOf(id)).at(-1)??null);
      return{...next,value};
    },

    readNarrowed,
    readArrayType,

    mustRead: async (id: string): Promise<Persisted<T>> => {
      const row = await read(id);
      if (row === null) throw new UnknownAggregate(kind, id);
      return row;
    },

    /** Compared against revision 1, the creation, so re-registering a task that has since moved is still idempotent. */
    put: async (id: string, value: T, now: string): Promise<PutOutcome<T>> => {
      const row: Persisted<T> = { id, revision: 1, updatedAt: now, value };
      const created = await exclusiveCreate(
        fileForRevision(id, 1),
        `${JSON.stringify(row, null, 2)}\n`,
      );
      if (created) return { created: true, persisted: row };
      const origin = await readRevision(id, 1);
      if (origin === null) {
        throw new CorruptPersistedState(
          fileForRevision(id, 1),
          `${kind} ${id} refused an exclusive create and then had no revision 1 to compare against`,
        );
      }
      reconcileIdempotentPut(kind, id, origin.value, value);
      const latest = await read(id);
      return { created: false, persisted: latest ?? origin };
    },

    compareAndSet: async (
      id: string,
      expectedRevision: number,
      next: T,
      now: string,
    ): Promise<Persisted<T>> => {
      const existing = await read(id);
      if (existing === null) {
        throw new ConcurrentModification(kind, id, expectedRevision, null);
      }
      if (existing.revision !== expectedRevision) {
        throw new ConcurrentModification(kind, id, expectedRevision, existing.revision);
      }
      const row: Persisted<T> = { id, revision: expectedRevision + 1, updatedAt: now, value: next };
      const won = await exclusiveCreate(
        fileForRevision(id, row.revision),
        `${JSON.stringify(row, null, 2)}\n`,
      );
      if (won) return row;
      // Another writer created this exact revision between our read and our
      // write. It won; we are stale, and we say so with the revision that landed.
      const winner = await read(id);
      throw new ConcurrentModification(kind, id, expectedRevision, winner?.revision ?? null);
    },

    list,
    listNarrowed: async (projection: RecordProjection): Promise<readonly Persisted<unknown>[]> => {
      const out:Persisted<unknown>[]=[];
      for(const file of await latestFiles()){
        try{const{values:_values,next:_next,...row}=await scanAggregateFile(file,{valueProjection:projection});out.push(row);}
        catch(error){throw new CorruptPersistedState(file,(error as Error).message);}
      }return out.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    },

    /* Scan the exact match path before returning only its selected record. */
    listWhere: async (jsonPath: readonly string[], value: string): Promise<readonly Persisted<T>[]> =>
      await filtered(jsonPath,new Set([value])) as Persisted<T>[],
    listWhereNarrowed: async (jsonPath: readonly string[], value: string, projection: RecordProjection): Promise<readonly Persisted<unknown>[]> =>
      filtered(jsonPath,new Set([value]),projection),
    listWherePrefix:(jsonPath,prefix,projection)=>filtered(jsonPath,prefix,projection),
    readManyNarrowed: async (ids: readonly string[], projection: RecordProjection): Promise<readonly Persisted<unknown>[]> => {
      const out:Persisted<unknown>[]=[];
      for(const id of [...new Set(ids)].sort()){const row=await readNarrowed(id,projection);if(row)out.push(row);}
      return out;
    },
    listWhereIn: async (jsonPath: readonly string[], values: readonly string[], projection: RecordProjection): Promise<readonly Persisted<unknown>[]> => {
      return filtered(jsonPath,new Set(values),projection);
    },
    /* A directory has no database clock; a revision's own time stands in for it. */
    listChangedSince: async (since: string | null, held?: HeldSlots, read: ChangedReadOptions<Persisted<T>> = {}) => {
      const through = new Date().toISOString();
      const skip = heldSlotKeys(held);
      const rows:Persisted<T>[]=[];
      const slots:{file:string;row:Persisted<unknown>}[]=[];
      for(const file of await latestFiles())slots.push({file,row:await readStreamMetadata(file)});
      slots.sort((a,b)=>a.row.id<b.row.id?-1:a.row.id>b.row.id?1:0);
      for(const{file,row}of slots){
        if((since!==null&&Date.parse(row.updatedAt)<Date.parse(since))||skip.has(`${row.id}\n${row.revision}`))continue;
        let selected:Persisted<T>|null;
        if(read.projection){const{values:_values,next:_next,...narrowed}=await scanAggregateFile(file,{valueProjection:read.projection});selected=narrowed as Persisted<T>;}
        else selected=await readRevision(row.id,row.revision);
        if(!selected)throw new CorruptPersistedState(file,"the listed revision disappeared");
        if(read.page)await read.page([selected]);else rows.push(selected);
      }
      return { through, rows };
    },
  };
}

interface LogLine<T> {
  readonly key: string;
  readonly recordId: string;
  readonly at: string;
  readonly record: T;
}

function parseLogLine<T>(file: string, line: string, lineNumber: number): LogLine<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new CorruptPersistedState(
      `${file}:${lineNumber}`,
      `${(error as Error).message}. A history line that cannot be parsed is a history we cannot ` +
        "replay, and skipping it would silently shorten the record",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptPersistedState(`${file}:${lineNumber}`, "expected a log-line object");
  }
  const row = parsed as Partial<LogLine<T>>;
  if (typeof row.key !== "string" || typeof row.recordId !== "string" || row.record === undefined) {
    throw new CorruptPersistedState(
      `${file}:${lineNumber}`,
      "log line is missing key, recordId or record",
    );
  }
  return { key: row.key, recordId: row.recordId, at: String(row.at ?? ""), record: row.record as T };
}

/** Identical lines sharing a record id collapse to one; divergent ones are raised on read. */
function dedupeHistory<T>(log: string, file: string, lines: readonly LogLine<T>[]): LogLine<T>[] {
  const seen = new Map<string, LogLine<T>>();
  const out: LogLine<T>[] = [];
  for (const line of lines) {
    const previous = seen.get(line.recordId);
    if (previous === undefined) {
      seen.set(line.recordId, line);
      out.push(line);
      continue;
    }
    const a = canonicalJson(previous.record);
    const b = canonicalJson(line.record);
    if (a !== b) throw new AppendOnlyViolation(`${log} (${file})`, line.recordId, a, b);
  }
  return out;
}

export function fileAppendOnlyRepository<T>(
  root: string,
  log: string,
): AppendOnlyRepository<T> {
  const dir = path.join(root, "logs", log);
  const fileFor = (key: string): string => path.join(dir, `${fileNameFor(key)}.jsonl`);

  async function* fileLines(file:string):AsyncGenerator<LogLine<T>>{
    let handle;try{handle=await open(file,"r");}catch(error){if(isEnoent(error))return;throw new CorruptPersistedState(file,`read failed: ${(error as Error).message}`);}
    const input=handle.createReadStream({encoding:"utf8",highWaterMark:64*1024,autoClose:false});
    const lines=createInterface({input,crlfDelay:Infinity});const seen=new Map<string,string>();let lineNumber=0;
    try{for await(const raw of lines){lineNumber++;if(!raw.trim())continue;const row=parseLogLine<T>(file,raw.trim(),lineNumber);
      const hash=contentHash(canonicalJson(row.record)),prior=seen.get(row.recordId);
      if(prior!==undefined){if(prior!==hash)throw new AppendOnlyViolation(`${log} (${file})`,row.recordId,prior,hash);continue;}
      seen.set(row.recordId,hash);yield row;
    }}catch(error){if(error instanceof CorruptPersistedState||error instanceof AppendOnlyViolation)throw error;throw new CorruptPersistedState(file,`read failed: ${(error as Error).message}`);}finally{lines.close();input.destroy();await handle.close();}
  }
  async function* coordinateLines(keys?:readonly string[]):AsyncGenerator<ChangedRecord<T>>{
    const positions=new Map<string,number>();
    const names=keys===undefined?(await listDirectory(root,dir)).filter(name=>name.endsWith(".jsonl")):[...new Set(keys)].map(key=>`${fileNameFor(key)}.jsonl`);
    for(const name of names.sort())for await(const line of fileLines(path.join(dir,name))){
      const position=positions.get(line.key)??0;positions.set(line.key,position+1);
      yield{key:line.key,recordId:line.recordId,position,record:line.record,changedAt:line.at,stampedAt:line.at};
    }
  }

  const readLines = async (key: string): Promise<LogLine<T>[]> => {
    const file = fileFor(key);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if (isEnoent(error)) return [];
      throw new CorruptPersistedState(file, `read failed: ${(error as Error).message}`);
    }
    const lines = raw
      .split("\n")
      .map((line, index) => ({ line: line.trim(), index }))
      .filter((entry) => entry.line.length > 0)
      .map((entry) => parseLogLine<T>(file, entry.line, entry.index + 1));
    return dedupeHistory(log, file, lines);
  };

  return {
    append: async (
      key: string,
      recordId: string,
      record: T,
      now: string,
    ): Promise<AppendOutcome<T>> => {
      const lines = await readLines(key);
      const existingIndex = lines.findIndex((line) => line.recordId === recordId);
      if (existingIndex >= 0) {
        reconcileIdempotentAppend(log, recordId, lines[existingIndex].record, record);
        return {
          appended: false,
          recordId,
          record: lines[existingIndex].record,
          position: existingIndex,
        };
      }
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      const entry: LogLine<T> = { key, recordId, at: now, record };
      // O_APPEND, never a whole-file rewrite: a race must not be able to shorten history.
      await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
      return { appended: true, recordId, record, position: lines.length };
    },

    read: async (key: string): Promise<readonly T[]> =>
      (await readLines(key)).map((line) => line.record),

    readWhere: async (
      key: string,
      jsonPath: readonly string[],
      value: string,
    ): Promise<readonly T[]> => {
      const out:T[]=[];for await(const line of fileLines(fileFor(key)))if(jsonTextAtPath(line.record,jsonPath)===value)out.push(line.record);return out;
    },

    readRecent: async (key: string, limit: number): Promise<readonly T[]> => {
      const bounded = Math.max(0, Math.trunc(limit));
      const records:T[]=[];for await(const line of fileLines(fileFor(key))){records.push(line.record);if(records.length>bounded)records.shift();}return records.reverse();
    },

    readRecentWhere: async (
      key: string,
      jsonPath: readonly string[],
      value: string,
      limit: number,
      projection: RecordProjection,
      recordedAtSince?: string,
    ): Promise<readonly unknown[]> => {
      const since = recordedAtSince === undefined ? null : Date.parse(recordedAtSince);
      const bounded = Math.max(0, Math.trunc(limit));
      const matches:unknown[]=[];
      for await(const line of fileLines(fileFor(key)))if((since===null||Date.parse(line.at)>=since)&&jsonTextAtPath(line.record,jsonPath)===value){matches.push(projectRecord(line.record,projection));if(matches.length>bounded)matches.shift();}
      return matches.reverse();
    },

    readLatest: async (keys: readonly string[], projection: RecordProjection): Promise<ReadonlyMap<string, unknown>> => {
      const out = new Map<string, unknown>();
      for (const key of new Set(keys)) {
        let newest:LogLine<T>|undefined;for await(const line of fileLines(fileFor(key)))newest=line;
        if (newest !== undefined) out.set(key, projectRecord(newest.record, projection));
      }
      return out;
    },

    readAll: async (): Promise<readonly T[]> =>
      (await readEveryPartition()).map((line) => line.record),

    readAllNarrowed: async (projection) =>
      (await readEveryPartition()).map((line) => projectRecord(line.record, projection)),

    readSince: async (since: string): Promise<readonly T[]> =>
      (await readEveryPartition()).filter((line) => Date.parse(line.at) >= Date.parse(since)).map((line) => line.record),

    readChangedSince: async (since: string | null, held?: HeldSlots, read: ChangedLogReadOptions<T> = {}) => {
      const through = new Date().toISOString();
      const from = since === null ? null : Date.parse(since);
      const skip = heldSlotKeys(held);
      const records:ChangedRecord<T>[]=[];
      for await(const changed of coordinateLines(read.keys)){
        if((from!==null&&Date.parse(changed.stampedAt!)<from)||skip.has(`${changed.key}\n${changed.position}`))continue;
        const selected=read.projection?{...changed,record:projectRecord(changed.record,read.projection)as T}:changed;
        if(read.page)await read.page([selected]);else records.push(selected);
      }
      return { through, records };
    },

    readStampedBetween: async (from: string, until: string, page: (records: readonly ChangedRecord<T>[]) => Promise<void> | void) => {
      for await(const changed of coordinateLines())if(Date.parse(changed.stampedAt!)>=Date.parse(from)&&Date.parse(changed.stampedAt!)<Date.parse(until))await page([changed]);
    },

    keys: async (): Promise<readonly string[]> => {
      const keys=new Set<string>();for await(const row of coordinateLines())keys.add(row.key);
      return [...keys].sort();
    },

    keysWhere: async (jsonPath: readonly string[], value: string): Promise<readonly string[]> => {
      const keys=new Set<string>();for await(const row of coordinateLines())if(jsonTextAtPath(row.record,jsonPath)===value)keys.add(row.key);
      return [...keys].sort();
    },
  };

  /** Every line in every partition, in filename then append order. */
  async function readEveryPartition(): Promise<LogLine<T>[]> {
    const names = (await listDirectory(root, dir)).filter((n) => n.endsWith(".jsonl")).sort();
    const out: LogLine<T>[] = [];
    for (const name of names) {
      const file = path.join(dir, name);
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if (isEnoent(error)) continue;
        throw new CorruptPersistedState(file, `read failed: ${(error as Error).message}`);
      }
      const lines = raw
        .split("\n")
        .map((line, index) => ({ line: line.trim(), index }))
        .filter((entry) => entry.line.length > 0)
        .map((entry) => parseLogLine<T>(file, entry.line, entry.index + 1));
      out.push(...dedupeHistory(log, file, lines));
    }
    return out;
  }
}

/** Exclusive-create lock. It refuses when held and never waits. */
export function fileLockManager(root: string): LockManager {
  const dir = path.join(root, "locks");
  return {
    withLock: async <R>(name: string, fn: () => Promise<R>): Promise<R> => {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${fileNameFor(name)}.lock`);
      let handle;
      try {
        handle = await open(file, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
          const owner = await readFile(file, "utf8").catch(() => "an unrecorded holder");
          throw new RepositoryLockHeld(name, `lock file ${file} exists, written by ${owner.trim()}`);
        }
        throw error;
      }
      try {
        await handle.writeFile(`pid ${process.pid}`, "utf8");
        await handle.close();
        handle = undefined;
        return await fn();
      } finally {
        if (handle !== undefined) await handle.close().catch(() => undefined);
        await rm(file, { force: true });
      }
    },
  };
}

/** No default directory. After this call creates the root, a missing root is corruption, not emptiness. */
export async function createFileRepositories(root: string): Promise<ControlPlaneRepositories> {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new Error(
      "createFileRepositories requires an explicit root directory. There is deliberately no " +
        "default: a store that can be created by accident is a store whose contents nobody can " +
        "account for.",
    );
  }
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  const locks = fileLockManager(resolved);
  const artifacts = fileAppendOnlyRepository<ArtifactRecord>(resolved, "artifacts");

  return {
    workItems: fileAggregateRepository<WorkItem>(resolved, "WorkItem", "work-items"),
    routeTasks: fileAggregateRepository<RouteTask>(resolved, "RouteTask", "route-tasks"),
    attempts: fileAggregateRepository<Attempt>(resolved, "Attempt", "attempts"),
    obligations: fileAggregateRepository<StandingObligation>(
      resolved,
      "StandingObligation",
      "obligations",
    ),
    occurrences: fileAggregateRepository<FreshnessOccurrence>(
      resolved,
      "FreshnessOccurrence",
      "occurrences",
    ),
    debts: fileAggregateRepository<FreshnessDebt>(resolved, "FreshnessDebt", "debts"),
    leases: fileAggregateRepository<ExecutionLease>(resolved, "ExecutionLease", "leases"),
    activeWorkClaims: unavailableActiveWorkClaims(),
    transitions: fileAppendOnlyRepository<RecordedTransition>(resolved, "transitions"),
    escalations: fileAppendOnlyRepository<Escalation>(resolved, "escalations"),
    dispositions: fileAppendOnlyRepository<DispositionCommit>(resolved, "dispositions"),
    artifacts,
    artifactsByCanonicalUrl: async (url, limit) =>
      (await artifacts.readAll()).filter(record => record.canonicalUrl === url)
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.artifactId.localeCompare(b.artifactId))
        .slice(0, Math.max(0, Math.trunc(limit))),
    capturedCanonicalUrls: async (urls) => {
      const wanted = new Set(urls);
      return new Set((await artifacts.readAll()).map(record => record.canonicalUrl).filter(url => wanted.has(url)));
    },
    adminEvidenceCopyRequests: fileAggregateRepository<AdminEvidenceCopyRequest>(resolved, "AdminEvidenceCopyRequest", "admin-evidence-copy-requests"),
    costs: fileAppendOnlyRepository<CostEntry>(resolved, "costs"),
    ownerSnapshots: fileAggregateRepository<OwnerSnapshot>(
      resolved,
      "OwnerSnapshot",
      "owner-snapshots",
    ),
    ownerSnapshotTotals: fileAggregateRepository<OwnerSnapshotTotals>(resolved, "OwnerSnapshotTotals", "owner-snapshot-totals"),
    ownerSnapshotStates: fileAggregateRepository<OwnerSnapshotState>(resolved, "OwnerSnapshotState", "owner-snapshot-states"),
    ownerSnapshotStateTotals: fileAggregateRepository<StateTotals>(resolved, "StateTotals", "owner-snapshot-state-totals"),
    ownerSnapshotInboxes: fileAggregateRepository<SpilledInbox>(resolved, "SpilledInbox", "owner-snapshot-inboxes"),
    fieldManual: (() => { const base = fileAggregateRepository<FieldManualEntry>(resolved, "FieldManualEntry", "field-manual-entries"); return fieldManualRows(base, base); })(),
    fixMap: aggregateFixMap(fileAggregateRepository<FixMapRow>(resolved, "FixMapRow", "fix-map")),
    websitePacing: memoryWebsitePacing(),
    runnerHeartbeat: fileAggregateRepository<RunnerHeartbeat>(
      resolved,
      "RunnerHeartbeat",
      "runner-heartbeat",
    ),
    cacheObservations: fileAggregateRepository<CacheObservationRecord>(
      resolved,
      "CacheObservationRecord",
      "cache-observations",
    ),
    ownerDigests: fileAppendOnlyRepository<OwnerDigestRecord>(resolved, "owner-digests"),
    ownerDecisions: fileAppendOnlyRepository<OwnerDecisionIntent>(resolved, "owner-decisions"),
    researchState: fileAggregateRepository<ResearchState>(resolved, "ResearchState", "research-state"),
    spendWindow: fileAggregateRepository<SpendWindow>(resolved, "SpendWindow", "spend-window"),
    methodCandidates: fileAggregateRepository<CandidateStore>(resolved, "MethodCandidateStore", "method-candidates"),
    researchIntents: fileAppendOnlyRepository<ResearchIntent>(resolved, "research-intents"),
    boxFindings: listedBoxRepository(fileAggregateRepository<BoxFinding>(resolved, "BoxFinding", "box-findings")),
    passCursors: fileAggregateRepository<PassCursor>(resolved, "PassCursor", "pass-cursors"),
    scoutResults: fileAppendOnlyRepository<ScoutResult>(resolved, "scout-results"),
    workerResults: fileAppendOnlyRepository<WorkerResultRecord>(resolved, "worker-results"),
    promotionPipeline: fileAppendOnlyRepository<PromotionPipelineRecord>(resolved, "promotion-pipeline"),
    windowRuns: fileAppendOnlyRepository<WindowRunRecord>(resolved, "window-runs"),
    windowIncidents: fileAppendOnlyRepository<WindowIncident>(resolved, "window-incidents"),
    windowIntents: fileAppendOnlyRepository<WindowIntent>(resolved, "window-intents"),
    softwareReleaseReviews: fileAppendOnlyRepository<SoftwareReleaseReviewRecord>(resolved, "software-release-reviews"),
    adminReceipts: fileAppendOnlyRepository<ActionReceipt>(resolved, "admin-receipts"),
    agentJobs: fileAppendOnlyRepository<AgentJobRecord>(resolved, "agent-jobs"),
    discoveryAttempts: fileAppendOnlyRepository<MeetingsDiscoveryAttempt>(resolved, "discovery-attempts"),
    liveAudits: fileAppendOnlyRepository<LiveAuditLogRow>(resolved, "live-audits"),
    adminConfig: fileAggregateRepository<AdminConfig>(resolved, "AdminConfig", "admin-config"),
    askGapObservations: fileAggregateRepository<AskGapObservation>(resolved, "AskGapObservation", "ask-gap-observations"),
    doors: fileAggregateRepository<DoorRecord>(resolved, "Door", "doors"),
    leadOrders: fileAggregateRepository<LeadOrder>(resolved, "LeadOrder", "lead-orders"),
    budget: budgetRepositoryFrom(
      fileAggregateRepository<BudgetLedger>(resolved, "BudgetLedger", "budget"),
      locks,
    ),
    locks,
    describe: () => `durable control-plane repositories rooted at ${resolved}`,
    durable: true,
  };
}
