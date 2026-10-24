import { visibleText, decodeEntities } from "../../../extract/visible-text.ts";
import type { WorkerPublicationCapture } from "../../../civic-data/worker-roster-publication.ts";
import type { SavedCopy } from "../../../facts/check.ts";
import type { Query } from "../../../facts/publish.ts";

const ARCHIVE_HOSTS = /(^|\.)(web\.archive\.org|archive\.org|archive\.today|archive\.ph|archive\.is)$/i;
const isArchive = (url: string) => ARCHIVE_HOSTS.test(new URL(url).hostname);

/** The saved bytes as a reader would read them: HTML's visible text and absolute links, JSON's values, a calendar's unfolded lines. */
function checkText(body: string, contentType: string, base: string): string {
  if (/html/i.test(contentType) || /^\s*</.test(body)) {
    const links = [...body.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].flatMap(([, href]) => {
      const decoded = decodeEntities(href!);
      return URL.canParse(decoded, base) ? [new URL(decoded, base).href] : [];
    });
    return `${visibleText(body)}\n${body}\n${links.join("\n")}`;
  }
  if (/^\s*BEGIN:VCALENDAR/.test(body)) return `${body}\n${body.replace(/\r?\n[ \t]/g, "").replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ")}`;
  if (/^\s*[[{]/.test(body)) {
    const values = jsonValueText(body);
    return values === null ? body : `${body}\n${values}`;
  }
  return body;
}

/** Decode scalar values without ever materializing a national source's records. */
function jsonValueText(text: string): string | null {
  let at = 0;
  const values: string[] = [];
  const space = () => { while (/\s/.test(text[at] ?? "") && at < text.length) at++; };
  const string = (): string => {
    const start = at++;
    let escaped = false;
    while (at < text.length) {
      const char = text[at++]!;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') return JSON.parse(text.slice(start, at)) as string;
    }
    throw new Error("Unterminated source string");
  };
  const value = (): void => {
    space();
    const char = text[at];
    if (char === '"') values.push(string());
    else if (char === "[" || char === "{") {
      at++; space();
      const close = char === "[" ? "]" : "}";
      if (text[at] !== close) while (true) {
        if (char === "{") {
          space(); if (text[at] !== '"') throw new Error("Source key missing");
          string(); space(); if (text[at++] !== ":") throw new Error("Source colon missing");
        }
        value(); space();
        if (text[at] !== ",") break;
        at++;
      }
      if (text[at++] !== close) throw new Error("Source container incomplete");
    } else {
      const scalar = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at))?.[0];
      if (!scalar) throw new Error("Source scalar missing");
      at += scalar.length;
      if (!/^(true|false|null)$/.test(scalar)) values.push(String(Number(scalar)));
    }
  };
  try { value(); space(); return at === text.length ? values.join("\n") : null; } catch { return null; }
}

interface CopyRow {
  readonly artifactId: string;
  readonly url: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly httpStatus: number | null;
  readonly contentHash: string;
}

/** One row per vault artifact: the key is the artifact id the vault resolves to its exact bytes. */
async function saveCopy(query: Query, row: CopyRow): Promise<number> {
  const [saved] = await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, is_archive)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (blob_key) DO UPDATE SET blob_key = EXCLUDED.blob_key RETURNING id`,
  [row.url, row.finalUrl, row.fetchedAt, row.httpStatus, row.contentHash.replace(/^sha256-/, ""), `artifact:${row.artifactId}`,
    isArchive(row.finalUrl)]);
  return Number(saved!.id);
}

export async function saveHeldCaptureCopy(query: Query, capture: WorkerPublicationCapture): Promise<SavedCopy> {
  const { evidence } = capture;
  const id = await saveCopy(query, { artifactId: evidence.artifactId, url: evidence.canonicalUrl, finalUrl: evidence.canonicalUrl,
    fetchedAt: capture.observedAt, httpStatus: capture.httpStatus, contentHash: evidence.contentHash });
  return { id, finalUrl: evidence.canonicalUrl, text: checkText(evidence.text, "", evidence.canonicalUrl), fetchedAt: new Date(capture.observedAt), isArchive: isArchive(evidence.canonicalUrl) };
}

/** A page another store holds, as checkFact reads it; it has no row here. */
export function heldPageCopy(page: { readonly finalUrl: string; readonly body: string; readonly contentType: string; readonly fetchedAt: string }): SavedCopy {
  return { id: 0, finalUrl: page.finalUrl, text: checkText(page.body, page.contentType, page.finalUrl), fetchedAt: new Date(page.fetchedAt), isArchive: isArchive(page.finalUrl) };
}
