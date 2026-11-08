import { createHash } from "node:crypto";
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
  const sha256 = row.contentHash.replace(/^sha256-/, "");
  const [existing] = await query(`SELECT id,final_url FROM source_copy WHERE blob_key=$1
    UNION ALL SELECT id,final_url FROM source_copy WHERE final_url=$2 AND sha256=$3 AND http_status IS NOT DISTINCT FROM $4 ORDER BY id LIMIT 1`,
  [row.key,row.finalUrl,sha256,row.httpStatus]);
  if (existing?.final_url === row.finalUrl) return Number(existing.id);
  const key = existing ? `${row.key}:url:${createHash("sha256").update(row.finalUrl).digest("hex")}` : row.key;
  const [saved] = await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, is_archive)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (blob_key) DO NOTHING RETURNING id`,
  [row.url, row.finalUrl, row.fetchedAt, row.httpStatus, sha256, key,
    isArchive(row.finalUrl)]);
  if (saved) return Number(saved.id);
  const [held] = await query("SELECT id FROM source_copy WHERE blob_key = $1", [key]);
  return Number(held!.id);
}

export async function saveCaptureCopy(query: Query, capture: WorkerPublicationCapture): Promise<SavedCopy> {
  const { evidence } = capture;
  const id = await saveSourceReference(query, { key: `artifact:${evidence.artifactId}`, url: evidence.canonicalUrl, finalUrl: evidence.canonicalUrl,
    fetchedAt: capture.observedAt, httpStatus: capture.httpStatus, contentHash: evidence.contentHash });
  return { id, finalUrl: evidence.canonicalUrl, text: checkText(evidence.text, "", evidence.canonicalUrl), fetchedAt: new Date(capture.observedAt), isArchive: isArchive(evidence.canonicalUrl) };
}

/** The rows of a published release the repo keeps beside its note, as a saved copy captured on the source's latest check: a re-check reuses its exact retained content. */
export async function saveReleaseCopy(query: Query, release: { readonly name: string; readonly url: string; readonly sha256: string;
  readonly checkedAt: string; readonly text: string }): Promise<SavedCopy> {
  const id = await saveSourceReference(query, { key: `release:${release.name}:${release.sha256}`, url: release.url, finalUrl: release.url,
    fetchedAt: release.checkedAt, httpStatus: 200, contentHash: release.sha256 });
  return { id, finalUrl: release.url, text: release.text, fetchedAt: new Date(release.checkedAt), isArchive: false };
}

/** A page another store holds, as checkFact reads it; it has no row here. */
export function pageCopy(page: { readonly finalUrl: string; readonly body: string; readonly contentType: string; readonly fetchedAt: string }): SavedCopy {
  return { id: 0, finalUrl: page.finalUrl, text: checkText(page.body, page.contentType, page.finalUrl), fetchedAt: new Date(page.fetchedAt), isArchive: isArchive(page.finalUrl) };
}
