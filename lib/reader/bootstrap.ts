import type { ZctaCentroid } from "../geo/zcta-core.ts";
import type { ReaderWorkerRequest } from "../map/boundary-worker.ts";
import { decodeReaderValue } from "./wire.ts";

interface ReaderBoundary { url: string; request: (request: ReaderWorkerRequest, signal?: AbortSignal) => Promise<unknown> }

declare global {
  interface Window {
    __readerStart?: { zip: string; location: Promise<ZctaCentroid | null>; value?: unknown; expires: number; requests: Record<string, Promise<Response>>; parsed: WeakMap<Response, Promise<unknown>> };
    __startReaderZip?: (zip: string) => Promise<ZctaCentroid | null> | null;
    __readerSnapshots?: {expires: number; requests: Record<string,Promise<Response>>};
    __readerBoundary?: ReaderBoundary;
    __startReaderBoundary?: (url: string) => ReaderBoundary;
  }
}

/** A ZIP link starts its data and boundary reads before hydration. */
export function readerStartScript(boundaryUrl: string): string { return `try{
const decodeReaderValue=${decodeReaderValue.toString()};
if(location.pathname==="/")document.documentElement.dataset.raster="pending";
if(location.pathname==="/ballot"&&!window.__readerSnapshots){
const url="/api/reader/link-health",pending=fetch(url,{cache:"no-cache"});pending.catch(()=>{});
window.__readerSnapshots={expires:Date.now()+30000,requests:{[url]:pending}};
}
window.__startReaderBoundary=url=>{
if(window.__readerBoundary)return window.__readerBoundary;
const worker=new Worker("/map-boundary-worker.mjs",{type:"module"}),pending=new Map();let serial=0,failed;
worker.onmessage=({data})=>{const held=pending.get(data.id);if(!held)return;pending.delete(data.id);held.clean();data.error?held.reject(new Error(data.error)):held.resolve(data.value)};
worker.onerror=error=>{failed=new Error(error.message);for(const held of pending.values()){held.clean();held.reject(failed)}pending.clear()};
const request=(request,signal)=>new Promise((resolve,reject)=>{
if(failed){reject(failed);return}
const id=++serial,abort=()=>{pending.delete(id);worker.postMessage({id,cancel:true});reject(signal.reason||new DOMException("Aborted","AbortError"))};
if(signal?.aborted){abort();return}
pending.set(id,{resolve,reject,clean:()=>signal?.removeEventListener("abort",abort)});
signal?.addEventListener("abort",abort,{once:true});worker.postMessage({id,request},request.kind==="bootstrap"?[request.body]:[]);
});
return window.__readerBoundary={url,request};
};
window.__startReaderZip=zip=>{
if(location.pathname!=="/"||typeof zip!=="string"||!/^\\d{5}$/.test(zip))return null;
const previous=window.__readerStart;
if(previous?.zip===zip&&previous.expires>Date.now())return previous.location;
const requests={},parsed=previous?.parsed||new WeakMap(),start={zip,requests,parsed,expires:Date.now()+30000};
const archive=${JSON.stringify(boundaryUrl)};
if(archive){try{
const url=new URL(archive,location.href).href;
window.__startReaderBoundary(url).request({kind:"header",url}).catch(()=>{});
}catch(e){}}
const parseResponse=r=>{
const response=r.clone(),value=r.json();value.catch(()=>{});parsed.set(response,value);return response};
const early=url=>fetch(url,{headers:{accept:"application/json"}}).then(parseResponse);
const placeUrl="/api/meetings?zip="+zip+"&include=state";
const parsedResponse=result=>{const response=new Response("",{status:result.status,headers:result.headers});parsed.set(response,Promise.resolve(result.value));return response};
const combined=fetch(placeUrl,{headers:{accept:"application/json"}}).then(async response=>{
const split=wire=>{const value=decodeReaderValue(wire),state=value.stateResponse;delete value.stateResponse;
return{state:state||{value:{error:"The state's information could not be loaded"},status:503,headers:[["cache-control","no-store"]]},place:{value,status:response.status,headers:[...response.headers]}}};
if(!window.__readerBoundary)return split(await response.json());
const body=await response.arrayBuffer(),backup=body.slice(0);
return window.__readerBoundary.request({kind:"bootstrap",body,status:response.status,headers:[...response.headers]}).catch(()=>split(JSON.parse(new TextDecoder().decode(backup))));
});
const state=combined.then(result=>parsedResponse(result.state)),place=combined.then(result=>parsedResponse(result.place));
const settings="/api/reader/settings";
const outlines="/geo/state-outlines.geojson";
if(previous?.requests[outlines])requests[outlines]=previous.requests[outlines];
else if(!previous){requests[outlines]=early(outlines);requests[outlines].catch(()=>{})}
if(previous?.requests[settings])requests[settings]=previous.requests[settings];
else if(!previous){requests[settings]=early(settings);requests[settings].catch(()=>{})}
state.catch(()=>{});place.catch(()=>{});
start.location=fetch("/geo/reader-zips/"+zip.slice(0,2)+".json").then(r=>{
if(!r.ok)throw new Error("ZIP lookup failed: "+r.status);return r.json()}).then(d=>{
if(!d?.locations||typeof d.locations!=="object")throw new Error("Invalid ZIP location response");
const p=d.locations[zip]??null;
if(p===null){if(window.__readerStart===start)start.expires=0;return null}
if(!p||typeof p!=="object")throw new Error("Invalid ZIP location response");
start.value=p;
if(!previous&&window.__readerStart===start&&window.__readerBoundary){const reader=window.__readerBoundary;reader.request({kind:"prefetch",url:reader.url,zip:p.zip,lat:p.lat,lng:p.lng,width:innerWidth,height:innerHeight}).catch(()=>{})}
if(p.postal?.state)requests["/api/reader/state?state="+encodeURIComponent(p.postal.state)+"&zip="+zip]=state;
requests["/api/meetings?lat="+p.lat+"&lng="+p.lng+"&zip="+zip]=place;
return p}).catch(error=>{if(window.__readerStart===start)start.expires=0;throw error});
start.location.catch(()=>{});window.__readerStart=start;return start.location;
};
if(location.pathname==="/"){
let zip=new URLSearchParams(location.search).get("zip");
if(zip===null){try{zip=JSON.parse(localStorage.getItem("wtp.approximate_location")||"null")?.zip}catch(e){}}
window.__startReaderZip(zip);
}}catch(e){}`; }

