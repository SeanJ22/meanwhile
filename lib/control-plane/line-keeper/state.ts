import { stateCodeOf } from "../unit-state.ts";
/** Canonical pointer scopes and door IDs include US-XX and percent-encoded OCD IDs. */
export function keeperState(id:string,subject:string):string|null {
  const normalize=(s:string)=>{try{s=decodeURIComponent(s);}catch{/* retain malformed IDs for the unassigned bucket */}
    return s.replace(/\bUS-([A-Z]{2})(?=[:/ ]|$)/gi,'state:$1');};
  return stateCodeOf(normalize(id),normalize(subject));
}
