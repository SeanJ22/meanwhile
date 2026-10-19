import type { ZctaCentroid } from "../geo/zcta-core.ts";

declare global {
  interface Window {
    __readerStart?: { zip: string; location: Promise<ZctaCentroid | null>; expires: number; requests: Record<string, Promise<Response>>; parsed: WeakMap<Response, Promise<unknown>> };
    __startReaderZip?: (zip: string) => Promise<ZctaCentroid | null> | null;
  }
}

/** A ZIP link starts its two reads in the arriving HTML, before hydration. */
export const READER_START_SCRIPT = `try{
window.__startReaderZip=zip=>{
if(location.pathname!=="/"||typeof zip!=="string"||!/^\\d{5}$/.test(zip))return null;
const previous=window.__readerStart;
if(previous?.zip===zip&&previous.expires>Date.now())return previous.location;
const requests={},parsed=previous?.parsed||new WeakMap(),start={zip,requests,parsed,expires:Date.now()+30000};
const early=url=>fetch(url,{headers:{accept:"application/json"}}).then(r=>{
const response=r.clone(),value=r.json();value.catch(()=>{});parsed.set(response,value);return response});
const state=early("/api/reader/state?zip="+zip),place=early("/api/meetings?zip="+zip);
state.catch(()=>{});place.catch(()=>{});
start.location=fetch("/api/location/zip?zip="+zip).then(r=>{
if(!r.ok)throw new Error("ZIP lookup failed: "+r.status);return r.json()}).then(d=>{
const resolution=d?.resolution;
const p=resolution?.ok===true?resolution.centroid:resolution?.ok===false&&resolution.reason==="uncovered"?null:
resolution===undefined&&d&&Object.hasOwn(d,"location")?d.location:undefined;
if(p===null){if(window.__readerStart===start)start.expires=0;return null}
if(!p||typeof p!=="object")throw new Error("Invalid ZIP location response");
if(p.postal?.state)requests["/api/reader/state?state="+encodeURIComponent(p.postal.state)+"&zip="+zip]=state;
requests["/api/meetings?lat="+p.lat+"&lng="+p.lng+"&zip="+zip]=place;
return p}).catch(error=>{if(window.__readerStart===start)start.expires=0;throw error});
start.location.catch(()=>{});window.__readerStart=start;return start.location;
};
if(location.pathname==="/"){
let zip=new URLSearchParams(location.search).get("zip");
if(zip===null){try{zip=JSON.parse(localStorage.getItem("wtp.approximate_location")||"null")?.zip}catch(e){}}
window.__startReaderZip(zip);
}}catch(e){}`;

/** Consume each early response once; normal navigation keeps its abort behavior. */
export function fetchReaderResponse(url: string, init?: RequestInit): Promise<Response> {
  const early = typeof window === "undefined" ? undefined : window.__readerStart;
  const response = early && early.expires > Date.now() ? early.requests[url] : undefined;
  if (response) { delete early!.requests[url]; return response; }
  return fetch(url, init);
}

/** Parse arriving data before hydration needs it; consume the original body exactly once. */
export async function readReaderJson<T>(response: Response): Promise<T> {
  const parsed = typeof window === "undefined" ? undefined : window.__readerStart?.parsed.get(response);
  if (!parsed) return response.json() as Promise<T>;
  window.__readerStart!.parsed.delete(response);
  // The early parser already consumes the bytes. Release this spare tee branch
  // without waiting for cancellation to propagate through the other branch or
  // allocating another state-sized buffer. cancel() disturbs the body at once.
  if (response.bodyUsed || response.body?.locked) throw new TypeError("Response body is already used or locked");
  if (response.body) void response.body.cancel().catch(() => {});
  else await response.arrayBuffer();
  return parsed as Promise<T>;
}

/** A map ZIP change uses the same parallel reads as the arriving HTML. */
export function beginReaderZip(zip: string): Promise<ZctaCentroid | null> | null {
  if (typeof window === "undefined") return null;
  const early = window.__readerStart;
  if (early && early.expires > Date.now() && early.zip === zip) return early.location;
  return window.location.pathname === "/" ? window.__startReaderZip?.(zip) ?? null : null;
}

/** Uncovered, failed and invalid responses remain retryable even within the startup window. */
export function discardReaderZipStart(zip: string, location: Promise<ZctaCentroid | null> | null): void {
  const early = typeof window === "undefined" ? undefined : window.__readerStart;
  if (early?.zip === zip && early.location === location) early.expires = 0;
}