export const READER_START_SCRIPT = readerStartScript(typeof process === "undefined" ? "" : process.env.NEXT_PUBLIC_BOUNDARY_PMTILES_URL ?? "");

/** Consume each early response once; normal navigation keeps its abort behavior. */
export function fetchReaderResponse(url: string, init?: RequestInit): Promise<Response> {
  const snapshots = typeof window === "undefined" ? undefined : window.__readerSnapshots;
  const snapshot = snapshots && snapshots.expires > Date.now() ? snapshots.requests[url] : undefined;
  if (snapshot) { delete snapshots!.requests[url]; return snapshot; }
  const early = typeof window === "undefined" ? undefined : window.__readerStart;
  const response = early && early.expires > Date.now() ? early.requests[url] : undefined;
  if (response) { delete early!.requests[url]; return response; }
  return fetch(url, init);
}

/** Parse arriving data before hydration needs it; consume the original body exactly once. */
export async function readReaderJson<T>(response: Response): Promise<T> {
  const parsed = typeof window === "undefined" ? undefined : window.__readerStart?.parsed.get(response);
  if (!parsed) return response.json().then(value => decodeReaderValue(value)) as Promise<T>;
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

type AgendaStart = { url: string; controller: AbortController; response: Promise<Response>; expires: number; timer: ReturnType<typeof setTimeout> };
let agendaStart: AgendaStart | undefined;
const agendaRequestUrl = (meetingId: string, bodyId: string) => `/api/agenda?meetingId=${encodeURIComponent(meetingId)}&bodyId=${encodeURIComponent(bodyId)}`;

/** A dismissed or replaced card must not leave an unclaimed request running. */
export function discardReaderAgendaStart(): void {
  const start = agendaStart;
  agendaStart = undefined;
  if (start) { clearTimeout(start.timer); start.controller.abort(); }
}

/** Start only at the selection click, alongside the card's lazy module. */
export function beginReaderAgenda(agenda: { meetingId: string; bodyId: string } | null | undefined): void {
  if (typeof window === "undefined") return;
  let controller: AbortController | undefined;
  try {
    if (!agenda) { discardReaderAgendaStart(); return; }
    const url = agendaRequestUrl(agenda.meetingId, agenda.bodyId);
    if (agendaStart?.url === url && agendaStart.expires > Date.now()) return;
    discardReaderAgendaStart();
    controller = new AbortController();
    let response: Promise<Response>;
    try { response = fetch(url, { signal: controller.signal }); }
    catch (error) { response = Promise.reject(error); }
    // A failure still reaches the card; this only handles rejection while its
    // module is loading. Reopening the card starts a fresh attempt.
    void response.catch(() => {});
    const start: AgendaStart = { url, controller, response, expires: Date.now() + 30_000,
      timer: setTimeout(() => { if (agendaStart === start) discardReaderAgendaStart(); }, 30_000) };
    agendaStart = start;
  } catch {
    // Starting early must never prevent the card opening. Its existing read
    // and error UI still handle an invalid URL or unavailable browser facility.
    controller?.abort();
    discardReaderAgendaStart();
  }
}

/** Hand the one pending response to its exact meeting/body card, with its abort lifecycle. */
export function fetchReaderAgendaResponse(meetingId: string, bodyId: string, signal: AbortSignal): Promise<Response> {
  const url = agendaRequestUrl(meetingId, bodyId);
  if (agendaStart && agendaStart.expires <= Date.now()) discardReaderAgendaStart();
  const start = agendaStart?.url === url ? agendaStart : undefined;
  if (!start) return fetch(url, { signal });
  agendaStart = undefined;
  clearTimeout(start.timer);
  const { controller, response } = start;
  if (signal.aborted) {
    controller.abort(signal.reason);
    return Promise.reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
  }
  // Keep the link through body consumption, not just until headers arrive.
  signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return response;
}
