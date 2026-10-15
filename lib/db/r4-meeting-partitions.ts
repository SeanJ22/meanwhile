import type { NeonQueryFunction } from "@neondatabase/serverless";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "../civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../civic-data/store.ts";
import { processRegisteredMeetingHistoryCandidate, processRegisteredMeetingPartitionCandidate } from "../civic-data/promotion.ts";
import { meetingHistoryContract, meetingPartitionId, requiredMeetingPartitionContract, type MeetingPartitionContract } from "../civic-data/meeting-partitions.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineCandidate } from "../civic-data/types.ts";
import { buildMeetingHistorySnapshot, meetingHistoryCandidate } from "../civic-data/meeting-history.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { createHash } from "node:crypto";
import { snapshotCounts, type MeetingsSnapshot } from "../meetings/snapshot.ts";
import { installDoorRecords } from "../doors/meeting-doors.ts";
import { isDoorRecord, type DoorRepository } from "../doors/registry.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { candidateForMeetingPartition } from "../../scripts/ingest.ts";

type MigrationSql = NeonQueryFunction<false, false>;

export async function validateMeetingPartitionTransfer(partition: MeetingPartitionContract, snapshot: MeetingsSnapshot,
  check: NonNullable<RoutineCandidate["retrieval"]["sourceCheck"]>, now: string) {
  const built = candidateForMeetingPartition(partition, snapshot);
  const candidate = { ...built, retrieval: { ...built.retrieval, sourceCheck: check } };
  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredMeetingPartitionCandidate(store, partition.id, candidate, now);
  if (!outcome.promoted) throw new Error(`R4_MEETING_TRANSFER_REFUSED:${partition.id}:${outcome.candidate.failureDetail}`);
  return { record: outcome.candidate, pointer: outcome.promoted, events: await store.events(candidate.id) };
}

export async function validateMeetingHistoryTransfer(partition: MeetingPartitionContract, snapshot: MeetingsSnapshot,
  original: CandidateVersionRecord, promotedAt: string, now: string,
  held?: { record: CandidateVersionRecord; promotedAt: string }) {
  const inputs = [{ record: original, promotedAt }, ...(held ? [held] : [])];
  const candidate = meetingHistoryCandidate(partition, snapshot, inputs.map(input => ({ kind: "PROMOTED_VERSION", recordClass: "MEETING",
    scope: input.record.candidate.scope, versionId: input.record.candidate.id, promotedAt: input.promotedAt,
    readModelSha256: createHash("sha256").update(canonicalCivicDataJson(input.record.candidate.readModel)).digest("hex") })));
  const store = new MemoryRoutineDataStore();
  const ownCandidate = store.readCandidate.bind(store);
  store.readCandidate = async id => inputs.find(input => input.record.candidate.id === id)?.record ?? ownCandidate(id);
  const outcome = await processRegisteredMeetingHistoryCandidate(store, partition.id, candidate, now);
  if (!outcome.promoted) throw new Error(`R4_MEETING_HISTORY_TRANSFER_REFUSED:${partition.id}:${outcome.candidate.failureDetail}`);
  return { record: outcome.candidate, pointer: outcome.promoted, events: await store.events(candidate.id) };
}

