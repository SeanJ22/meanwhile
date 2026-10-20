import {createHash} from "node:crypto";
import { visibleText } from "../extract/visible-text.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import type { SavedCopy } from "./check.ts";
import type { Query } from "./publish.ts";

const ARCHIVE_HOSTS = /(^|\.)(web\.archive\.org|archive\.org|archive\.today|archive\.ph|archive\.is)$/i;
const isArchive = (url: string) => ARCHIVE_HOSTS.test(new URL(url).hostname);

/** The saved bytes as a reader would read them: HTML's visible text and absolute links, JSON's values, a calendar's unfolded lines. */
function checkText(body: string, contentType: string, base: string): string {
  if (/html/i.test(contentType) || /^\s*</.test(body)) {
    const links = [...body.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].flatMap(([, href]) => URL.canParse(href!, base) ? [new URL(href!, base).href] : []);
    return `${visibleText(body)}\n${body}\n${links.join("\n")}`;
  }
  if (/^\s*BEGIN:VCALENDAR/.test(body)) return `${body}\n${body.replace(/\r?\n[ \t]/g, "").replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ")}`;
  if (/^\s*[[{]/.test(body)) {
    try { return `${body}\n${jsonValues(JSON.parse(body)).join("\n")}`; } catch { return body; }
  }
  return body;
}

const jsonValues = (value: unknown): string[] => typeof value === "string" ? [value] : typeof value === "number" ? [String(value)]
  : value && typeof value === "object" ? Object.values(value).flatMap(jsonValues) : [];

interface CopyRow {
  readonly artifactId: string;
  readonly url: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly httpStatus: number | null;
  readonly contentHash: string;
}

/** One source URL per saved content artifact; fresh reads advance its check time. */
async function saveCopy(query: Query, row: CopyRow): Promise<number> {
  const [saved] = await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, is_archive)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (blob_key) DO UPDATE SET fetched_at = greatest(source_copy.fetched_at,EXCLUDED.fetched_at) RETURNING id`,
  [row.url, row.finalUrl, row.fetchedAt, row.httpStatus, row.contentHash.replace(/^sha256-/, ""), `artifact:${row.artifactId}:${createHash("sha256").update(row.finalUrl).digest("hex")}`,
    isArchive(row.finalUrl)]);
  return Number(saved!.id);
}

export async function saveCaptureCopy(query: Query, capture: WorkerPublicationCapture): Promise<SavedCopy> {
  const { evidence } = capture;
  const id = await saveCopy(query, { artifactId: evidence.artifactId, url: evidence.canonicalUrl, finalUrl: evidence.canonicalUrl,
    fetchedAt: capture.observedAt, httpStatus: capture.httpStatus, contentHash: evidence.contentHash });
  return { id, finalUrl: evidence.canonicalUrl, text: checkText(evidence.text, "", evidence.canonicalUrl), fetchedAt: new Date(capture.observedAt), isArchive: isArchive(evidence.canonicalUrl) };
}

/** A page another store holds, as checkFact reads it; it has no row here. */
export function pageCopy(page: { readonly finalUrl: string; readonly body: string; readonly contentType: string; readonly fetchedAt: string }): SavedCopy {
  return { id: 0, finalUrl: page.finalUrl, text: checkText(page.body, page.contentType, page.finalUrl), fetchedAt: new Date(page.fetchedAt), isArchive: isArchive(page.finalUrl) };
}
