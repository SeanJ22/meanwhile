import { putArtifact, type EvidenceStore } from "../evidence/store.ts";
import type { Artifact } from "../evidence/artifact.ts";
import { recordArtifactMetadata } from "../repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ScoutToolContext } from "../scheduler/scout-contract.ts";
export interface ResearchRuntimeTools {
  readonly repos: ControlPlaneRepositories;
  readonly store: EvidenceStore;
  readonly spaceOut: ScoutToolContext["spaceOut"];
  readonly browse?: ScoutToolContext["browse"];
  readonly openBytes?: ScoutToolContext["openBytes"];
  readonly openBytesFor?: (subjectId: string) => ScoutToolContext["openBytes"];
  /** Selected same-period sibling captures, brokered from canonical source and completed-rung records. */
  readonly siblingHeldRootFor?: (input:{readonly artifactId:string;readonly originWorkItemId:string;
    readonly childWorkItemId:string;readonly project:string})=>string|null|Promise<string|null>;
  readonly now: () => string;
}

/** Vault AND append attribution on each tool write, before the disposable process can disappear. */
export function durableResearchTools(input: ResearchRuntimeTools, binding: {
  project: string; attemptId: string; workItemId: string; routeTaskId: string; subjectId?: string;
}) {
  const putBytes = async (artifact: Artifact, bytes: Uint8Array) => {
    if (artifact.attemptId !== binding.attemptId || artifact.workItemId !== binding.workItemId) throw new Error("RESEARCH_VAULT_ATTEMPT_BINDING_REFUSED");
    const {key,written} = await putArtifact(input.store, binding.project, artifact, bytes);
    await recordArtifactMetadata(input.repos, {artifactId:artifact.id,attemptId:artifact.attemptId,workItemId:artifact.workItemId,
      routeTaskId:binding.routeTaskId,tier:artifact.tier,contentHash:artifact.contentHash,byteLength:artifact.byteLength,
      contentType:artifact.contentType,canonicalUrl:artifact.canonicalUrl,httpStatus:artifact.httpStatus,retrievalUrl:artifact.retrievalUrl,permission:artifact.permission,transport:artifact.transport,partial:artifact.httpStatus === 206 || artifact.extraction?.complete === false,recordedAt:artifact.retrievedAt},input.now());
    return {stored:true,where:key,why:written?"Vaulted and durably attributed before interpretation":"Identical bytes retained with this source observation"};
  };
  return {vault:async (artifact:Artifact,body:string) => putBytes(artifact,Buffer.from(body,"utf8")),vaultBytes:putBytes,
    spaceOut:input.spaceOut,...(input.browse?{browse:input.browse}:{}),
    ...(binding.subjectId && input.openBytesFor ? {openBytes:input.openBytesFor(binding.subjectId)} : input.openBytes ? {openBytes:input.openBytes} : {})};
}

