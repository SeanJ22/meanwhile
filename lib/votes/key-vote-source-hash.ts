import { sourceContentHash } from "../civic-data/source-hash.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import type { FederalKeyVotesSnapshot,HeldAcquisition } from "./data-plane.ts";

export interface FederalKeyVoteSourceProbe {
  readonly formatVersion:1;readonly selectionHash:string;readonly identifierSourceHash:string;readonly identifierSourceUrl:string;readonly complete:boolean;
}
/** Reviewed wording and roll identities are inputs; refreshed official questions/tallies and read dates are outputs. */
export function keyVoteSelectionInputHash(snapshot:FederalKeyVotesSnapshot):string {
  const {fetchedAt:_fetchedAt,...selection}=snapshot;
  return canonicalCivicDataHash({...selection,entries:selection.entries.map(entry=>({...entry,
    house:entry.house.map(({question:_question,tally:_tally,verifiedAt:_verifiedAt,...ref})=>ref),
    senate:entry.senate.map(({question:_question,tally:_tally,verifiedAt:_verifiedAt,...ref})=>ref),
  }))});
}
export function federalKeyVoteSourceHash(acquisitions:readonly HeldAcquisition[],probe:FederalKeyVoteSourceProbe):string {
  return sourceContentHash(acquisitions.map(row=>({...row,capture:{rawHash:row.rawHash},request:{httpStatus:row.httpStatus}})),
    {parserVersion:"federal-votes/2",schemaVersion:"federal-key-votes:selection-v1",selectionHash:probe.selectionHash,
      identifierSourceHash:probe.identifierSourceHash,identifierSourceUrl:probe.identifierSourceUrl});
}
