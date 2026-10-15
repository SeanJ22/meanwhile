import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { fetchSource, SourceFetchDeferred } from "../sources/fetch-source.ts";
import { captureProvenance, vaultCapture } from "./capture.ts";
import { checkFact, FIELD_KINDS, needsSecondSource, type FieldKind, type Provenance } from "./check.ts";
import { readCheckEntity } from "./entity-read.ts";
import type { Clocks, FactDb, Query } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";

const KIND_SQL = `CASE
  WHEN f.field LIKE 'comment:%' THEN 'comment_rule'
  WHEN f.field IN ('email','phone','website','homepage','office_address','office_phone') THEN 'contact'
  WHEN f.field IN ('portrait','photo','photo_url') THEN 'portrait'
  WHEN f.field LIKE 'same_person%' THEN 'same_person_link'
  WHEN e.kind = 'meeting' AND f.field = 'agenda_url' THEN 'agenda'
  WHEN e.kind = 'meeting' OR f.field IN ('meeting_cadence','agenda_url','video_url') THEN 'meeting'
  WHEN e.kind = 'vote_event' THEN 'vote'
  WHEN e.kind = 'agenda_item' OR f.field IN ('minutes','outcome','decision') THEN 'outcome'
  WHEN e.kind = 'committee' OR f.field IN ('amount','receipts','expenditures','contributions') THEN 'money'
  WHEN e.kind IN ('election','contest','candidacy','measure') THEN 'ballot'
  WHEN e.kind = 'statement' THEN 'statement'
  WHEN e.kind IN ('bill','law_question') THEN 'law'
  WHEN e.kind = 'news_item' THEN 'news'
  ELSE 'officeholder' END`;
// Keep the planner on each state's entity indexes before it looks up facts and retries.
const DUE_SQL = `SELECT f.id, f.entity_id, f.field, ${KIND_SQL} AS field_kind,
    greatest(f.checked_at + make_interval(secs => (($2::jsonb ->> (${KIND_SQL}))::double precision * 3600)),
      coalesce((SELECT b.next_try_at FROM blank b WHERE b.entity_id = f.entity_id AND b.field = f.field), '-infinity'::timestamptz)) AS due_at
  FROM entity e CROSS JOIN LATERAL (
    SELECT f.id, f.entity_id, f.field, f.checked_at FROM fact f
    WHERE f.entity_id = e.id AND f.status = 'live' AND f.provenance_kind <> 'OWNER' OFFSET 0
  ) f WHERE e.state = $1::char(2) OR (e.state IS NULL AND $1::char(2) IS NULL)`;

export interface FactRefreshResult {
  readonly checked: number;
  readonly confirmed: number;
  readonly blanks: number;
  readonly nextDueAt: string | null;
}