export async function transferMeetingFamilies(sql: MigrationSql, doorRepository?: DoorRepository): Promise<number> {
  const parts = new CivicPayloadParts({
    existing: async () => [],
    write: async () => { throw new Error("R4_TRANSFER_READ_ONLY_PARTS"); },
    read: async hashes => await sql.query("SELECT hash, payload FROM civic_data_payload_parts WHERE hash = ANY($1::text[])", [[...hashes]]) as { hash: string; payload: unknown }[],
  });
  const readCandidate = async (id: string): Promise<CandidateVersionRecord | null> => {
    const [row] = await sql.query(`SELECT candidate, state, acquisition_succeeded AS "acquisitionSucceeded", validation_receipt AS receipt,
      promoted_version_id AS "promotedVersion", last_known_good_version_id AS "lastKnownGoodVersion",
      failure_code AS "failureCode", failure_detail AS "failureDetail" FROM civic_data_candidates WHERE id=$1`, [id]);
    return row ? { ...row, candidate: await parts.load(row.candidate) } as CandidateVersionRecord : null;
  };
  const reader: CivicDataReadStore = {
    readCandidate,
    async readPromotion<T>(recordClass: string, scope: string) {
      const [row] = await sql.query(`SELECT key, source_id AS "sourceId", record_class AS "recordClass", scope,
        current_version_id AS "versionId", last_known_good_version_id AS "lastKnownGoodVersionId", promoted_at AS "promotedAt",
        payload, validation_receipt AS receipt FROM civic_data_promotions WHERE record_class=$1 AND scope=$2`, [recordClass, scope]);
      return row ? { ...row, promotedAt: new Date(row.promotedAt).toISOString(), payload: await parts.load(row.payload) } as PromotedProjection<T> : null;
    },
  };
  const families = await sql.query("SELECT scope FROM civic_data_promotions WHERE record_class='MEETING' AND scope LIKE 'source:derived:family:US-%' ORDER BY scope");
  if (families.length === 0) return 0;
  const connection = controlPlaneUrlFromEnv();
  const doorsRepo = doorRepository ?? (connection
    ? (await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true })).doors : null);
  if (!doorsRepo) throw new Error("R4_MEETING_TRANSFER_DOORS_UNAVAILABLE");
  let moved = 0;
  for (const family of families) {
    const scope = String(family.scope);
    const history = scope.endsWith(":history");
    const read = await readPromotedCivicData<MeetingsSnapshot>("MEETING", scope, { store: reader, bypassCache: true });
    if (read.kind !== "PROMOTED") throw new Error(`R4_MEETING_FAMILY_UNVERIFIED:${scope}:${read.kind}`);
    const original = await readCandidate(read.metadata.versionId!);
    if (!original) throw new Error(`R4_MEETING_FAMILY_CANDIDATE_MISSING:${scope}`);
    const groups = new Map<string, { bodyId: string; source: string }>();
    for (const meeting of read.value.meetings) {
      const source = meeting.id.split(":")[0]!;
      if (!meeting.bodyId) throw new Error(`R4_MEETING_TRANSFER_BODY_MISSING:${meeting.id}`);
      groups.set(meetingPartitionId(source, meeting.bodyId), { source, bodyId: meeting.bodyId });
    }
    for (const [id, group] of groups) {
      const doorRows = await doorsRepo.listWhere(["bodyIds", "0"], group.bodyId);
      const doors = doorRows.map(row => row.value).filter(isDoorRecord);
      installDoorRecords(doors.map(door => ({ ...door, status: "OPEN" })));
      const partition = requiredMeetingPartitionContract(id);
      const target = history ? meetingHistoryContract(partition) : partition;
      const held = await reader.readPromotion<MeetingsSnapshot>("MEETING", target.scope);
      const heldRecord = held ? await readCandidate(held.versionId) : null;
      if (held && !heldRecord) throw new Error(`R4_MEETING_TRANSFER_TARGET_UNVERIFIED:${id}`);
      const checks = held ? await sql.query(`SELECT substring(detail from length('UNCHANGED_CONFIRMATION_V1 ') + 1)::jsonb AS receipt
        FROM civic_data_candidate_events WHERE candidate_id=$1 AND detail LIKE 'UNCHANGED_CONFIRMATION_V1 %'`, [held.versionId]) : [];
      const heldCheckedAt = [heldRecord?.candidate.retrieval.sourceCheck?.checkedAt ?? heldRecord?.candidate.retrieval.retrievedAt,
        ...checks.map(row => row.receipt.retrieval.retrievedAt)].filter((at): at is string => typeof at === "string").sort().at(-1);
      let meetings = read.value.meetings.filter(row => row.bodyId === group.bodyId && row.id.startsWith(`${group.source}:`));
      let transfer: Awaited<ReturnType<typeof validateMeetingPartitionTransfer>>;
      if (history) {
        if (heldCheckedAt && Date.parse(heldCheckedAt) >= Date.parse(original.candidate.retrieval.retrievedAt)) continue;
        const snapshot = buildMeetingHistorySnapshot({ history: held?.payload ?? null, moved: meetings,
          agendaDocuments: read.value.agendaDocuments, generatedAt: read.value.generatedAt });
        transfer = await validateMeetingHistoryTransfer(partition, snapshot, original, read.metadata.promotedAt!, new Date().toISOString(),
          held && heldRecord ? { record: heldRecord, promotedAt: held.promotedAt } : undefined);
      } else {
        const doorIds = new Set(doors.filter(door => door.kind === group.source).map(door => door.doorId));
        const evidenceFor = (record: CandidateVersionRecord) => (record.candidate.retrieval.derived?.inputs ?? [])
          .filter(input => input.kind === "MEMBER_ACQUISITION" && doorIds.has(input.memberKey));
        let evidence = evidenceFor(original);
        let evidenceSnapshot = read.value;
        if (!evidence.length) {
          const earlier = await sql.query(`SELECT id FROM civic_data_candidates WHERE record_class='MEETING' AND scope=$1 AND state='PROMOTED'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(candidate#>'{retrieval,derived,inputs}') i WHERE i->>'memberKey'=ANY($2::text[]))
            ORDER BY retrieved_at DESC LIMIT 1`, [scope, [...doorIds]]);
          const prior = earlier[0] ? await readCandidate(String(earlier[0].id)) : null;
          if (prior) { evidence = evidenceFor(prior); evidenceSnapshot = prior.candidate.readModel as MeetingsSnapshot; }
        }
        const hashes = new Set(evidence.flatMap(input => input.kind === "MEMBER_ACQUISITION" ? [input.rawHash] : []));
        const acquisitions = evidenceSnapshot.sources.flatMap(source => source.acquisitions ?? [])
          .filter(acquisition => acquisition.source === group.source && hashes.has(acquisition.rawHash));
        const first = acquisitions[0];
        const checkedAt = evidence.flatMap(input => input.kind === "MEMBER_ACQUISITION" ? [input.retrievedAt] : []).sort()[0];
        if (!first || !checkedAt) throw new Error(`R4_MEETING_TRANSFER_EVIDENCE_MISSING:${id}`);
        if (heldCheckedAt && Date.parse(heldCheckedAt) >= Date.parse(checkedAt)) continue;
        const incomingIds = new Set(meetings.map(meeting => meeting.id));
        meetings = [...meetings, ...(held?.payload.meetings ?? []).filter(row => !incomingIds.has(row.id)).map(row => ({
          ...row, carried: row.carried ?? { source: group.source, reason: "UNEXPLAINED_DISAPPEARANCE" as const,
            lastFreshAt: row.provenance.collectedAt } }))];
        const ids = new Set(meetings.map(meeting => meeting.id));
        const counts = snapshotCounts(meetings, 0);
        const successfulCarry = meetings.filter(meeting => meeting.carried &&
          ["UNEXPLAINED_DISAPPEARANCE", "OUTSIDE_FETCH_WINDOW"].includes(meeting.carried.reason ?? "")).length;
        const heldCarry = counts.carried - successfulCarry;
        const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: read.value.generatedAt, counts, meetings,
          agendaDocuments: [...new Map([...(held?.payload.agendaDocuments ?? []), ...read.value.agendaDocuments]
            .filter(document => ids.has(document.meetingId)).map(document => [document.id, document])).values()],
          sources: [{ source: group.source, ok: true, error: null, fetched: counts.fresh, normalized: counts.fresh,
            ...(successfulCarry ? { carriedForward: successfulCarry } : {}),
            drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 }, acquisitions },
          ...(heldCarry ? [{ source: group.source, ok: false, error: "Calendar routes remain held on their last verified sittings.",
            fetched: 0, normalized: 0, carriedForward: heldCarry,
            drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }] : [])] };
        transfer = await validateMeetingPartitionTransfer(partition, snapshot,
          { requestedUrl: first.requestedUrl, finalUrl: first.finalUrl, httpStatus: 200, rawHash: first.rawHash, checkedAt }, new Date().toISOString());
      }
      const { record, pointer, events } = transfer;
      const c = record.candidate;
      const persisted = await sql.transaction([
        sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [pointer.key]),
        sql.query(`INSERT INTO civic_data_candidates (id,source_id,record_class,scope,state,acquisition_succeeded,raw_hash,normalized_hash,
          retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16) ON CONFLICT (id) DO NOTHING`,
        [c.id,c.sourceId,c.recordClass,c.scope,record.state,record.acquisitionSucceeded,c.retrieval.rawHash,c.normalization.normalizedHash,
          c.retrieval.retrievedAt,c.temporal.sourceThrough,c.normalization.parserVersion,JSON.stringify(c.identities),JSON.stringify(c),
          JSON.stringify(record.receipt),record.promotedVersion,record.lastKnownGoodVersion]),
        sql.query(`INSERT INTO civic_data_candidate_events (candidate_id,sequence,state,at,detail)
          SELECT $1, sequence, state, at::timestamptz, detail FROM jsonb_to_recordset($2::jsonb) AS e(sequence int,state text,at text,detail text)
          WHERE NOT EXISTS (SELECT 1 FROM civic_data_candidate_events held WHERE held.candidate_id=$1 AND held.sequence=e.sequence)
          ORDER BY sequence ON CONFLICT (candidate_id,sequence) DO NOTHING`, [c.id,JSON.stringify(events)]),
        sql.query(`INSERT INTO civic_data_promotions (key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) ON CONFLICT (record_class,scope) DO UPDATE SET
          current_version_id=EXCLUDED.current_version_id,last_known_good_version_id=EXCLUDED.last_known_good_version_id,
          promoted_at=EXCLUDED.promoted_at,payload=EXCLUDED.payload,validation_receipt=EXCLUDED.validation_receipt
          WHERE civic_data_promotions.current_version_id=$10 AND civic_data_promotions.current_version_id<>EXCLUDED.current_version_id RETURNING key`,
        [pointer.key,pointer.sourceId,pointer.recordClass,pointer.scope,pointer.versionId,pointer.lastKnownGoodVersionId,pointer.promotedAt,
          JSON.stringify(pointer.payload),JSON.stringify(pointer.receipt),held?.versionId ?? null]),
      ]);
      moved += persisted.at(-1)?.length ?? 0;
    }
  }
  return moved;
}
