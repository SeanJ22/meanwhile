import type { PinGeocodeAttempt } from "../meetings/publish-pins.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { datePath, extensionFor } from "../control-plane/evidence/store.ts";
import type { ArtifactRecord } from "../control-plane/repository/types.ts";
import { readPassCursor, writePassCursor } from "../facts/db.ts";
import { vaultCapture } from "../facts/capture.ts";
import type { Clocks, FactDb, Query } from "../facts/publish.ts";
import { passDeadlineFromEnv } from "../ops/independent-runtime-pass.ts";
import type { Meeting } from "../sources/types.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";
import type { SourceHead } from "./store.ts";
import { heldCaptureAtKey } from "./worker-publication-context.ts";
import { publishCapturedMeetingFacts } from "./meeting-fact-publication.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import { meetingFactWorkRemains } from "./meeting-source-confirmation.ts";

interface SourceRef {
  readonly source: string; readonly requestedUrl: string; readonly finalUrl: string; readonly rawHash: string;
  readonly record: ArtifactRecord | null; readonly key: string | null;
}
interface Cursor {
  readonly formatVersion: 1; readonly candidateId: string; readonly scope: string; readonly meetingIds: readonly string[];
  readonly geocodeAttempts?: readonly (readonly [string,readonly PinGeocodeAttempt[]])[];
  readonly index: number; readonly complete: boolean; readonly sources: readonly SourceRef[];
}
const cursorKey = (candidateId: string) => `meeting-facts:${candidateId}`;
const sourceKey = (record: ArtifactRecord) => `project/freshness/source/${new URL(record.canonicalUrl).hostname.toLowerCase()}/${datePath(record.recordedAt)}/${record.workItemId}/${record.contentHash}.${extensionFor(record.contentType)}`;
async function readCursor(query: Query, candidateId: string): Promise<Cursor | null> {
  const saved = await readPassCursor(query, cursorKey(candidateId));
  if (saved === null) return null;
  const cursor = JSON.parse(saved) as Cursor;
  if (cursor.formatVersion !== 1 || cursor.candidateId !== candidateId || typeof cursor.scope!=="string" || typeof cursor.complete!=="boolean" || !Array.isArray(cursor.meetingIds) || !Array.isArray(cursor.sources) ||
    !Number.isSafeInteger(cursor.index) || cursor.index < 0 || cursor.index > cursor.meetingIds.length) throw new Error("MEETING_FACT_CURSOR_INVALID");
  return cursor;
}

/** Stage durable remaining work before the candidate becomes current; no fact is published before promotion. */
export async function stageMeetingFactPublication(input: {
  readonly facts: FactDb & {readonly query:Query}; readonly vault: EvidenceStore; readonly scope: string;
  readonly candidateId: string; readonly meetings: readonly Meeting[]; readonly responses: readonly RetainedSourceResponse[];
  readonly geocodeAttempts?: ReadonlyMap<string,readonly PinGeocodeAttempt[]>;
}): Promise<void> {
  if ((await input.facts.query("SELECT EXISTS(SELECT 1 FROM pass_cursor WHERE name=$1) AS held",[cursorKey(input.candidateId)]))[0]?.held===true) return;
  const refs = [...new Map(input.responses.map(page => [`${page.finalUrl}:${page.rawHash}`, page])).values()];
  const sources: SourceRef[] = [];
  for (const response of refs) {
    let record: ArtifactRecord | null = null;
    try {
      const saved = await vaultCapture({vault:input.vault,url:response.finalUrl,bytes:response.bytes,httpStatus:response.httpStatus,contentType:response.contentType,retrievedAt:response.retrievedAt});
      if (!("error" in saved)) record = saved.record;
      else console.warn(`MEETING_FACT_SOURCE_UNSAVED ${response.finalUrl}: ${saved.error}`);
    } catch(error) { console.warn(`MEETING_FACT_SOURCE_UNSAVED ${response.finalUrl}: ${error instanceof Error?error.message:String(error)}`); }
    sources.push({source:response.source,requestedUrl:response.requestedUrl,finalUrl:response.finalUrl,rawHash:response.rawHash,record,key:record ? sourceKey(record) : null});
  }
  const meetingIds = [...new Set(input.meetings.filter(meeting=>!meeting.carried).map(meeting=>meeting.id))];
  const geocodeAttempts=input.geocodeAttempts?[...input.geocodeAttempts].filter(([id])=>meetingIds.includes(id)):undefined;
  const cursor: Cursor = {geocodeAttempts,formatVersion:1,candidateId:input.candidateId,scope:input.scope,meetingIds,index:0,complete:meetingIds.length===0,sources};
  await writePassCursor(input.facts.query,cursorKey(input.candidateId),JSON.stringify(cursor));
}

