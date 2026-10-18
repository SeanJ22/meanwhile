import type { ZctaCentroid } from "../geo/zcta-core.ts";

declare global {
  interface Window {
    __readerStart?: { zip: string; location: Promise<ZctaCentroid | null>; expires: number; requests: Record<string, Promise<Response>>; parsed: WeakMap<Response, Promise<unknown>> };
  }
}

/** A ZIP link starts its two reads in the arriving HTML, before hydration. */
export const READER_START_SCRIPT = `try{if(location.pathname==="/"){
let zip=new URLSearchParams(location.search).get("zip");
if(zip===null){try{zip=JSON.parse(localStorage.getItem("wtp.approximate_location")||"null")?.zip}catch(e){}}
if(/^\\d{5}$/.test(zip||"")){
const requests={},parsed=new WeakMap(),start={zip,requests,parsed,expires:Date.now()+30000};
const early=url=>fetch(url,{headers:{accept:"application/json"}}).then(r=>{
const response=r.clone(),value=r.json();value.catch(()=>{});parsed.set(response,value);return response});
const state=early("/api/reader/state?zip="+zip),place=early("/api/meetings?zip="+zip);
state.catch(()=>{});place.catch(()=>{});
start.location=fetch("/api/location/zip?zip="+zip).then(r=>r.ok?r.json():null).then(d=>{
const p=d?.location;if(!p)return null;
if(p.postal?.state)requests["/api/reader/state?state="+encodeURIComponent(p.postal.state)]=state;
requests["/api/meetings?lat="+p.lat+"&lng="+p.lng+"&zip="+zip]=place;
return p}).catch(()=>null);window.__readerStart=start;
}}}catch(e){}`;

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

export function readerStartLocation(zip: string): Promise<ZctaCentroid | null> | null {
  const early = typeof window === "undefined" ? undefined : window.__readerStart;
  return early && early.expires > Date.now() && early.zip === zip ? early.location : null;
}
