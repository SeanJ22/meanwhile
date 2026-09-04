import assert from "node:assert/strict";
import {existsSync,writeFileSync} from "node:fs";
import {packReaderEvidence,readReaderEvidence,sha256,type ReaderClosureReceipt} from "../../lib/holdings/reader-census.ts";
import {floored} from "../../lib/ops/denominator-floor.ts";
const root=process.cwd();
const receiptPath="docs/evidence/reader-last-mile-closure-receipt.json";
const receipt=JSON.parse(readReaderEvidence(root,receiptPath).toString()) as ReaderClosureReceipt;
const reviews=["root-image-review-d9dc","finance-image-review-d9dc2010","ask-image-review-d9dc","civic-image-review-d9dc"];
const reviewHashes=reviews.map(name=>{
 const path=`docs/evidence/reader-last-mile-${name}.json`;
 const bytes=readReaderEvidence(root,path);
 const review=JSON.parse(bytes.toString()) as {exactHead:string;images:{path:string;sha256:string;result:string}[]};
 assert.equal(review.exactHead,"d9dc2010f8a34766cd2a24ed672a64ac448619e9");
 floored(`reviewed original images: ${name}`,"every original image assigned to this reader proof review",review.images.length,review.images.filter(image=>image.result==="PASS").length);
 for(const image of review.images)assert.equal(sha256(readReaderEvidence(root,image.path)),image.sha256,`Reviewed image changed: ${image.path}`);
 return {path,sha256:sha256(bytes)};
});
writeFileSync(receiptPath,JSON.stringify({...receipt,evidenceHashes:[...receipt.evidenceHashes.filter(row=>!reviewHashes.some(review=>review.path===row.path)),...reviewHashes]},null,2)+"\n");
// Explicitly scoped, lossless evidence files. Root and Ask owners authorized
// their frozen route/Ask/body outputs after closure; original hashes survive.
const names=["current","current-projection","current-components","closure","closure-route-proof-composition","closure-component-proof-composition","qualification-check","qualification-check-projection","ask-composed","routes","key-votes-ask","bodies","ask-exhaustive","surface-witnesses","root-image-review-d9dc","finance-image-review-d9dc2010"];
const packed=[];
for(const name of names){const path=`docs/evidence/reader-last-mile-${name}.json`;if(existsSync(path)){const row=packReaderEvidence(root,path);packed.push(row);console.log(JSON.stringify(row));}}
writeFileSync("docs/evidence/reader-last-mile-final-pack.json",JSON.stringify({formatVersion:1,rule:"Original bytes and hashes preserved; gzip modification time zero. Existing baseline is untouched.",files:packed},null,2)+"\n");
