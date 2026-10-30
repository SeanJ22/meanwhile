import { createHash } from "node:crypto";
import { factReader, readerFactDb } from "./db.ts";
import type { Query } from "./publish.ts";
import { isOfficialSource, type OfficialLinkingPage, type OfficialLinkingPageRef } from "../civic-data/source-authority.ts";
import { assertWriteAllowed } from "../db/write-guard.ts";
import { CIVIC_DATA_PROMOTION_OPERATION } from "../civic-data/production-write.ts";

export const LINKING_COPY_SCHEMA = "ALTER TABLE source_copy ADD COLUMN IF NOT EXISTS content text";
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
let installed: Query | undefined;
/** Reuse a process's existing source-copy connection. */
export function installLinkingCopyQuery(query?: Query): void { installed = query; }
const copyQuery = () => installed ?? factReader();

/** Negative, exactly representable ids keep checked-in source references independent of insertion order. */
export function linkingCopyIdentity(url: string, html: string) {
  const sha256 = hash(html), key = `linking-page:${hash(url)}:${sha256}`;
  return { id: -Number.parseInt(hash(key).slice(0, 13), 16) - 1, key, sha256 };
}

/** The linking page is the publication's own evidence, saved by the job that publishes from it on its writable connection. */
export async function saveLinkingCopy(page: OfficialLinkingPage, at: string, query?: Query): Promise<OfficialLinkingPageRef> {
  if (!query) {
    if (!installed) assertWriteAllowed(CIVIC_DATA_PROMOTION_OPERATION);
    query = installed ?? readerFactDb().query;
  }
  const parent = page.linkingPage ? await saveLinkingCopy(page.linkingPage, at, query) : undefined;
  const { id, key, sha256 } = linkingCopyIdentity(page.url, page.html);
  await query(`INSERT INTO source_copy(id,url,final_url,fetched_at,http_status,sha256,blob_key,is_archive,content)
    VALUES($1,$2,$2,$3,NULL,$4,$5,false,$6) ON CONFLICT(blob_key) DO NOTHING`, [id,page.url,at,sha256,key,page.html]);
  return { url: page.url, sourceCopyId: id, ...(parent ? { linkingPage: parent } : {}) };
}

export async function openLinkingCopy(page: OfficialLinkingPageRef, query: Query | null = copyQuery()): Promise<OfficialLinkingPage> {
  if (!query) throw Error("Saved linking page database is unavailable");
  const [row] = await query("SELECT url,sha256,content FROM source_copy WHERE id=$1", [page.sourceCopyId]);
  if (!row || row.url !== page.url || typeof row.content !== "string" || hash(row.content) !== row.sha256)
    throw Error(`Saved linking page is unavailable or has a different sha256: ${page.sourceCopyId}`);
  return { url: page.url, html: row.content };
}

export const isOfficialVotingSource = (url: string, page?: OfficialLinkingPageRef | null) =>
  isOfficialSource(url, page, undefined, openLinkingCopy);

/** Keep only the pages the authority decision actually used for the publication's source check. */
export async function votingSourceAuthority(url: string, page?: OfficialLinkingPageRef | null) {
  const opened = new Map<number, OfficialLinkingPage>();
  const official = await isOfficialSource(url, page, undefined, async ref => {
    const copy = await openLinkingCopy(ref); opened.set(ref.sourceCopyId, copy); return copy;
  });
  const chain = (ref?: OfficialLinkingPageRef | null): OfficialLinkingPage | undefined => {
    const copy = ref && opened.get(ref.sourceCopyId);
    if (!copy) return undefined;
    const parent = chain(ref.linkingPage);
    return { ...copy, ...(parent ? { linkingPage: parent } : {}) };
  };
  return { official, linkingPage: chain(page) };
}
