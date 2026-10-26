import { vaultCapture } from "../facts/capture.ts";
import { enqueueReaderPlaces } from "../reader/cache.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";
import { meetingEntityId } from "../facts/meeting-read.ts";

/** A cut-off fact publication or a due source-field blank continues through the normal publication path. */
export async function meetingFactWorkRemains(query: Query, meetingIds: readonly string[], bodyIds: readonly string[], at: string): Promise<boolean> {
  const [row] = await query(`SELECT EXISTS (
      SELECT 1 FROM unnest($1::text[]) m(id) CROSS JOIN unnest(ARRAY['title','starts_at']) fields(field)
      WHERE NOT EXISTS(SELECT 1 FROM fact f WHERE f.entity_id=m.id AND f.field=fields.field AND f.status='live')
    ) OR EXISTS (
      SELECT 1 FROM blank b JOIN entity e ON e.id=b.entity_id
      WHERE e.kind='meeting' AND e.parent_id=ANY($2::text[]) AND b.next_try_at<=$3::timestamptz
        AND b.field=ANY(ARRAY['title','starts_at','location','agenda_url','video_url','online_access'])
    ) AS owed`, [meetingIds.map(meetingEntityId), [...new Set(bodyIds)], at]);
  return row?.owed !== false;
}

/** Equal saved source bytes keep existing meeting facts current; no fact value or quote leaves the database. */
export async function confirmMeetingFactsFromSources(input: {
  readonly facts: FactDb & { readonly query: Query };
  readonly vault: EvidenceStore;
  readonly bodyIds: readonly string[];
  readonly responses: readonly RetainedSourceResponse[];
}): Promise<number> {
  let confirmed = 0;
  for (const response of input.responses) {
    const saved = await vaultCapture({ vault: input.vault, url: response.finalUrl, bytes: response.bytes, httpStatus: response.httpStatus,
      contentType: response.contentType, retrievedAt: response.retrievedAt });
    if ("error" in saved) throw new Error(`MEETING_CONFIRMATION_SOURCE_UNSAVED: ${saved.error}`);
    const hash = saved.capture.evidence.contentHash.replace(/^sha256-/, "");
    confirmed += await input.facts.transaction(async query => {
      const rows = await query(`UPDATE fact f SET checked_at=greatest(f.checked_at,$1::timestamptz)
        FROM source_copy s,entity e WHERE f.source_copy_id=s.id AND e.id=f.entity_id AND e.kind='meeting'
          AND e.parent_id=ANY($2::text[]) AND f.status='live' AND f.provenance_kind<>'OWNER'
          AND s.sha256=$3 AND s.final_url=$4 AND NOT s.is_archive AND f.checked_at<$1::timestamptz
        RETURNING f.entity_id`, [saved.capture.observedAt, [...new Set(input.bodyIds)], hash, saved.capture.evidence.canonicalUrl]);
      if (rows.length) await enqueueReaderPlaces({ entities: [...new Set(rows.map(row => String(row.entity_id)))] }, query);
      return rows.length;
    });
  }
  return confirmed;
}
