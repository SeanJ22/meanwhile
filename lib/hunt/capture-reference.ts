import type {ArtifactRecord,ControlPlaneRepositories} from '../control-plane/repository/types.ts';
import type {SitePage} from './site-findings.ts';

const artifactProjection={artifactId:true,workItemId:true,attemptId:true,routeTaskId:true,tier:true,contentHash:true,byteLength:true,contentType:true,canonicalUrl:true,partial:true,recordedAt:true,publicationLink:true,permission:true,transport:true,httpStatus:true,retrievalUrl:true} as const;

/** Read the cited record, rather than a whole job's capture history. */
export async function readHuntArtifact(repos:ControlPlaneRepositories,workItemId:string,artifactId:string):Promise<ArtifactRecord|null>{
 const records=await repos.artifacts.readRecentWhere(workItemId,['artifactId'],artifactId,1,artifactProjection);
 return records[0] as ArtifactRecord|undefined??null;
}

/** The publisher looks up evidence through the reporting job. Keep a reference
 * to the original saved record there, retaining its owner, clock and bytes. */
export async function retainHuntPage(repos:ControlPlaneRepositories,workItemId:string,page:SitePage,now:string):Promise<SitePage>{
 if(!page.sourceWorkItemId || page.sourceWorkItemId===workItemId)return page;
 const record=await readHuntArtifact(repos,page.sourceWorkItemId,page.artifactId);
 if(!record || record.attemptId!==page.sourceAttemptId || record.canonicalUrl!==page.url || record.partial)throw new Error('HUNT_HELD_CAPTURE_REFERENCE_MISMATCH');
 await repos.artifacts.append(workItemId,`held:${record.workItemId}:${record.artifactId}`,record,now);
 return page;
}
