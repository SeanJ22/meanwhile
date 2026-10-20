import assert from "node:assert/strict";
import { mergeEntry,newFieldManualEntry,normalizeEntry,type FieldManualEntry } from "../../lib/control-plane/field-manual.ts";
import { canonicalJson,type FieldManualRepository } from "../../lib/control-plane/repository/types.ts";

export const MANUAL_MERGE_NOW="2026-10-20T12:00:00.000Z";
const place=(state:string)=>`ocd-division/country:us/state:${state}/place:example`;
const entry=(id:string,fields:Partial<FieldManualEntry>={}):FieldManualEntry=>({...newFieldManualEntry("merge-fixture",id,
  {role:"SHARED",kind:"METHOD",title:"Read the official directory",summary:"Read the saved source",outcome:"YIELDED",observedAt:"2026-10-18T00:00:00Z"}),id,...fields});

export function fieldManualMergeCases():readonly (readonly FieldManualEntry[])[]{return[
  [entry("scopes",{ocdIds:[place("az")],bodyIds:["az-board"],platforms:["Legistar"],recordClasses:["Meetings"],payload:{places:["az:one"],doorEntryIds:["door-a"],procedure:"first"},foundBy:"SCOUT"}),
    entry("scopes",{states:["NJ"],platforms:["CivicPlus"],recordClasses:["Officials"],portable:true,outcome:"FAILED",observedAt:"2026-10-19T00:00:00Z",payload:{places:["nj:one"],doorEntryIds:["door-b"],procedure:"new"},foundBy:"DETECTIVE"}),
    entry("scopes",{ocdIds:[place("nh")],observedAt:"2026-10-01T00:00:00Z",payload:{places:["nh:one"],doorEntryIds:["door-a"],procedure:"stale"}})],
  [entry("ties",{states:["az"]}),entry("ties",{states:["az"],outcome:"FAILED"}),entry("ties",{states:["az"],outcome:"YIELDED"}),
    entry("ties",{states:["az"],outcome:"YIELDED",observedAt:"2026-10-19T00:00:00Z"})],
  [entry("fields",{kind:"PARSE_FIELDS",payload:{fieldNames:["name","office"],opaque:{retained:true}}}),
    entry("fields",{kind:"PARSE_FIELDS",payload:{fieldNames:["name","term"],opaque:{retained:false}},observedAt:"2026-10-01"})],
  [entry("partial",{ocdIds:[place("az"),place("nj")],placeResults:[{place:place("az"),observedAt:"2026-10-19",outcome:"FAILED"}],placeResultsPartial:true}),
    entry("partial",{states:["nh"],placeResults:[{place:place("az"),observedAt:"2026-10-20",outcome:"YIELDED"}],observedAt:"2026-10-19"})],
  [entry("duplicates",{placeResults:[{place:place("az"),observedAt:"2026-10-19",outcome:"FAILED"},{place:place("az"),observedAt:"2026-10-17",outcome:"YIELDED"}]}),
    entry("duplicates",{placeResults:[{place:place("az"),observedAt:"2026-10-20",outcome:"ZERO"},{place:place("az"),observedAt:"2026-10-21",outcome:"YIELDED"}]})],
  [entry("nullable",{observedAt:null,payload:null}),entry("nullable",{kind:"ROUTE_NOTE",observedAt:null,payload:{plain:"latest"}})],
  [entry("legacy-array",{payload:["kept",{source:"official"}]}),entry("legacy-array",{observedAt:"2026-10-01",payload:{places:["own-place"]}})],
  [entry("legacy-string",{kind:"PARSE_FIELDS",payload:"kept"}),entry("legacy-string",{kind:"PARSE_FIELDS",observedAt:"2026-10-01",payload:{fieldNames:["name"]}})],
];}

export async function verifyFieldManualMerge(repo:FieldManualRepository):Promise<void>{
  for(const observations of fieldManualMergeCases()){
    let expected:FieldManualEntry|null=null,revision:number|null=null;
    for(const observation of observations){
      expected=mergeEntry(expected,observation);
      const next=await repo.compareAndSetMergedEntry(observation.id,revision,normalizeEntry(observation),MANUAL_MERGE_NOW);
      revision=next.revision;
      const actual=(await repo.mustRead(observation.id)).value;
      assert.equal(canonicalJson(actual),canonicalJson(expected),`${observation.id}: ${observation.observedAt}`);
    }
    await assert.rejects(repo.compareAndSetMergedEntry(observations[0].id,0,normalizeEntry(observations[0]),MANUAL_MERGE_NOW),/[Cc]oncurrent|revision/);
    const normalized=normalizeEntry(observations.at(-1)!);
    const once=await repo.compareAndSetMergedEntry(normalized.id,revision,normalized,MANUAL_MERGE_NOW);
    const twice=await repo.compareAndSetMergedEntry(normalized.id,once.revision,normalized,MANUAL_MERGE_NOW);
    assert.equal(twice.changed,false,"an identical observation is idempotent after its recorded merge");
  }
}
