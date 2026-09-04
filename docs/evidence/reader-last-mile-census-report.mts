import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {readReaderEvidence,readerCensusSummary,censusClosureFailures,type ReaderCensus} from "../../lib/holdings/reader-census.ts";
import {floored} from "../../lib/ops/denominator-floor.ts";
const root=process.cwd();
const census=JSON.parse(readReaderEvidence(root,"docs/evidence/reader-last-mile-closure.json").toString()) as ReaderCensus;
assert.deepEqual(censusClosureFailures(census),[],"Report requires the complete, executed reader graph");
const summary=readerCensusSummary(census);
floored("closed reader dataset families","all canonical families declaring reader surfaces",census.denominator.families,summary.filter(row=>row.remainingUnprovedSurfaceRecordPairs===0).length);
const prl=JSON.parse(readReaderEvidence(root,"docs/evidence/reader-last-mile-prl-before.json").toString()) as {records:{canonicalIdentity:string;status:string}[]};
const prlCurrent=new Set(census.rows.filter(row=>row.datasetFamily==="prl").flatMap(row=>(row.applicableEligibleRecordIds??row.eligibleRecordIds).flatMap(id=>row.canonicalIdentityByRecord[id])));
const prlBefore=prl.records.filter(row=>row.status==="ELIGIBLE_BUT_NOT_RENDERED"&&prlCurrent.has(row.canonicalIdentity)).length;
const meetingBefore=JSON.parse(readReaderEvidence(root,"docs/evidence/reader-last-mile-meeting-list-before.json").toString()) as {before:{statedMeetingCount:number;renderedMeetingRows:number}};
const cells=(value:unknown)=>String(value).replaceAll("|","\\|");
const lines=["# Reader last-mile family census","",`The canonical denominator is ${census.denominator.families} families and ${census.denominator.declaredEdges} declared reader edges. Counts below are typed source records, not interchangeable people, meetings or files. The record-level census preserves each family's units and child dispositions. Eligible source inputs can have zero direct record obligations; their actual downstream selectors and scope reasons remain in the census.`,"","Before counts remain UNMEASURED except the stated lower bounds from independently observed controls. Lower bounds do not imply the rest of that family's old graph was measured. After counts are computed only after complete route/render/bundle reconciliation.","","| Dataset family | Declared reader surfaces | Reader-eligible source records | Staged/not eligible | Applicable unique records | False negatives before | False negatives after | False positives after |","| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |"];
for(const row of summary){
 const before=row.family==="prl"?`at least ${prlBefore}; full before UNMEASURED`:row.family==="meetings"?`at least ${meetingBefore.before.statedMeetingCount-meetingBefore.before.renderedMeetingRows} in the measured ungrouped-list query; full before UNMEASURED`:row.family==="state-money"?"at least 1 known production control (Katie Hobbs); full before UNMEASURED":"UNMEASURED";
 lines.push(`| ${[row.family,row.surfaces.join(", "),row.readerEligibleRecords,row.withheldRecords,row.applicableUniqueRecords,before,row.measuredFalseNegativesAfter,row.measuredFalsePositivesAfter].map(cells).join(" | ")} |`);
}
lines.push("","The immutable baseline is reader-last-mile-baseline.json.gz. PRL's before source inventory contained 536 disconnected profiles; only identities with a current applicable reader surface contribute to the applicable lower bound above. The meeting lower bound is a measured reader query, not a claim that the entire old meeting graph was tested. The Katie Hobbs control is corroborated by the finance-before class-wide generic-FEC seam.","","Full source/identity/projection/surface and withholding reasons: reader-last-mile-closure.json.gz. Permanent current-source validity: reader-last-mile-closure-receipt.json.","");
writeFileSync("docs/evidence/reader-last-mile-census-report.md",lines.join("\n"));
writeFileSync("docs/evidence/reader-last-mile-closure-summary.json",JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify({families:summary.length,remaining:summary.reduce((sum,row)=>sum+row.remainingUnprovedSurfaceRecordPairs,0)}));
