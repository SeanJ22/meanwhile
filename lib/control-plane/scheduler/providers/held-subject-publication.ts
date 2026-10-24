import type { WorkerPublicationCapture } from "../../../civic-data/worker-roster-publication.ts";
import { captureProvenance } from "../../../facts/capture.ts";
import { ensureEntity, learnOfficialHost } from "../../../facts/entities.ts";
import { readCheckEntity } from "../../../facts/entity-read.ts";
import { openBlank, publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "../../../facts/publish.ts";
import { nameKey, publishRosterFacts, type RosterFactsReport } from "../../../facts/roster-facts.ts";
import { saveHeldCaptureCopy } from "./held-subject-copy.ts";
import { withBatchedReaderInvalidation, type ReaderCachePurger } from "../../../reader/cache.ts";
import { fingerprint } from "../../ids.ts";
import type { OfficeholderPhoto } from "../../../officials/types.ts";
import type { PortraitSources } from "../../../photos/evidence.ts";
import type { HeldSubjectDetails } from "./held-subject-enrichment.ts";
import { extractHeldSubjectDetails } from "./held-subject-extraction.ts";
import { heldCommitteeCandidates, heldCommitteeFacts, heldStatementFacts, heldStatementLinks, type HeldStatementLink } from "./held-official-details.ts";
import { readHeldCommitteeIdentities } from "./held-subject-loader.ts";
import { bindHeldMemberIdentity, indexHeldMemberIdentities, readHeldMemberIdentities } from "./held-subject-member-identities.ts";
import { governmentBodyAnchors, governmentBodyFacts, readHeldGovernmentBodies } from "./held-government-bodies.ts";
import { heldFactReaderDependency } from "./held-subject-fields.ts";

export interface HeldSubjectPublication {
  readonly facts: readonly { readonly field: string; readonly outcome: PublishOutcome }[];
  readonly roster: RosterFactsReport | null;
  readonly portraitImageUrl: string | null;
  readonly refused: string | null;
  readonly statementLinks?: readonly HeldStatementLink[];
  readonly rosterIdentityGaps?: readonly string[];
  readonly readerDependencies: readonly { readonly field: string; readonly ownerChange: string }[];
  readonly readerSupportedNewFacts: number;
}

export interface HeldSubjectPublicationInput {
  readonly subject: HeldSubjectDetails;
  readonly capture: WorkerPublicationCapture;
  readonly db: FactDb & { readonly query: Query };
  readonly clocks: Clocks;
  readonly now: Date;
  readonly purge?: ReaderCachePurger;
  readonly storePortrait?: (personId: string, sources: PortraitSources, at: string, signal: AbortSignal) => Promise<OfficeholderPhoto>;
  readonly signal?: AbortSignal;
}

/** Each quoted detail publishes on its own; the existing cache helper clears its tags once. */
export async function publishHeldSubjectDetails(input: HeldSubjectPublicationInput): Promise<HeldSubjectPublication> {
  return withBatchedReaderInvalidation(purge => publishDetails({ ...input, purge }), input.purge);
}

async function publishDetails(input: HeldSubjectPublicationInput): Promise<HeldSubjectPublication> {
  const { subject, capture, db, clocks, now } = input;
  const refuse = (refused: string): HeldSubjectPublication => ({ facts: [], roster: null, portraitImageUrl: null, refused,
    readerDependencies: [], readerSupportedNewFacts: 0 });
  if (capture.partial || capture.transport !== "REACHABLE" || capture.httpStatus === null || capture.httpStatus < 200 || capture.httpStatus >= 300 ||
    !Number.isFinite(Date.parse(capture.observedAt)) || !Number.isFinite(now.getTime()) || Date.parse(capture.observedAt) > now.getTime()) {
    return refuse("HELD_DETAIL_CAPTURE_INCOMPLETE");
  }
  const extracted = extractHeldSubjectDetails(subject, capture.evidence.text, capture.evidence.canonicalUrl, capture.observedAt);
  const statements = heldStatementFacts(subject, capture);
  if (extracted.refused && !statements.length) return refuse(extracted.refused);
  const id = subject.subjectKind === "official" ? subject.personId ?? subject.subjectId : subject.subjectId;
  if (extracted.facts.some(fact => fact.entityId !== id)) return refuse("HELD_DETAIL_SUBJECT_MISMATCH");
  const state = /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/i.exec(subject.divisionIds[0] ?? "")?.[1]?.toUpperCase() ?? null;
  await ensureEntity(db.query, { id, kind: subject.subjectKind === "official" ? "person" : subject.subjectKind,
    name: subject.subjectKind === "government" ? subject.label : subject.personName ?? subject.bodyName ?? subject.label,
    state, parentId: subject.bodyId === id || subject.subjectKind === "government" ? subject.divisionIds[0] ?? null : subject.bodyId });
  await learnOfficialHost(db.query, id, capture.evidence.canonicalUrl);
  const nativeId = /^congress:([A-Z]\d{6})$/.exec(subject.subjectId)?.[1] ?? /^congress:([A-Z]\d{6})$/.exec(id)?.[1];
  if (nativeId) await db.query(`INSERT INTO entity_external_id (entity_id, scheme, value) VALUES ($1, 'bioguide', $2)
    ON CONFLICT (scheme, value) DO NOTHING`, [id, nativeId]);
  await db.query(`INSERT INTO entity_place (entity_id, place_id) SELECT $1, id FROM entity
    WHERE kind='place' AND id=ANY($2::text[]) ON CONFLICT DO NOTHING`, [id, subject.divisionIds]);
  const entity = await readCheckEntity(db.query, id);
  if (!entity) return refuse("HELD_DETAIL_ENTITY_UNAVAILABLE");
  const copy = await db.transaction(query => saveHeldCaptureCopy(query, capture));
  const provenance = captureProvenance(capture, entity.hosts);
  const facts: { field: string; outcome: PublishOutcome }[] = [];
  const candidates = heldCommitteeCandidates(subject, capture.evidence.text, capture.evidence.canonicalUrl);
  let committees: ReturnType<typeof heldCommitteeFacts> = [];
  if (state && candidates.length) {
    try { committees = heldCommitteeFacts(subject, capture.evidence.text, capture.evidence.canonicalUrl,
      await readHeldCommitteeIdentities(db.query, state, candidates.map(candidate => candidate.name), subject.divisionIds, subject.officeTitle)); }
    catch (error) { await openBlank(db.query, { entityId: id, field: "committee_memberships", stage: "ACQUIRE", reason: "HELD_COMMITTEE_IDENTITY_UNREADABLE",
      detail: error instanceof Error ? error.message : String(error), retryMinutes: clocks.retryMinutes("officeholder") }); }
  }
  const anchors = governmentBodyAnchors(subject, capture);
  let bodies: ReturnType<typeof governmentBodyFacts> = [];
  if (anchors.length) {
    try { bodies = governmentBodyFacts(subject, capture, await readHeldGovernmentBodies(db.query, subject, anchors)); }
    catch (error) { await openBlank(db.query, { entityId: id, field: "body-associations", stage: "READ", reason: "HELD_GOVERNMENT_BODIES_UNREADABLE",
      detail: error instanceof Error ? error.message : String(error), retryMinutes: clocks.retryMinutes("officeholder") }); }
  }
  for (const fact of [...extracted.facts, ...committees, ...statements, ...bodies]) facts.push({ field: fact.field, outcome: await publishClaim(db, {
    entity, field: fact.field, fieldKind: fact.fieldKind, value: fact.value, valueText: fact.valueText, quote: fact.quote,
    provenance, copy, producedBy: "held-subject-digger", acquisition: "walker", costUsd: 0,
  }, clocks, now, { purge: input.purge }) });
  const rosterIdentityGaps: string[] = [], shownMemberIds = new Map<string, string>();
  let rosterRows = extracted.rosterRows;
  if (subject.subjectKind === "body" && rosterRows.length) {
    try {
      const identities = indexHeldMemberIdentities(await readHeldMemberIdentities(db.query, state ?? "", id));
      const accepted: typeof rosterRows[number][] = [];
      for (const row of rosterRows) {
        const key = nameKey(row.name), known = identities.get(key);
        if (known === null || known && !await bindHeldMemberIdentity(db, { identity: known, bodyId: id, state })) {
          rosterIdentityGaps.push(key);
          await openBlank(db.query, { entityId: id, field: `member-row:${key}`, stage: "CHECK", reason: "HELD_MEMBER_IDENTITY_AMBIGUOUS",
            detail: capture.evidence.canonicalUrl, retryMinutes: clocks.retryMinutes("officeholder") });
          continue;
        }
        if (known) shownMemberIds.set(key, known.id);
        accepted.push(row);
      }
      rosterRows = accepted;
    } catch {
      rosterRows = [];
      rosterIdentityGaps.push("HELD_MEMBER_IDENTITIES_UNREADABLE");
      await openBlank(db.query, { entityId: id, field: "member-identities", stage: "READ", reason: "HELD_MEMBER_IDENTITIES_UNREADABLE",
        detail: capture.evidence.canonicalUrl, retryMinutes: clocks.retryMinutes("officeholder") });
    }
  }
  const roster = subject.subjectKind === "body" && rosterRows.length ? await publishRosterFacts(db, {
    body: { id, name: subject.bodyName, state, parentId: subject.divisionIds[0] ?? null }, capture,
    complete: extracted.completeRoster && !rosterIdentityGaps.length, producedBy: "held-subject-digger", acquisition: "walker", purge: input.purge,
    shownMemberIds,
    members: rosterRows.map(row => ({ recordId: `held-roster:${fingerprint([id, nameKey(row.name), row.office])}`,
      fields: { ...row } })),
  }, clocks, now) : null;
  if (extracted.portraitImageUrl && subject.subjectKind === "official" && subject.personName && input.storePortrait) {
    let photo: OfficeholderPhoto | null = null;
    try {
      photo = await input.storePortrait(id, { subject: { personId: id, name: subject.personName, profileUrls: subject.profileUrls,
        ...(nativeId ? { nativeIds: { bioguide: [nativeId] } } : {}) }, imageUrl: extracted.portraitImageUrl, captures: [capture] },
      now.toISOString(), input.signal ?? new AbortController().signal);
    } catch (error) {
      await openBlank(db.query, { entityId: id, field: "portrait", stage: "CHECK", reason: "PORTRAIT_NOT_VERIFIED",
        detail: error instanceof Error ? error.message : String(error), retryMinutes: clocks.retryMinutes("portrait") });
    }
    if (photo) facts.push({ field: "portrait", outcome: await publishClaim(db, { entity, field: "portrait", fieldKind: "portrait",
      value: photo, valueText: extracted.portraitImageUrl, quote: extracted.portraitImageUrl, provenance, copy,
      producedBy: "held-subject-digger", acquisition: "walker", costUsd: 0 }, clocks, now, { purge: input.purge }) });
  }
  const membershipHeld = subject.subjectKind === "official" && subject.bodyId
    ? (await db.query(`SELECT 1 FROM fact WHERE entity_id=$1 AND field=$2 AND status='live' LIMIT 1`, [subject.bodyId, `member:${id}`])).length > 0 : false;
  const readerDependencies: { field: string; ownerChange: string }[] = [];
  let readerSupportedNewFacts = roster?.live ?? 0;
  for (const fact of facts) {
    if (!("decision" in fact.outcome) || !["PUBLISH", "CONFIRM"].includes(fact.outcome.decision)) continue;
    const ownerChange = heldFactReaderDependency(subject, fact.field, membershipHeld);
    if (ownerChange) readerDependencies.push({ field: fact.field, ownerChange });
    else if (fact.outcome.decision === "PUBLISH") readerSupportedNewFacts++;
  }
  return { facts, roster, portraitImageUrl: extracted.portraitImageUrl, refused: null, statementLinks: heldStatementLinks(subject, capture), rosterIdentityGaps,
    readerDependencies, readerSupportedNewFacts };
}
