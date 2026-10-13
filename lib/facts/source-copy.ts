import type { Artifact } from "../control-plane/evidence/artifact.ts";
import { visibleText } from "../control-plane/scheduler/scout-tools.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { SavedCopy } from "./check.ts";
import type { Query } from "./publish.ts";

const ARCHIVE_HOSTS = /(^|\.)(web\.archive\.org|archive\.org|archive\.today|archive\.ph|archive\.is)$/i;
const isArchive = (url: string) => ARCHIVE_HOSTS.test(new URL(url).hostname);

/** Visible text, the markup and every link made absolute, so a portrait or link address is checked where it appears. */
export function checkText(body: string, contentType: string, base: string): string {
  if (!(/html/i.test(contentType) || /^\s*</.test(body))) return body;
  const links = [...body.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].flatMap(([, href]) => URL.canParse(href!, base) ? [new URL(href!, base).href] : []);
  return `${visibleText(body)}\n${body}\n${links.join("\n")}`;
}

interface CopyRow {
  readonly artifactId: string;
  readonly url: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly httpStatus: number | null;
  readonly contentHash: string;
  readonly etag?: string | null;
  readonly lastModified?: string | null;
}

/** One row per vault artifact: the key is the artifact id the vault resolves to its exact bytes. */
async function saveCopy(query: Query, row: CopyRow): Promise<number> {
  const [saved] = await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, etag, last_modified, is_archive)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (blob_key) DO UPDATE SET blob_key = EXCLUDED.blob_key RETURNING id`,
  [row.url, row.finalUrl, row.fetchedAt, row.httpStatus, row.contentHash.replace(/^sha256-/, ""), `artifact:${row.artifactId}`,
    row.etag ?? null, row.lastModified ?? null, isArchive(row.finalUrl)]);
  return Number(saved!.id);
}

export async function saveArtifactCopy(query: Query, artifact: Artifact, bytes: Uint8Array): Promise<SavedCopy> {
  const finalUrl = artifact.retrievalUrl || artifact.canonicalUrl;
  const header = (name: string) => Object.entries(artifact.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
  const id = await saveCopy(query, { artifactId: artifact.id, url: artifact.canonicalUrl, finalUrl, fetchedAt: artifact.retrievedAt,
    httpStatus: artifact.httpStatus, contentHash: artifact.contentHash, etag: header("etag"), lastModified: header("last-modified") });
  return { id, finalUrl, text: checkText(new TextDecoder().decode(bytes), artifact.contentType, finalUrl), fetchedAt: new Date(artifact.retrievedAt), isArchive: isArchive(finalUrl) };
}

export async function saveCaptureCopy(query: Query, capture: WorkerPublicationCapture): Promise<SavedCopy> {
  const { evidence } = capture;
  const id = await saveCopy(query, { artifactId: evidence.artifactId, url: evidence.canonicalUrl, finalUrl: evidence.canonicalUrl,
    fetchedAt: capture.observedAt, httpStatus: capture.httpStatus, contentHash: evidence.contentHash });
  return { id, finalUrl: evidence.canonicalUrl, text: checkText(evidence.text, "", evidence.canonicalUrl), fetchedAt: new Date(capture.observedAt), isArchive: isArchive(evidence.canonicalUrl) };
}
