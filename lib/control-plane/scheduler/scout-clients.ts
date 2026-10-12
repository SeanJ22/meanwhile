import { readCompleteResponse } from "../../sources/source-bytes.ts";
import { publicFetch } from "../../hunt/egress.ts";
import { fetchEvents } from '../../sources/legistar/client.ts';
import type { SourceApiOptions, SourceApiResult } from './scout-api.ts';
export type ClientTool = 'legistar_events';
/** Shared clients provide transforms/paging; raw responses retain exact source quotations. */
export async function readClientSource(name: ClientTool, input: Record<string, unknown>, options: SourceApiOptions): Promise<SourceApiResult> {
  if (name !== 'legistar_events') throw new Error('CLIENT_TOOL_UNSUPPORTED');
  const captures: {sourceUrl:string;status:number;text:string}[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const sourceUrl = String(url);
    await options.spaceOut?.(new URL(sourceUrl).host);
    const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 15000), ...(options.signal ? [options.signal] : []), ...(init?.signal ? [init.signal] : [])]);
    const response = await (options.fetchImpl ?? publicFetch)(url,{...init,signal});
    const bytes = await readCompleteResponse(response, 16 * 1024 * 1024);
    captures.push({sourceUrl,status:response.status,text:new TextDecoder("utf-8", {fatal:true}).decode(bytes)});
    const replay = new Response(bytes as BodyInit, {status:response.status,headers:response.headers});
    Object.defineProperty(replay, "url", {value:response.url});
    return replay;
  };
  if (typeof input.tenant !== 'string' || !/^[a-z0-9-]+$/i.test(input.tenant) || typeof input.from !== 'string' || typeof input.to !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) ||
    !Number.isFinite(Date.parse(input.from)) || !Number.isFinite(Date.parse(input.to)) || Date.parse(input.to)<Date.parse(input.from) || Date.parse(input.to)-Date.parse(input.from)>97*86400000) throw new Error('LEGISTAR_TENANT_DATE_WINDOW_REQUIRED');
  const sourceUrl = 'https://webapi.legistar.com/v1/'+input.tenant+'/events';
  const data = await fetchEvents(input.tenant,{from:input.from,to:input.to},{fetchImpl:fetcher});
  return {sourceUrl,status:200,text:JSON.stringify({sourceUrl,data,captures}),requests:captures.length,bytes:captures.reduce((sum,c)=>sum+Buffer.byteLength(c.text),0)};
}
