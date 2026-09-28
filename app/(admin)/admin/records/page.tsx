import Link from "next/link";
import { readPublicationHistory } from "@/lib/control-plane/admin-view/publication-history-read.ts";
import { PUBLICATION_HISTORY_PAGE_SIZE } from "@/lib/control-plane/admin-view/publication-history.ts";
import { formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { MwShell } from "../../_mw/shell.tsx";
import { openPage, param, type SearchParams } from "../../_mw/page-base.ts";
import { withScope } from "../../_mw/scope.ts";
import { mw as s } from "../../_mw/ui.tsx";

export const dynamic="force-dynamic";
export const revalidate=0;
export const runtime="nodejs";

export default async function PublicationHistoryPage({searchParams}:{searchParams:Promise<SearchParams>}) {
  const sp=await searchParams, query=param(sp,"q")??"", version=param(sp,"version")??undefined, recordKey=param(sp,"record")??undefined;
  const base=await openPage("/admin/records",sp);
  const reading=await readPublicationHistory({query,page:Number(param(sp,"page")??1),asOf:param(sp,"asof")??undefined,version,recordKey,now:base.nowIso});
  const href=(extra:Record<string,string|null>)=>withScope("/admin/records",base.scope,{q:query,asof:reading.asOf,page:String(reading.page),instruction:param(sp,"instruction"),workq:param(sp,"workq"),workopen:param(sp,"workopen"),...extra});
  const workHref=withScope("/admin/work",base.scope,{instruction:param(sp,"instruction"),q:param(sp,"workq"),open:param(sp,"workopen")});
  return <MwShell area="fleet" tab="work" scope={base.scope} scopeLabel={base.shell.label} scopeGroups={base.shell.groups}
    here={base.here} observedAt={base.nowIso} standard={base.standard} extraStrip={[{label:"HISTORY SEARCH",value:"All published authority scopes"}]}>
    <h1 className={s.h1}>Find a person, body or meeting in publication history</h1>
    <p className={s.note}>This search covers saved publication versions across all authority scopes, including records without a linked job. It is separate from the selected hunt. A match does not prove that the hunt delivered it, that a person still holds office, or that the public page is currently confirmed.</p>
    <p><Link className={s.btnLink} href={workHref}>Return to linked work</Link></p>
    <form method="get" action="/admin/records" role="search" className={s.row10}>
      {Object.entries(sp).filter(([key])=>["scope","instruction","workq","workopen"].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={Array.isArray(value)?value[0]:value??""}/>)}
      <label htmlFor="publication-history-query">Search names, meetings or record references</label>
      <input id="publication-history-query" name="q" type="search" className={s.input} minLength={3} maxLength={100} defaultValue={query} required/>
      <button className={s.btn} type="submit">Search history</button>
    </form>
    {reading.reason&&<p role="status" className={s.goldNote}>{reading.reason}</p>}
    {reading.state==="READ"&&<>
      <p className={s.note}>{reading.total!.toLocaleString("en-US")} matching saved record version{reading.total===1?"":"s"}; showing {reading.rows.length}. Counts are versions, not people, meetings or coverage points. Search includes publications saved by {formatEastern(reading.asOf,{year:true})}. Older records without individual keys appear as their complete source document.</p>
      {version&&<p><Link className={s.btnLink} href={href({version:null,record:null})}>Back to search results</Link></p>}
      <div className={s.stack10}>{reading.rows.map(row=><article className={s.card} key={`${row.version}:${row.recordKey}`}>
        <h2 className={s.h3}>{row.label}</h2>
        <p className={s.note}>{row.currentVersion?"In the source version currently selected by the data system":"Historical source version"} · Source captured {formatEastern(row.recordedAt,{year:true})}</p>
        {row.publishedAt&&<p className={s.note}>First published to the site&apos;s data {formatEastern(row.publishedAt,{year:true})}.</p>}
        <p className={s.note}>Saved authority scope: {row.scope}. Current public-page confirmation is not measured by this search.</p>
        {!version&&<p className={s.record} style={{overflowWrap:"anywhere"}}>{row.excerpt}</p>}
        <p className={s.row10}>{row.sourceUrl&&<a className={s.btnLink} href={row.sourceUrl} rel="noreferrer" target="_blank">Open the cited source</a>}
          {!version&&<Link className={s.btnLink} href={href({version:row.version,record:row.recordKey})}>Open this saved record</Link>}</p>
        <details open={Boolean(version)}><summary>Saved facts and exact references</summary>
          <p className={s.note}>{row.recordClass} · {row.recordKey} · version {row.version}</p>
          <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxWidth:"100%"}}>{row.detail}</pre>
          {row.detailTruncated&&<p className={s.note}>This preview is shortened. Open this saved record to read the complete saved facts.</p>}
        </details>
      </article>)}</div>
      {reading.total===0&&<p>No saved publication matches this search. This does not establish that the information does not exist.</p>}
      {!version&&<nav aria-label="Publication history pages" className={s.row10}>
        {reading.page>1&&<Link className={s.btnLink} href={href({page:String(reading.page-1)})}>Previous page</Link>}
        {reading.page*PUBLICATION_HISTORY_PAGE_SIZE<reading.total!&&<Link className={s.btnLink} href={href({page:String(reading.page+1)})}>Next page</Link>}
      </nav>}
    </>}
  </MwShell>;
}
