import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {readReaderEvidence,sha256,type ReaderCensus,type ReaderClosureReceipt,type ReaderSourceHash} from "../../lib/holdings/reader-census.ts";
import {floored} from "../../lib/ops/denominator-floor.ts";
const root=process.cwd();
const receiptPath="docs/evidence/reader-last-mile-closure-receipt.json";
const receipt=JSON.parse(readReaderEvidence(root,receiptPath).toString()) as ReaderClosureReceipt;
const census=JSON.parse(readReaderEvidence(root,receipt.censusPath).toString()) as ReaderCensus;
const physical=(path:string)=>existsSync(path)?path:`${path}.gz`;
const paths=new Set<string>([receiptPath,physical(receipt.censusPath),...receipt.sourceHashes.map(row=>row.path),...census.holdings.map(row=>row.path)]);
const sourceHashes:ReaderSourceHash[]=[...receipt.sourceHashes];
for(const evidence of receipt.evidenceHashes){
 const bytes=readReaderEvidence(root,evidence.path);
 assert.equal(sha256(bytes),evidence.sha256,`Original evidence hash must survive packaging: ${evidence.path}`);
 paths.add(physical(evidence.path));
 const parsed=JSON.parse(bytes.toString()) as {sourceHashes?:ReaderSourceHash[]|Record<string,string>};
 if(Array.isArray(parsed.sourceHashes))sourceHashes.push(...parsed.sourceHashes);
 else if(parsed.sourceHashes)sourceHashes.push(...Object.entries(parsed.sourceHashes).map(([path,hash])=>({path,sha256:hash})));
}
const exceptions:ReaderSourceHash[]=[];
for(const source of sourceHashes){
 paths.add(source.path);
 const actual=sha256(readFileSync(source.path));
 if(actual!==source.sha256){
  const equivalence=receipt.sourceEolEquivalences?.find(row=>row.path===source.path&&row.recordedSha256===source.sha256&&row.canonicalLfSha256===actual);
  assert.ok(equivalence,`No undocumented source-byte conversion: ${source.path}`);
  exceptions.push(source);
 }
}
const files=[...paths].sort();
const input=files.join("\n")+"\n";
// hash-object without -w is read-only. Git applies its real clean/eol rules;
// comparing against --no-filters proves prospective index bytes stay exact.
const filtered=execFileSync("git",["hash-object","--stdin-paths"],{input,encoding:"utf8",maxBuffer:1024*1024*4}).trim().split("\n");
const raw=execFileSync("git",["hash-object","--no-filters","--stdin-paths"],{input,encoding:"utf8",maxBuffer:1024*1024*4}).trim().split("\n");
assert.equal(filtered.length,files.length);assert.equal(raw.length,files.length);
const failures=files.filter((_,i)=>filtered[i]!==raw[i]);
floored("portable evidence and source paths","every committed closure artifact, holding and declared execution source",files.length,files.length-failures.length);
writeFileSync("docs/evidence/reader-last-mile-portability.json",JSON.stringify({formatVersion:1,rule:"Actual Git clean/eol filtered hashes equal raw file hashes for every prospective committed path. Executed mixed-EOL source hashes retain only the two explicit archived receipt equivalences.",paths:files.map((path,i)=>({path,rawGitObject:raw[i],prospectiveGitObject:filtered[i]})),sourceHashClaims:sourceHashes.length,explicitEolEquivalentPaths:[...new Set(exceptions.map(row=>row.path))],failures},null,2)+"\n");
assert.deepEqual(failures,[]);
console.log(JSON.stringify({paths:files.length,sourceHashClaims:sourceHashes.length,explicitEolEquivalentPaths:[...new Set(exceptions.map(row=>row.path))],failures}));
