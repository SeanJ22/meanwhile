import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import ts from "typescript";
import {packReaderEvidence,readReaderEvidence,sha256,sourceEolEquivalenceProblems,type ReaderClosureReceipt,type ReaderSourceEolEquivalence} from "../../lib/holdings/reader-census.ts";

const root=process.cwd();
const receiptPath="docs/evidence/reader-last-mile-closure-receipt.json";
const receipt=JSON.parse(readReaderEvidence(root,receiptPath).toString()) as ReaderClosureReceipt;
assert.equal(receipt.sourceEolEquivalences?.length??0,0,"The executed source archives are created once, before normalization");
const exactHead=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const equivalences:ReaderSourceEolEquivalence[]=[];
const normalized:{path:string;bytes:Buffer}[]=[];
for(const [path,key] of [["app/api/ask/grounded/route.ts","grounded"],["scripts/lib/reader-ask-ballot-proof.ts","ballot-proof"]] as const){
 const raw=readFileSync(path);
 const canonical=Buffer.from(raw.toString("utf8").replace(/\r\n/g,"\n"));
 assert.notDeepEqual(raw,canonical,"An exception requires actual CRLF bytes");
 const committed=execFileSync("git",["show",`${exactHead}:${path}`]);
 assert.deepEqual(canonical,committed,"Only restore the exact existing committed LF source, without a code change");
 const declared=execFileSync("git",["check-attr","eol","--",path],{encoding:"utf8"}).trim().split(": ").at(-1);
 assert.equal(declared,"lf");
 const emitted=ts.transpileModule(raw.toString("utf8"),{fileName:path,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,newLine:ts.NewLineKind.LineFeed,sourceMap:false,inlineSourceMap:false}});
 assert.equal(emitted.diagnostics?.length??0,0);
 const archivePath=`docs/evidence/reader-last-mile-executed-source-${key}.json`;
 const archive=Buffer.from(JSON.stringify({formatVersion:1,exactHead,path,rawSourceBase64:raw.toString("base64"),canonicalGitBlobSha256:sha256(committed),scope:"Exact source bytes used by the completed reader/proof execution; Git's declared CRLF-to-LF conversion only."},null,2)+"\n");
 const equivalence:ReaderSourceEolEquivalence={path,recordedSha256:sha256(raw),canonicalLfSha256:sha256(canonical),archivePath,archiveSha256:sha256(archive),gitEol:"lf",typescriptVersion:ts.version,emittedJsSha256:sha256(emitted.outputText)};
 assert.deepEqual(sourceEolEquivalenceProblems(equivalence,archive,raw,declared),[]);
 assert.deepEqual(sourceEolEquivalenceProblems(equivalence,archive,canonical,declared),[]);
 writeFileSync(archivePath,archive);
 packReaderEvidence(root,archivePath);
 equivalences.push(equivalence); normalized.push({path,bytes:canonical});
}
writeFileSync(receiptPath,JSON.stringify({...receipt,sourceEolEquivalences:equivalences,evidenceHashes:[...receipt.evidenceHashes,...equivalences.map(row=>({path:row.archivePath,sha256:row.archiveSha256}))]},null,2)+"\n");
// Both archives and all equivalence checks must exist before restoring either
// working file to the exact already-committed Git source bytes.
for(const row of normalized)writeFileSync(row.path,row.bytes);
writeFileSync("docs/evidence/reader-last-mile-source-eol.json",JSON.stringify({exactHead,rule:"Only the two archived executed sources and their exact Git-declared LF form are equivalent; emitted JavaScript is byte-identical with diagnostics checked. Original reader execution hashes, response facts and proved head remain unchanged.",equivalences},null,2)+"\n");
console.log(JSON.stringify({exactHead,equivalences},null,2));
