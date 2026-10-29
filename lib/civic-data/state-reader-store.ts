import {stateBallotScope} from "./state-scopes.ts";
import {readSelectedVoting} from "../reader/selected-voting.ts";
import {selectedStateEntry} from "../reader/selected-entry.ts";
import { REGISTRY_STATES, STATE_BALLOT_FAMILIES, stateFromBallotScope,stateFromRegistryRuntimeScope } from "./state-scopes.ts";
import { ballotNavigationState } from "./ballot-navigation-scope.ts";
import type { RoutineRecordClass } from "./types.ts";
import type { PromotedEdgeEntry } from "./read-model.ts";
import {readCanonicalShelf} from "../reader/canonical.ts";

type Query = (text:string,params:readonly unknown[])=>Promise<readonly Record<string,unknown>[]>;
const classes = {"ballot-contests":"BALLOT_CANDIDACY","candidate-profiles":"CANDIDATE_PROFILE","candidate-corpus":"CANDIDATE_PUBLICATION",
  "voting-sites":"VOTING_SITE","candidate-campaign-sites-derived":"CURATED_READER_RECORD"} as const;

/** Read the state section the place builder already admitted and saved. */
export async function readStateReaderEntry(query:Query,recordClass:RoutineRecordClass,scope:string):Promise<PromotedEdgeEntry> {
  const federalState = /^US-([A-Z]{2}):current-congress-directory$/.exec(scope)?.[1];
  const portraitState = /^US-([A-Z]{2}):people:portraits:v1$/.exec(scope)?.[1];
  const registrationState = /^US-([A-Z]{2}):registration:v1$/.exec(scope)?.[1];
  const state = recordClass === "REGISTRY_RUNTIME_BINDING" ? stateFromRegistryRuntimeScope(scope)
    : recordClass === "FEDERAL_DIRECTORY" && federalState ? REGISTRY_STATES.some(state => state === federalState)
    : recordClass === "STATE_LEGISLATOR" && portraitState ? REGISTRY_STATES.some(state => state === portraitState)
    : recordClass === "REGISTRATION" && registrationState ? REGISTRY_STATES.some(state => state === registrationState)
    : recordClass === "CURATED_READER_RECORD" && ballotNavigationState(scope) !== null ||
      STATE_BALLOT_FAMILIES.some(family => classes[family] === recordClass && stateFromBallotScope(scope, family));
  if (!state) throw new Error(`STATE_READER_SCOPE_INVALID:${recordClass}:${scope}`);
  if(recordClass==='VOTING_SITE'){
    const postal=REGISTRY_STATES.find(state=>stateBallotScope('voting-sites',state)===scope)!;
    return selectedStateEntry(recordClass,scope,await readSelectedVoting(async statements=>Promise.all(statements.map(s=>query(s.text,s.params))),postal,{countyFips:[]}));
  }
  const shelf=await readCanonicalShelf([{recordClass,scope}],async statements=>Promise.all(statements.map(statement=>query(statement.text,statement.params))));
  return shelf.readPromotedEntry!(recordClass,scope);
}
