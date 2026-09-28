/** Admin history is evidence of a past publication, never a current Reader check. */
export const PUBLICATION_HISTORY_PAGE_SIZE = 25;
export interface PublishedHistoryRow {
  readonly version: string; readonly recordKey: string; readonly recordClass: string;
  readonly scope: string; readonly label: string; readonly recordedAt: string; readonly publishedAt: string | null;
  readonly currentVersion: boolean; readonly sourceUrl: string | null;
  readonly excerpt: string; readonly detail: string; readonly detailTruncated: boolean;
}
export interface PublishedHistoryRead {
  readonly state: "READ" | "NOT_ASKED" | "UNAVAILABLE";
  readonly rows: readonly PublishedHistoryRow[]; readonly total: number | null;
  readonly page: number; readonly asOf: string; readonly reason: string | null;
}
export function publicHistoryUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const [key, item] of [...url.searchParams.entries()]) {
      if (/token|secret|password|api.?key|authorization|signature|credential|^(?:sig|code|key|jwt|auth|session)$/i.test(key)
        || /(?:sk-(?:ant-)?|ghp_|github_pat_)[A-Za-z0-9_-]{12,}|^eyJ[A-Za-z0-9_-]+\./.test(item)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return null; }
}
/** Defensive rendering of already-public read models; never display source envelopes. */
export function safePublicationDetail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safePublicationDetail);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:password|passwd|secret|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|private[_-]?key|cookie)$/i.test(key) ? "[redacted]" : safePublicationDetail(item)]));
  if (typeof value !== "string") return value;
  return value.replace(/https?:\/\/[^\s<>"']+/gi, found => publicHistoryUrl(found) ?? "[private URL removed]")
    .replace(/\bpostgres(?:ql)?:\/\/\S+/gi, "[private connection removed]")
    .replace(/\b(?:sk-(?:ant-)?|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, "[credential removed]");
}
export function publicationHistoryRow(raw: Record<string, unknown>, fullDetail = false): PublishedHistoryRow {
  const record = safePublicationDetail(raw.record);
  const fields = record && typeof record === "object" && !Array.isArray(record) ? record as Record<string, unknown> : {};
  const text = JSON.stringify(record, null, 2) ?? "null";
  const label = [fields.name, fields.title, fields.bodyName, fields.candidateName, fields.candidateNameAsFiled, fields.label]
    .find(value => typeof value === "string" && value.trim());
  const query = typeof raw.query === "string" ? raw.query : "";
  const match = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, match - 80);
  return {version:String(raw.version),recordKey:String(raw.record_key),recordClass:String(raw.record_class),
    scope:String(raw.scope),label:typeof label === "string" ? label : "Published source record",
    recordedAt:String(raw.recorded_at),publishedAt:typeof raw.published_at === "string" ? raw.published_at : null,currentVersion:raw.current_version === true,
    sourceUrl:publicHistoryUrl(fields.sourceUrl ?? (fields.provenance as Record<string, unknown> | undefined)?.sourceUrl ?? raw.source_url),
    excerpt:text.slice(start,start+500),detail:fullDetail ? text : text.slice(0,12_000),detailTruncated:!fullDetail && text.length>12_000};
}
