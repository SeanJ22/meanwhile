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

export async function saveCaptureCopies(query: Query, captures: readonly WorkerPublicationCapture[]): Promise<SavedCopy[]> {
  if (!captures.length) return [];
  const unique = [...new Map(captures.map(c => [JSON.stringify([c.evidence.artifactId, c.evidence.canonicalUrl, new Date(c.observedAt).toISOString()]), c])).values()];
  const rows = await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, is_archive)
    SELECT url, url, fetched_at, http_status, sha256, blob_key, is_archive FROM jsonb_to_recordset($1::jsonb)
      AS x(url text, fetched_at timestamptz, http_status int, sha256 text, blob_key text, is_archive boolean)
    ON CONFLICT (blob_key, url, fetched_at) DO UPDATE SET blob_key = EXCLUDED.blob_key RETURNING id, blob_key, url, fetched_at`,
  [JSON.stringify(unique.map(c => ({ url: c.evidence.canonicalUrl, fetched_at: c.observedAt, http_status: c.httpStatus,
    sha256: c.evidence.contentHash.replace(/^sha256-/, ""), blob_key: `artifact:${c.evidence.artifactId}`, is_archive: isArchive(c.evidence.canonicalUrl) })))]);
  const saved = new Map(rows.map(row => [JSON.stringify([row.blob_key, row.url, new Date(row.fetched_at as string).toISOString()]), Number(row.id)]));
  return captures.map(c => ({ id: saved.get(JSON.stringify([`artifact:${c.evidence.artifactId}`, c.evidence.canonicalUrl, new Date(c.observedAt).toISOString()]))!,
    finalUrl: c.evidence.canonicalUrl, text: checkText(c.evidence.text, "", c.evidence.canonicalUrl),
    fetchedAt: new Date(c.observedAt), isArchive: isArchive(c.evidence.canonicalUrl) }));
}

export async function saveCaptureCopy(query: Query, capture: WorkerPublicationCapture): Promise<SavedCopy> {
  return (await saveCaptureCopies(query, [capture]))[0]!;
}

/** A page another store holds, as checkFact reads it; it has no row here. */
export function pageCopy(page: { readonly finalUrl: string; readonly body: string; readonly contentType: string; readonly fetchedAt: string }): SavedCopy {
  return { id: 0, finalUrl: page.finalUrl, text: checkText(page.body, page.contentType, page.finalUrl), fetchedAt: new Date(page.fetchedAt), isArchive: isArchive(page.finalUrl) };
}