export async function refreshStaleFacts(input: {
  readonly facts: FactDb & { readonly query: Query };
  readonly repos: Pick<ControlPlaneRepositories, "artifacts">;
  readonly vault: EvidenceStore;
  readonly state: string;
  readonly clocks: Clocks;
  readonly now: string;
  readonly limit?: number;
  readonly fetchImpl?: typeof fetch;
}): Promise<FactRefreshResult> {
  if (!/^(?:[A-Z]{2}|US)$/.test(input.state)) throw new Error("FACT_REFRESH_STATE_INVALID");
  const now = new Date(input.now);
  if (!Number.isFinite(now.getTime())) throw new Error("FACT_REFRESH_TIME_INVALID");
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
  const windows = Object.fromEntries(FIELD_KINDS.map(kind => [kind, input.clocks.windowHours(kind)]));
  const params = [input.state === "US" ? null : input.state, JSON.stringify(windows)];
  const rows = await input.facts.query(`WITH candidates AS (${DUE_SQL}), due AS MATERIALIZED (
    SELECT * FROM candidates WHERE due_at <= $3::timestamptz ORDER BY due_at, id LIMIT $4)
    SELECT due.*, f.value, f.value_text, f.quote, f.provenance_kind, s.url, s2.url AS second_url
    FROM due JOIN fact f ON f.id = due.id JOIN source_copy s ON s.id = f.source_copy_id
    LEFT JOIN source_copy s2 ON s2.id = f.second_copy_id ORDER BY due.due_at, due.id`, [...params, input.now, limit]);
  const fetchCopy = async (url: string) => {
    const response = await (input.fetchImpl ?? fetchSource)(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const saved = await vaultCapture({ vault: input.vault, url: response.url || url,
      bytes: new Uint8Array(await response.arrayBuffer()), httpStatus: response.status,
      contentType: response.headers.get("content-type") ?? "text/plain", retrievedAt: input.now });
    if ("error" in saved) throw new Error(saved.error);
    await input.repos.artifacts.append(saved.record.workItemId, `${saved.record.artifactId}:${saved.record.attemptId}`, saved.record, input.now);
    return { capture: saved.capture, copy: await input.facts.transaction(query => saveCaptureCopy(query, saved.capture)) };
  };
  let lastRead: { url: string; result: ReturnType<typeof fetchCopy> } | null = null;
  const read = (url: string) => {
    if (lastRead?.url !== url) lastRead = { url, result: fetchCopy(url) };
    return lastRead.result;
  };
  let confirmed = 0, blanks = 0;
  for (const row of rows) {
    const kind = row.field_kind as FieldKind, entityId = String(row.entity_id), field = String(row.field);
    const retryAt = new Date(now.getTime() + input.clocks.retryMinutes(kind) * 60_000).toISOString();
    const hold = async (reason: string, detail: string, nextTryAt = retryAt) => {
      await input.facts.query(`INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
        VALUES ($1, $2, 'CHECK', $3, $4, $5, 1)
        ON CONFLICT (entity_id, field) DO UPDATE SET stage = 'CHECK', reason = EXCLUDED.reason,
          detail = EXCLUDED.detail, next_try_at = EXCLUDED.next_try_at, attempts = blank.attempts + 1, updated_at = $6`,
      [entityId, field, reason, detail, nextTryAt, input.now]);
    };
    await input.facts.query(`INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
      VALUES ($1, $2, 'CHECK', 'RECHECK_DUE', $3, $4, 0) ON CONFLICT (entity_id, field) DO NOTHING`,
    [entityId, field, String(row.url), retryAt]);
    try {
      const entity = await readCheckEntity(input.facts.query, entityId);
      if (!entity) throw new Error("FACT_ENTITY_MISSING");
      const primary = await read(String(row.url));
      const provenance = new URL(primary.copy.finalUrl).hostname === new URL(String(row.url)).hostname
        ? row.provenance_kind as Provenance : captureProvenance(primary.capture, entity.hosts);
      const second = needsSecondSource(kind, provenance, primary.copy.finalUrl) && row.second_url
        ? { copy: (await read(String(row.second_url))).copy, quote: String(row.value_text) } : undefined;
      const verdict = checkFact({ entity, fieldKind: kind, provenance, valueText: String(row.value_text),
        quote: String(row.quote), copy: primary.copy, second }, now, input.clocks.windowHours);
      if (!verdict.ok) {
        blanks++;
        await hold(`CHECK_FAILED:${verdict.reason}`, String(row.url));
      } else {
        const advanced = await input.facts.transaction(async query => {
          const changed = await query(`UPDATE fact SET checked_at = $2 WHERE id = $1 AND status = 'live' AND checked_at < $2 RETURNING id`, [row.id, input.now]);
          if (changed.length) await query("DELETE FROM blank WHERE entity_id = $1 AND field = $2", [entityId, field]);
          return changed.length;
        });
        confirmed += advanced;
      }
    } catch (error) {
      blanks++;
      const nextTry = error instanceof SourceFetchDeferred ? new Date(Math.max(Date.parse(retryAt), error.until)).toISOString() : retryAt;
      await hold("RECHECK_SOURCE_FAILED", error instanceof Error ? error.message : String(error), nextTry);
    }
  }
  const [next] = await input.facts.query(`WITH due AS (${DUE_SQL}) SELECT min(due_at) AS next_due_at FROM due`, params);
  const nextDueAt = next?.next_due_at == null ? null : new Date(String(next.next_due_at)).toISOString();
  return { checked: rows.length, confirmed, blanks, nextDueAt };
}
