import { decodeEntities, visibleText } from "../extract/visible-text.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { SavedCopy } from "./check.ts";
import type { Query } from "./publish.ts";

const ARCHIVE_HOSTS = /(^|\.)(web\.archive\.org|archive\.org|archive\.today|archive\.ph|archive\.is)$/i;
const isArchive = (url: string) => ARCHIVE_HOSTS.test(new URL(url).hostname);

/** The saved bytes as a reader would read them: HTML's visible text and absolute links, JSON's values, a calendar's unfolded lines. */
function checkText(body: string, contentType: string, base: string): string {
  if (/html/i.test(contentType) || /^\s*</.test(body)) {
    const targets = [...body.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi), ...body.matchAll(/\bon\w+\s*=\s*"[^"]*?'((?:https?:)?\/\/[^']+)'/gi)];
    const links = targets.flatMap(([, href]) => { const link = decodeEntities(href!); return URL.canParse(link, base) ? [new URL(link, base).href] : []; });
    return `${visibleText(body)}\n${body}\n${links.join("\n")}`;
  }
  if (/^\s*BEGIN:VCALENDAR/.test(body)) return `${body}\n${body.replace(/\r?\n[ \t]/g, "").replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ")}`;
  if (/^\s*[[{]/.test(body)) {
    try { return `${body}\n${jsonValues(JSON.parse(body)).join("\n")}`; } catch { return body; }
  }
  return body;
}

export const jsonValues = (value: unknown): string[] => typeof value === "string" ? [value] : typeof value === "number" ? [String(value)]
  : value && typeof value === "object" ? Object.values(value).flatMap(jsonValues) : [];

interface CopyRow {
  /** What resolves to the exact bytes: `artifact:<id>` for a vault artifact. */
  readonly key: string;
  readonly url: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly httpStatus: number | null;
  readonly contentHash: string;
}

/** One row per saved source: the key is what resolves to its exact bytes. */
export async function saveSourceReference(query: Query, row: CopyRow): Promise<number> {
  const key = row.key;
  const [existing] = await query("SELECT id FROM source_copy WHERE blob_key = $1", [key]);
  if (existing) return Number(existing.id);
  const [saved] = await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, is_archive)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (blob_key) DO NOTHING RETURNING id`,
  [row.url, row.finalUrl, row.fetchedAt, row.httpStatus, row.contentHash.replace(/^sha256-/, ""), key,
    isArchive(row.finalUrl)]);
  if (saved) return Number(saved.id);
  const [held] = await query("SELECT id FROM source_copy WHERE blob_key = $1", [key]);
  return Number(held!.id);
}

/** The text a fact from this capture is checked against: the saved bytes as a reader would read them. */
const savedTexts = new WeakMap<WorkerPublicationCapture, string>();
export function savedText(capture: WorkerPublicationCapture): string {
  let text = savedTexts.get(capture);
  if (text === undefined) { text = checkText(capture.evidence.text, "", capture.evidence.canonicalUrl); savedTexts.set(capture, text); }
  return text;
}

export async function saveCaptureCopy(query: Query, capture: WorkerPublicationCapture): Promise<SavedCopy> {
  const { evidence } = capture;
  const id = await saveSourceReference(query, { key: `artifact:${evidence.artifactId}`, url: evidence.canonicalUrl, finalUrl: evidence.canonicalUrl,
    fetchedAt: capture.observedAt, httpStatus: capture.httpStatus, contentHash: evidence.contentHash });
  return { id, finalUrl: evidence.canonicalUrl, text: savedText(capture), fetchedAt: new Date(capture.observedAt), isArchive: isArchive(evidence.canonicalUrl) };
}

/** The rows of a published release the repo keeps beside its note, as a saved copy captured on the source's latest check: a re-check that finds the same fingerprint is a new capture of the same release. */
export async function saveReleaseCopy(query: Query, release: { readonly name: string; readonly url: string; readonly sha256: string;
  readonly checkedAt: string; readonly text: string }): Promise<SavedCopy> {
  const id = await saveSourceReference(query, { key: `release:${release.name}:${release.sha256}:${release.checkedAt}`, url: release.url, finalUrl: release.url,
    fetchedAt: release.checkedAt, httpStatus: 200, contentHash: release.sha256 });
  return { id, finalUrl: release.url, text: release.text, fetchedAt: new Date(release.checkedAt), isArchive: false };
}

/** A page another store holds, as checkFact reads it; it has no row here. */
export function pageCopy(page: { readonly finalUrl: string; readonly body: string; readonly contentType: string; readonly fetchedAt: string }): SavedCopy {
  return { id: 0, finalUrl: page.finalUrl, text: checkText(page.body, page.contentType, page.finalUrl), fetchedAt: new Date(page.fetchedAt), isArchive: isArchive(page.finalUrl) };
}
