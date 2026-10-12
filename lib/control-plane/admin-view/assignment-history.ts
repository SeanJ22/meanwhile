import type { AssignmentSources } from "../assignment-view.ts";

type HistorySources = Pick<AssignmentSources,"workItems"|"attempts"|"workerResults"|"artifacts"|"routeTasks">;
type Membership = { readonly workItemIds: ReadonlySet<string> };
// Only named public civic identity fields enter the search projection. Worker
// narratives, raw evidence, contacts, response text and arbitrary fields do not.
const PUBLIC_IDENTITY_FIELDS = new Set([
  "name", "personname", "candidatename", "givenname", "familyname", "fullname",
  "office", "officetitle", "bodyname", "jurisdictionname", "meetingtitle", "title",
  "meetingid", "eventid", "startat", "startsat", "date", "meetingdate", "term",
  "contestid", "candidacyid", "recordid", "committeename", "filingperiod", "topicid",
]);
const text = (value: unknown): string | null => typeof value === "string" && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim() : null;
const code = (value: unknown): string | null => typeof value === "string" && /^[A-Z][A-Z0-9_:-]*$/.test(value) ? value : null;

export function assignmentHistoryTerms(sources: HistorySources,
  memberships: ReadonlyMap<string,Membership>): ReadonlyMap<string,readonly string[]> {
  const byWork = new Map<string,Set<string>>();
  const add = (workId:string,...values:unknown[]) => {
    let terms=byWork.get(workId);
    if (!terms) { terms=new Set(); byWork.set(workId,terms); }
    for (const value of values) { const cleaned=text(value); if (cleaned) terms.add(cleaned); }
  };
  for (const item of sources.workItems) add(item.id,item.id,item.subject,item.obligation,
    item.autonomousPlan?.contract.recordClass,item.autonomousPlan?.publication?.bodyId,
    item.manualSourceGap?.contractId,item.publicationOutcome?.code,
    ...(item.publicationOutcome?.acceptedMembers?.flatMap(member=>[member.recordId,member.memberId])??[]));
  for (const attempt of sources.attempts) add(attempt.workItemId,attempt.id,attempt.worker.role,
    attempt.outcome,code(attempt.abortReason));
  for (const task of sources.routeTasks) add(task.workItemId,task.id,task.routeId,task.disposition?.disposition);
  for (const artifact of sources.artifacts) {
    let location: string|null=null;
    try { const url=new URL(artifact.canonicalUrl); if (["http:","https:"].includes(url.protocol) && !url.username && !url.password) location=url.origin+url.pathname; } catch { /* An unreadable source identity adds no invented term. */ }
    add(artifact.workItemId,artifact.artifactId,artifact.attemptId,location);
  }
  for (const row of sources.workerResults) {
    const result=row.result;
    add(row.workItemId,row.id,row.attemptId,result.role,result.verdict);
    if (result.role==="PARSER") {
      add(row.workItemId,result.recordClass,result.subjectId);
      for (const record of result.records) {
        add(row.workItemId,record.id,record.subjectId);
        for (const [field,value] of Object.entries(record.fields)) if (PUBLIC_IDENTITY_FIELDS.has(field.toLowerCase())) add(row.workItemId,value);
      }
      for (const finding of result.warnings) add(row.workItemId,code(finding.code),finding.recordId);
    } else if ("findings" in result) {
      for (const finding of result.findings) add(row.workItemId,code(finding.code));
    }
  }
  return new Map([...memberships].map(([id,membership])=>[id,[...new Set([...membership.workItemIds]
    .flatMap(workId=>[...(byWork.get(workId)??[])]))].sort()]));
}
