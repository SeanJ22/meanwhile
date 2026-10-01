import { bulkUrl, rowsToPeople, pluralRosterIssue } from '../../sources/plural/index.ts';
import { fetchEvents } from '../../sources/legistar/client.ts';
import type { SourceApiOptions, SourceApiResult } from './scout-api.ts';
export type ClientTool = 'plural_roster' | 'legistar_events';
/** Shared clients provide transforms/paging; raw responses retain exact source quotations. */
export async function readClientSource(name: ClientTool, input: Record<string, unknown>, options: SourceApiOptions): Promise<SourceApiResult> {
  const captures: {sourceUrl:string;status:number;text:string}[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const sourceUrl = String(url);
    await options.spaceOut?.(new URL(sourceUrl).host);
    const response = await (options.fetchImpl ?? fetch)(url,{...init,signal:AbortSignal.timeout(options.timeoutMs ?? 15000)});
    captures.push({sourceUrl,status:response.status,text:await response.clone().text()});
    return response;
  };
  let sourceUrl: string, data: unknown;
  if (name === 'plural_roster') {
    if (typeof input.state !== 'string' || !/^[a-z]{2}$/i.test(input.state)) throw new Error('PLURAL_STATE_REQUIRED');
    const state = input.state.toLowerCase(); sourceUrl = bulkUrl(state);
    const response = await fetcher(sourceUrl,{headers:{accept:'text/csv'},redirect:'error'});
    if (!response.ok) throw new Error('PLURAL_HTTP_'+response.status);
    const csv = captures[0].text, issue = pluralRosterIssue(csv);
    if (issue) throw new Error(issue);
    data = rowsToPeople(csv,state);
  } else {
    if (typeof input.tenant !== 'string' || !/^[a-z0-9-]+$/i.test(input.tenant) || typeof input.from !== 'string' || typeof input.to !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) ||
      !Number.isFinite(Date.parse(input.from)) || !Number.isFinite(Date.parse(input.to)) || Date.parse(input.to)<Date.parse(input.from) || Date.parse(input.to)-Date.parse(input.from)>97*86400000) throw new Error('LEGISTAR_TENANT_DATE_WINDOW_REQUIRED');
    sourceUrl = 'https://webapi.legistar.com/v1/'+input.tenant+'/events';
    data = await fetchEvents(input.tenant,{from:input.from,to:input.to},{fetchImpl:fetcher});
  }
  return {sourceUrl,status:200,text:JSON.stringify({sourceUrl,data,captures}),requests:captures.length,bytes:captures.reduce((sum,c)=>sum+Buffer.byteLength(c.text),0)};
}
