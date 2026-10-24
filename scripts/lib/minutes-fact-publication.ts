import { join } from "node:path";
import { DurableEvidenceStore } from "../../lib/control-plane/evidence/durable-store.ts";
import type { EvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import { VAULT_DIR } from "../../lib/control-plane/scheduler/vault.ts";
import type { RetainedSourceResponse } from "../../lib/civic-data/retained-meeting-bytes.ts";
import { vaultCapture } from "../../lib/facts/capture.ts";
import { checkFact, type CheckEntity } from "../../lib/facts/check.ts";
import { factClocks } from "../../lib/facts/clocks.ts";
import { readerFactDb } from "../../lib/facts/db.ts";
import { ensureEntity, learnDoorChannel } from "../../lib/facts/entities.ts";
import { readCheckEntity } from "../../lib/facts/entity-read.ts";
import { meetingEntityId } from "../../lib/facts/meeting-read.ts";
import { publishClaim, type PublishInput, type PublishOutcome } from "../../lib/facts/publish.ts";
import { pageCopy, saveCaptureCopy } from "../../lib/facts/source-copy.ts";
import { minutesLinkFor } from "../../lib/outcomes/minutes-ingest.ts";
import { parseCalendarRows } from "../../lib/sources/legistar-insite/calendar.ts";
import type { InSiteTenant } from "../../lib/sources/legistar-insite/tenant-registry.ts";
import { decodeEntities } from "../../lib/sources/http.ts";

export type MinutesFactSink = (claim: PublishInput) => Promise<PublishOutcome>;

/** Each published minutes link cites its own sitting's saved calendar row, independently of motion extraction. */
export function minutesFactPublisher(input: {
  readonly tenant: InSiteTenant;
  readonly responses: readonly RetainedSourceResponse[];
  readonly writes: boolean;
  readonly sink?: MinutesFactSink;
  readonly vault?: EvidenceStore;
}) {
  const clocks = factClocks(null);
  let db: ReturnType<typeof readerFactDb> | null = null;
  let vault = input.vault;
  const saved = new Map<string, Awaited<ReturnType<typeof saveCaptureCopy>>>();
  return async (meetingId: string, url: string, observedAt: string): Promise<PublishOutcome> => {
    let proof: { response: RetainedSourceResponse; quote: string; valueText: string } | undefined;
    for (const response of input.responses) {
      const calendar = new URL(response.finalUrl);
      if (calendar.hostname !== input.tenant.host || calendar.pathname.toLowerCase() !== "/calendar.aspx") continue;
      const html = new TextDecoder().decode(response.bytes);
      for (const [rowHtml] of html.matchAll(/<tr\b[^>]*class="rg(?:Alt)?Row"[^>]*>[\s\S]*?<\/tr>/gi)) {
        const row = parseCalendarRows(rowHtml)[0];
        if (!row || `legistar-insite:${input.tenant.slug}:${row.insiteId}` !== meetingId ||
          !input.tenant.bodyNames.includes(row.bodyName) || minutesLinkFor(row, input.tenant.host)?.url !== url) continue;
        for (const [quote] of rowHtml.matchAll(/<a\b[^>]*id="[^"]*_(?:hypMinutes|hypAccessibleMinutesHTML)"[^>]*>[\s\S]*?<\/a>/gi)) {
          const valueText = /\bhref="([^"]+)"/i.exec(quote)?.[1];
          if (valueText && URL.canParse(decodeEntities(valueText), response.finalUrl) && new URL(decodeEntities(valueText), response.finalUrl).href === url) {
            proof = { response, quote, valueText }; break;
          }
        }
        if (proof) break;
      }
      if (proof) break;
    }
    if (!proof) return { blank: "MINUTES_LINK_NOT_ON_SITTING_CALENDAR_ROW" };
    const { response } = proof;
    const id = meetingEntityId(meetingId), state = /\/state:([a-z]{2})/.exec(input.tenant.ocdId ?? input.tenant.bodyId)?.[1]?.toUpperCase() ?? null;
    let entity: CheckEntity = { id, fullName: input.tenant.bodyName, stateName: null,
      hosts: [input.tenant.host], externalIds: [meetingId] };
    let copy = pageCopy({ finalUrl: response.finalUrl, body: new TextDecoder().decode(response.bytes), contentType: response.contentType, fetchedAt: response.retrievedAt });
    if (input.writes && !input.sink) {
      db ??= readerFactDb();
      await ensureEntity(db.query, { id: input.tenant.bodyId, kind: "body", name: input.tenant.bodyName, state, parentId: input.tenant.ocdId });
      await learnDoorChannel(db.query, input.tenant.bodyId, response.finalUrl);
      await ensureEntity(db.query, { id, kind: "meeting", name: input.tenant.bodyName, state, parentId: input.tenant.bodyId });
      await db.query("INSERT INTO entity_place (entity_id, place_id) SELECT $1, place_id FROM entity_place WHERE entity_id = $2 ON CONFLICT DO NOTHING", [id, input.tenant.bodyId]);
      const heldEntity = await readCheckEntity(db.query, id);
      if (!heldEntity) return { blank: "MEETING_ENTITY_NOT_READ_BACK" };
      entity = heldEntity;
      const existing = saved.get(response.rawHash);
      if (existing) copy = existing;
      else {
        vault ??= new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
        const captured = await vaultCapture({ vault, url: response.finalUrl, bytes: response.bytes, httpStatus: response.httpStatus,
          contentType: response.contentType, retrievedAt: response.retrievedAt });
        if ("error" in captured) return { blank: captured.error };
        copy = await db.transaction(query => saveCaptureCopy(query, captured.capture));
        saved.set(response.rawHash, copy);
      }
    }
    const claim: PublishInput = { entity, field: "minutes_url", fieldKind: "outcome", provenance: "OFFICIAL", value: url,
      valueText: proof.valueText, quote: proof.quote, copy, producedBy: "legistar-insite-minutes-ingest", costUsd: 0 };
    const checked = checkFact(claim, new Date(observedAt), clocks.windowHours);
    if (!checked.ok) return { blank: checked.reason };
    if (input.sink) return input.sink(claim);
    return input.writes ? publishClaim(db!, claim, clocks, new Date(observedAt)) : { decision: "PUBLISH", factId: null };
  };
}
