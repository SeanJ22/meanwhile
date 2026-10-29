import { createHash } from "node:crypto";
import { recordAcquisition, type Artifact } from "../../control-plane/evidence/artifact.ts";
import { artifactMeta, objectKey, objectIncompatibility, readArtifact, type EvidenceStore } from "../../control-plane/evidence/store.ts";
import { holdRawCapture } from "../../civic-data/raw-capture-vault.ts";
import { rawCapturePointer, rawCaptureMetadata } from "../../control-plane/evidence/raw-pointer.ts";
import { FRESHNESS_PROJECT } from "../../control-plane/scheduler/durable.ts";
import { memberReading } from "./members-model.ts";

export async function saveLegistarReading(vault: EvidenceStore, slug: string, reading: {
  url: string; text: string; retrievedAt: string; body: unknown;
}) {
  const { artifact } = recordAcquisition({ canonicalUrl: reading.url, retrievedAt: reading.retrievedAt, httpStatus: 200, contentType: "application/json",
    sourceId: `legistar:${slug}`, methodRouteId: "legistar-members", workItemId: `legistar-members:${slug}`, attemptId: reading.retrievedAt,
    permission: "ALLOWED", transport: "REACHABLE" }, reading.text);
  if(artifact.tier!=="RAW")throw Error("LEGISTAR_MEMBERS_SOURCE_RESTRICTED");
  const key=objectKey(FRESHNESS_PROJECT,artifact),meta=artifactMeta(artifact),held=await vault.head(key);
  if(held) {
    if(objectIncompatibility(rawCaptureMetadata(held),meta))throw Error("LEGISTAR_MEMBERS_SOURCE_METADATA_MISMATCH");
  }else{
    const ref=await holdRawCapture(vault,artifact.sourceId,reading.text,"application/json");
    const pointer=rawCapturePointer(ref,meta);
    await vault.put(key,pointer.bytes,pointer.meta);
  }
  return memberReading(artifact, reading.body);
}

export type MemberArtifact = Pick<Artifact,"id"|"contentHash"|"byteLength"|"canonicalUrl"|"retrievedAt">;
export const memberArtifactPointer = ({id,contentHash,byteLength,canonicalUrl,retrievedAt}:Artifact):MemberArtifact =>
  ({id,contentHash,byteLength,canonicalUrl,retrievedAt});
export function memberArtifact(reference:MemberArtifact):Artifact {
  const url=new URL(reference.canonicalUrl),slug=/^\/v1\/([a-z0-9_-]+)\/(bodies|persons|officerecords)$/.exec(url.pathname)?.[1];
  if(url.origin!=="https://webapi.legistar.com"||!slug)throw Error("LEGISTAR_MEMBERS_SOURCE_ROUTE_INVALID");
  return {...reference,tier:"RAW",contentType:"application/json",retrievalUrl:reference.canonicalUrl,httpStatus:200,headers:{},
    sourceId:`legistar:${slug}`,methodRouteId:"legistar-members",workItemId:`legistar-members:${slug}`,attemptId:reference.retrievedAt,
    permission:"ALLOWED",transport:"REACHABLE",retentionPolicy:"EVIDENCE_PERMANENT"};
}

export async function legistarMemberCapture(vault: EvidenceStore, reference: MemberArtifact) {
  const artifact=memberArtifact(reference);
  const held = await readArtifact(vault, FRESHNESS_PROJECT, artifact, "PARSER");
  if (`sha256-${createHash("sha256").update(held.bytes).digest("hex")}` !== artifact.contentHash || held.bytes.byteLength !== artifact.byteLength) throw new Error("LEGISTAR_MEMBERS_CACHE_HASH_INVALID");
  return { evidence: { artifactId: artifact.id, contentHash: artifact.contentHash, text: held.text, acquiredByAttemptId: artifact.attemptId,
    canonicalUrl: artifact.canonicalUrl, retrievedAt: artifact.retrievedAt, sourceId: artifact.sourceId, methodRouteId: artifact.methodRouteId },
    observedAt: artifact.retrievedAt, httpStatus: 200, transport: "REACHABLE" as const, partial: false };
}
