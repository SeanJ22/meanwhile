import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {writeFileSync} from "node:fs";
import {readReaderEvidence,sha256,type ReaderSurfaceClassWitness} from "../../lib/holdings/reader-census.ts";
const root=process.cwd();const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const descriptors:ReaderSurfaceClassWitness[]=[];
for(const [name,surface,component] of [
 ["ballot","ballot","components/ballot/candidate-card.tsx"],
 ["positions","ballot","components/officials/positions-section.tsx"],
 ["civic","civic-routing","components/ask/ask-box.tsx"],
] as const){
 const evidencePath=`docs/evidence/reader-last-mile-${name}.json`;const bytes=readReaderEvidence(root,evidencePath);const data=JSON.parse(bytes.toString());
 assert.equal(data.exactHead,head,`${name}: exact-head browser witness`);
 if(name==="ballot")assert.ok(data.rows.length&&data.rows.every((row:{proofs:unknown[]})=>row.proofs.length));
 if(name==="positions"){assert.equal(data.unresolved.length,0);assert.equal(data.proofs.length+data.dispositions.length,data.expectedCount);}
 if(name==="civic"){assert.equal(data.expectedCount,data.renderedCount);assert.ok(data.layoutProofs.length);}
 descriptors.push({surface,component,exactHead:head,evidencePath,evidenceSha256:sha256(bytes)});
}
writeFileSync("docs/evidence/reader-last-mile-root-witnesses.json",JSON.stringify(descriptors,null,2)+"\n");
console.log(JSON.stringify(descriptors,null,2));
