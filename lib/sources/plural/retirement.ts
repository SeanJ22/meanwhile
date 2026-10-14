import { normalize, yamlToPeople } from "./index.ts";
import { pluralRetirementCheckConsumer } from "./targets.ts";
import type { CandidateVersionRecord, DependentCheck, RoutineCandidate } from "../../civic-data/types.ts";
import type { StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import type { Officeholder, OfficeholderSet, PersonMembership } from "../../officials/types.ts";
import { sameOffice } from "../../officials/office-identity.ts";

const MAX_NATIVE_RECORD_BYTES = 16 * 1024 * 1024;

/** Reuse the native parser only in the publication worker; generic Readers do not load YAML. */
export function statePeopleRetirementSourceCheck(candidate:RoutineCandidate,prior:CandidateVersionRecord|null,now:string):DependentCheck {
  const consumer=pluralRetirementCheckConsumer(candidate,prior);
  const fail=(detail:string):DependentCheck=>({consumer,passed:false,detail});
  if (!prior) return fail("Native tenure retirement has no held predecessor.");
  const ended=(candidate.readModel as {roster?:OfficeholderSet})?.roster?.endedMemberships ?? [];
  const cache=new Map<string,{memberships:readonly PersonMembership[];ended:readonly PersonMembership[]}>();
  const capturedMemberships=(source:RoutineCandidate,url:string,asOf:string)=>{
    const key=`${source.id}|${url}|${asOf}`;
    if (cache.has(key)) return cache.get(key)!;
    const match=/^https:\/\/raw\.githubusercontent\.com\/openstates\/people\/([a-f0-9]{40})\/(.+)$/.exec(url);
    const acquisitions=(source.normalizedPayload as {acquisitions?:readonly StatePeopleAcquisition[]})?.acquisitions ?? [];
    const acquisition=acquisitions.find(row=>match && row.extractedFrom?.member === match[2] &&
      row.requestedUrl === `https://codeload.github.com/openstates/people/zip/${match[1]}`);
    if (!acquisition || !acquisition.body || Buffer.byteLength(acquisition.body,"utf8")>MAX_NATIVE_RECORD_BYTES) throw Error("The exact bounded native record capture is unavailable.");
    const state=source.scope.slice(3,5).toLowerCase();
    const parsed=yamlToPeople(acquisition.body,state,url,asOf,()=>{},true);
    const roster=normalize(parsed,new Map(),acquisition.retrievedAt,`US-${state.toUpperCase()}`);
    const result={memberships:[...roster.officeholders.flatMap(person=>person.memberships ?? []),...(roster.endedMemberships ?? [])],ended:roster.endedMemberships ?? []};
    cache.set(key,result); return result;
  };
  const sameTenure=(left:PersonMembership,right:PersonMembership)=>left.id === right.id && left.personId === right.personId &&
    sameOffice(left.officeTitle,right.officeTitle) && (left.district ?? null) === (right.district ?? null) &&
    left.jurisdiction === right.jurisdiction && (left.termStart ?? null) === (right.termStart ?? null);
  try {
    for (const delta of candidate.changeSet?.removed ?? []) {
      const person=delta.before as Officeholder;
      for (const membership of (person.memberships ?? []).filter(row=>row.current !== false)) {
        const priorRows=capturedMemberships(prior.candidate,membership.sourceUrl,prior.receipt?.validatedAt ?? prior.candidate.retrieval.retrievedAt).memberships;
        if (!priorRows.some(row=>sameTenure(row,membership) && (row.termEnd ?? null) === (membership.termEnd ?? null))) return fail(`The held source does not state native tenure ${membership.id}.`);
        const end=ended.find(row=>sameTenure(row,membership));
        if (!end) return fail(`No exact ended native tenure is held for ${membership.id}.`);
        const currentRows=capturedMemberships(candidate,end.sourceUrl,now).ended;
        if (!currentRows.some(row=>sameTenure(row,end) && row.officeId === end.officeId && row.current === false && row.termEnd === end.termEnd)) return fail(`The captured native source does not state end ${end.termEnd ?? ""} for ${membership.id}.`);
      }
    }
    return {consumer,passed:true,detail:"The original and updated native YAML independently establish every affected person, office, tenure and explicit past end date."};
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
