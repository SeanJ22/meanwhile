import { acquireKnownRelease, knownReleaseSourceCheck, type KnownReleaseOptions } from "../sources/known-release.ts";
import { readCompleteResponse } from "../sources/source-bytes.ts";
const URL = "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1";
function sourceSha(bytes: Uint8Array): string {
  const rows:unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  const sha=Array.isArray(rows) ? rows[0]?.sha : null;
  if(typeof sha!=="string" || !/^[a-f0-9]{40}$/i.test(sha))throw Error("CONGRESS_SOURCE_REVISION_INVALID");
  return sha.toLowerCase();
}
/** The source revision is shared daily; every data file is then immutable at this revision. */
export async function currentCongressSourceRevision(request?: typeof fetch):Promise<string> {
  if(request) {
    const response=await request(URL,{headers:{"User-Agent":"Meanwhile civic-data collector",accept:"application/vnd.github+json"},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`CONGRESS_SOURCE_REVISION_HTTP_${response.status}`);
    return sourceSha(await readCompleteResponse(response,1024*1024));
  }
  return (await acquireCongressSourceRevision()).sha;
}

export async function acquireCongressSourceRevision(options: Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now"> & { consumerParserVersion?: string } = {}) {
  const held=await acquireKnownRelease({...options,sourceId:"congress-directory-revision",releaseId:"current",url:URL,parserVersion:`congress-revision/1:${options.consumerParserVersion ?? "revision-only"}`,reuseOnSourceFailure:true,maxBytes:1024*1024,checkAfterMs:86400000,signal:AbortSignal.timeout(30000),headers:{accept:"application/vnd.github+json"},validate:bytes=>{sourceSha(bytes);}});
  return {sha:sourceSha(held.bytes),sourceCheck:knownReleaseSourceCheck(held),...(held.failedSourceCheck ? {failedSourceCheck:held.failedSourceCheck} : {})};
}