/** Resume one accepted record at a time; a partially written record retains its index and its exact saved evidence. */
export async function continueMeetingFactPublication(input: {
  readonly facts: FactDb & {readonly query:Query}; readonly vault: EvidenceStore; readonly candidateId:string; readonly clocks:Clocks; readonly now:Date;
  readonly meetings?:readonly Meeting[]; readonly observations?:readonly RetainedSourceResponse[]; readonly deadlineMs?:number;
}):Promise<{readonly complete:boolean;readonly live:number;readonly confirmed:number;readonly held:number;readonly blanks:number}> {
  const tally = {live:0,confirmed:0,held:0,blanks:0};
  const [summary]=await input.facts.query("SELECT position::jsonb->>'complete' AS complete FROM pass_cursor WHERE name=$1",[cursorKey(input.candidateId)]);
  if (!summary || summary.complete==="true") return {...tally,complete:true};
  const cursor = await readCursor(input.facts.query,input.candidateId);
  if (!cursor || cursor.complete) return {...tally,complete:true};
  if (cursor.index===cursor.meetingIds.length) {
    await writePassCursor(input.facts.query,cursorKey(cursor.candidateId),JSON.stringify({...cursor,complete:true}));
    return {...tally,complete:true};
  }
  const deadlineMs = input.deadlineMs ?? passDeadlineFromEnv()-30_000;
  const captures: WorkerPublicationCapture[] = [];
  for (const source of cursor.sources) {
    if (Date.now()>=deadlineMs) return {...tally,complete:false};
    let capture = source.record && source.key ? await heldCaptureAtKey(input.vault,source.record,source.key) : null;
    const observed = input.observations?.find(page=>page.requestedUrl===source.requestedUrl&&page.finalUrl===source.finalUrl&&page.rawHash===source.rawHash);
    if (!capture && observed?.bytes.length) {
      const saved = await vaultCapture({vault:input.vault,url:observed.finalUrl,bytes:observed.bytes,httpStatus:observed.httpStatus,contentType:observed.contentType,retrievedAt:observed.retrievedAt});
      if (!("error" in saved)) capture=saved.capture;
    }
    if (!capture) return {...tally,complete:false};
    captures.push(observed ? {...capture,observedAt:observed.retrievedAt,rawContentHash:`sha256-${source.rawHash}`} : capture);
  }
  const pending=cursor.meetingIds.slice(cursor.index),byId=new Map(input.meetings?.map(meeting=>[meeting.id,meeting]));
  const wanted=pending.filter(id=>!byId.has(id));
  if (wanted.length) for (const row of await input.facts.query(`SELECT r.row_id AS id,reader_payload_value(jsonb_build_object(
      'id',r.value->'id','bodyId',r.value->'bodyId','ocdId',r.value->'ocdId','bodyName',r.value->'bodyName','title',r.value->'title',
      'startsAt',r.value->'startsAt','timeZone',r.value->'timeZone','startPrecision',r.value->'startPrecision','location',r.value->'location',
      'online',r.value->'online','mapPin',r.value->'mapPin','agendaUrl',r.value->'agendaUrl','videoUrl',r.value->'videoUrl',
      'jurisdiction',r.value->'jurisdiction','status',r.value->'status','provenance',r.value->'provenance','venueGap',r.value->'venueGap')) AS meeting
      FROM civic_data_promotions p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
      WHERE p.key=$1 AND p.current_version_id=$2 AND r.collection='meetings' AND r.row_id=ANY($3::text[])`,[`MEETING:${cursor.scope}`,cursor.candidateId,wanted])) byId.set(String(row.id),row.meeting as Meeting);
  // A meeting that cannot be found stops the pass at that meeting; the ones before it still publish.
  const meetings:Meeting[]=[];
  for (const id of pending) { const meeting=byId.get(id); if (!meeting||meeting.id!==id||meeting.carried) break; meetings.push(meeting); }
  const report=await publishCapturedMeetingFacts({facts:input.facts,meetings,captures,geocodeAttempts:new Map(cursor.geocodeAttempts??[]),producedBy:cursor.candidateId,clocks:input.clocks,now:input.now,deadlineMs,
    onProgress:done=>writePassCursor(input.facts.query,cursorKey(cursor.candidateId),JSON.stringify({...cursor,index:cursor.index+done,complete:cursor.index+done===cursor.meetingIds.length}))});
  return {...report,complete:report.complete&&meetings.length===pending.length};
}

/** Called after the parsed meetings and agenda content match the accepted source. */
export async function finishUnchangedMeetingFacts(input: {
  readonly facts:FactDb&{readonly query:Query};readonly vault:EvidenceStore;readonly head:Pick<SourceHead,"versionId">|null;readonly observations:readonly RetainedSourceResponse[];
  readonly clocks:Clocks;readonly now:Date;
}):Promise<boolean> {
  if (!input.head) return true;
  return (await continueMeetingFactPublication({...input,candidateId:input.head.versionId})).complete;
}

/** Complete already admitted field work before an unchanged source is allowed to skip its held output. */
export async function meetingFactsAfterSourceCheck(input: {
  readonly facts:FactDb&{readonly query:Query};readonly vault:EvidenceStore;readonly head:Pick<SourceHead,"versionId">|null;readonly observations:readonly RetainedSourceResponse[];
  readonly clocks:Clocks;readonly at:string;readonly meetingIds:readonly string[];readonly bodyIds:readonly string[];
}):Promise<boolean> {
  const complete=await finishUnchangedMeetingFacts({...input,now:new Date(input.at)});
  if (!complete && Date.now()>=passDeadlineFromEnv()-30_000) throw new Error("MEETING_FACT_PUBLICATION_CONTINUATION_PENDING");
  return !complete || await meetingFactWorkRemains(input.facts.query,input.meetingIds,input.bodyIds,input.at);
}
