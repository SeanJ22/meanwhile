import type { Artifact } from "../control-plane/evidence/artifact.ts";
import { objectKey } from "../control-plane/evidence/store.ts";
import { visibleText } from "../control-plane/scheduler/scout-tools.ts";
import type { SavedCopy } from "./check.ts";
import type { Query } from "./publish.ts";

const ARCHIVE_HOSTS = /(^|\.)(web\.archive\.org|archive\.org|archive\.today|archive\.ph|archive\.is)$/i;

/** Visible text plus the markup, so a portrait or link address is checked where it appears. */
export function checkText(bytes: Uint8Array, contentType: string): string {
  const body = new TextDecoder().decode(bytes);
  return /html/i.test(contentType) ? `${visibleText(body)}\n${body}` : body;
}

/** Records the vault copy that proves a fact; the same bytes always map to the same row. */
export async function saveSourceCopy(query: Query, artifact: Artifact, project = "freshness"): Promise<number> {
  const blobKey = objectKey(project, artifact);
  const finalUrl = artifact.retrievalUrl || artifact.canonicalUrl;
  const [row] = await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, etag, last_modified, is_archive)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (blob_key) DO UPDATE SET blob_key = EXCLUDED.blob_key RETURNING id`,
  [artifact.canonicalUrl, finalUrl, artifact.retrievedAt, artifact.httpStatus, artifact.contentHash.replace(/^sha256-/, ""), blobKey,
    headerOf(artifact, "etag"), headerOf(artifact, "last-modified"), ARCHIVE_HOSTS.test(new URL(finalUrl).hostname)]);
  return Number(row!.id);
}

export function savedCopy(id: number, artifact: Artifact, bytes: Uint8Array): SavedCopy {
  const finalUrl = artifact.retrievalUrl || artifact.canonicalUrl;
  return { id, finalUrl, text: checkText(bytes, artifact.contentType), fetchedAt: new Date(artifact.retrievedAt),
    isArchive: ARCHIVE_HOSTS.test(new URL(finalUrl).hostname) };
}

function headerOf(artifact: Artifact, name: string): string | null {
  const hit = Object.entries(artifact.headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return hit ? hit[1] : null;
}
