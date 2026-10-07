#!/usr/bin/env tsx
/**
 * Standing official state-roll-call boundary.
 *
 * One invocation owns exactly one AZ/NH/NJ contract.  It never opens the
 * retired LegiScan snapshot and has no tracked-output mode.  Until a state's
 * complete official roll horizon and exact member-id join are implemented,
 * a successful official probe is durably refused as an unbounded horizon;
 * transport failures become durable source attempts.  Neither case can move
 * or clear that state's LKG.
 *
 * @freshness-reads-here — retrievedAt is minted only after the official
 * roll-call surface returned a non-empty body for the exact state contract.
 */

import {
  officialStateIdentityAuthorityEvidence,
  officialStateLegislatorVotesCandidate,
  officialStateLegislatorVotesSessionMarker,
  officialStateRollCallsCandidate,
  officialStateRollCallHorizonRefusalCandidate,
  sha256,
} from "../lib/civic-data/candidate-builders.ts";
import {
  processRegisteredFanOutCandidate,
  processRegisteredRoutineCandidate,
  type PromotionOutcome,
} from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { readPromotedCivicDataBatch } from "../lib/civic-data/read-model.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { routineReceiptFields } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  readPublisherBody,
  recordRegisteredSourceAcquisitionFailure,
  requestPublisher,
  sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import type { StateLegislatorVotePosition, StateLegislatorVotes, StateRollCall } from "../lib/sources/legiscan/types.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { runBoundedWorkPool } from "../lib/ops/bounded-work-pool.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import {
  buildNhOfficialRollCallProjection,
  decodeNhPublisherBytes,
  NH_LEGISLATORS_URL,
  NH_ROLL_HISTORY_URL,
  NH_ROLL_SUMMARY_URL,
  nhParticipantSourceVersion,
  parseNhLegislators,
  parseNhRollCallHistory,
  parseNhRollCallSummary,
  readNhOfficialDocumentsSerially,
  type NhOfficialDocument,
} from "../lib/sources/nh-general-court/official-data.ts";
import {
  buildNjOfficialRollCallProjection,
  currentNjVotingSessionYear,
  decodeNjVoteArchive,
  NJ_MEMBER_REQUEST_CONCURRENCY,
  NJ_VOTING_RECORDS_INDEX_URL,
  njMemberVotingRecordsUrl,
  njVoteArchiveDefinitions,
  parseNjMemberVotingRecord,
  parseNjVoteArchive,
  parseNjVotingRecordsIndex,
  validateNjMemberVotingRecordsFinalUrl,
  validateNjVoteArchiveFinalUrl,
  validateNjVotingRecordsIndexFinalUrl,
  type NjSessionParticipant,
  type NjVoteArchiveDefinition,
} from "../lib/sources/nj-legislature/rollcalls.ts";
import {
  officialStateRollCallTargetByState,
  type OfficialStateCode,
} from "../lib/state-rollcalls/authority.ts";

const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

const AZ_HORIZON_GAP =
  "The permitted official LegText landing surface does not establish one complete member-level House and Senate roll-call horizon. apps.azleg.gov is not used by this automated adapter.";

interface NjTextDocument {
  readonly kind: "MEMBER";
  readonly participant: NjSessionParticipant;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly body: string;
}

interface NjArchiveDocument {
  readonly kind: "ARCHIVE";
  readonly definition: NjVoteArchiveDefinition;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly httpStatus: number;
  readonly bytes: Uint8Array;
}

type NjDocument = NjTextDocument | NjArchiveDocument;

export interface StateRollCallArguments {
  readonly state: OfficialStateCode;
}

/** Exact registered CLI shape; no local fixture or tracked write is accepted. */
export function parseStateRollCallArguments(args: readonly string[]): StateRollCallArguments {
  if (args.filter((value) => value === "--promote").length !== 1) {
    throw new Error("STATE_ROLL_CALL_PROMOTION_REQUIRED");
  }
  const stateArgs = args.filter((value) => value.startsWith("--state="));
  const unknown = args.filter((value) => value !== "--promote" && !value.startsWith("--state="));
  if (stateArgs.length !== 1 || unknown.length > 0) {
    throw new Error("STATE_ROLL_CALL_EXACT_SCOPE_REQUIRED");
  }
  const target = officialStateRollCallTargetByState(stateArgs[0]!.slice("--state=".length));
  if (!target) throw new Error("STATE_ROLL_CALL_STATE_UNSUPPORTED");
  return { state: target.state };
}

/**
 * The single durable-write seam shared by every state's roll-call promotion. A
 * failure of our own durable write is returned as a source-neutral persistence
 * failure: no receipt, the prior canonical pointer untouched, exit 2.
 */
export type StateRollCallPersistResult =
  | { readonly kind: "PERSISTED"; readonly outcome: PromotionOutcome }
  | { readonly kind: "WRITE_FAILED"; readonly diagnostic: string };

/** An honest, source-neutral account of a failure to durably persist an
 *  already-acquired candidate. It names our gap and never blames the source. */
export function durableWriteFailureDiagnostic(contractId: string, error: unknown): string {
  const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    `state-rollcalls ${contractId}: DURABLE_PERSISTENCE_FAILED — the source was acquired, but the durable ` +
    `civic-data record could not be persisted (${cause}). This is a failure on our side, not source ` +
    `unavailability; no candidate was written and the prior canonical pointer is unchanged. Emitting no ` +
    `receipt and exiting 2 rather than crashing.`
  );
}

async function persistWithDurableResilience(
  contractId: string,
  promote: () => Promise<PromotionOutcome>,
): Promise<StateRollCallPersistResult> {
  try {
    return { kind: "PERSISTED", outcome: await promote() };
  } catch (error) {
    // A source-acquisition failure is the caller's to record; re-thrown rather than reclassified here.
    if (isSourceAcquisitionFailure(error)) throw error;
    return { kind: "WRITE_FAILED", diagnostic: durableWriteFailureDiagnostic(contractId, error) };
  }
}

export async function persistAcquiredStateRollCall(
  store: RoutineDataStore,
  contractId: string,
  candidate: RoutineCandidate,
  retrievedAt: string,
): Promise<StateRollCallPersistResult> {
  return persistWithDurableResilience(contractId, () =>
    processRegisteredRoutineCandidate(store, contractId, candidate, retrievedAt, undefined, { confirmUnchanged: true }));
}

/**
 * Persist one candidate of a per-legislator fan-out with the same resilience: a
 * source acquisition error propagates; a durable write failure becomes a diagnostic.
 */
async function persistFanOutStateRollCall(
  store: RoutineDataStore,
  contractId: string,
  candidate: RoutineCandidate,
  retrievedAt: string,
): Promise<StateRollCallPersistResult> {
  return persistWithDurableResilience(contractId, () =>
    processRegisteredFanOutCandidate(store, contractId, candidate, retrievedAt));
}

async function main(): Promise<void> {
  const { state } = parseStateRollCallArguments(process.argv.slice(2));
  const target = officialStateRollCallTargetByState(state);
  if (!target) throw new Error(`STATE_ROLL_CALL_TARGET_MISSING:${state}`);

  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();

  if (state === "NH") {
    let documents: readonly NhOfficialDocument[];
    let projection: ReturnType<typeof buildNhOfficialRollCallProjection>;
    let retrievedAt: string;
    try {
      documents = await withPublisherAcquisitionDeadline(
        "New Hampshire General Court complete roll-call horizon",
        ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
        async (signal) => readNhOfficialDocumentsSerially(
          [NH_ROLL_SUMMARY_URL, NH_ROLL_HISTORY_URL, NH_LEGISLATORS_URL],
          async (url): Promise<NhOfficialDocument> => {
            const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
            const result = await requestPublisher(
              "New Hampshire General Court complete roll-call horizon",
              () => fetch(url, {
                headers: { "user-agent": UA, accept: "text/plain,*/*" },
                redirect: "follow",
                signal: requestSignal,
              }),
            );
            if (!result.ok) {
              throw sourceAcquisitionFailure(
                "PUBLISHER_RESPONSE_REFUSED",
                `New Hampshire General Court export ${url} answered HTTP ${result.status}.`,
              );
            }
            const bytes = await readPublisherBody(
              "New Hampshire General Court complete roll-call horizon",
              () => result.arrayBuffer(),
            );
            requestSignal.throwIfAborted();
            return {
              requestedUrl: url,
              finalUrl: result.url || url,
              httpStatus: result.status,
              body: decodeNhPublisherBytes(bytes),
            };
          },
          { signal },
        ),
      );
      // @freshness-reads-here — the clock is minted only after all three
      // serial publisher reads settled with complete non-empty bytes.
      retrievedAt = new Date().toISOString();
      projection = buildNhOfficialRollCallProjection({
        summaries: parseNhRollCallSummary(documents[0]!.body),
        history: parseNhRollCallHistory(documents[1]!.body),
        legislators: parseNhLegislators(documents[2]!.body),
        retrievedAt,
        participantSourceVersion: nhParticipantSourceVersion(documents[1]!.body),
      });
    } catch (error) {
      if (!isSourceAcquisitionFailure(error)) throw error;
      const failed = await recordRegisteredSourceAcquisitionFailure({
        store,
        contractId: target.contractId,
        failure: error,
        requestedUrl: NH_ROLL_SUMMARY_URL,
      });
      console.log(failed.line);
      process.exitCode = 2;
      return;
    }

    const rosterPointer = await store.readPromotion("STATE_LEGISLATOR", target.jurisdiction);
    const pointerPayload = rosterPointer?.payload as {
      readonly identities?: readonly { readonly officeholderId?: unknown }[];
    } | undefined;
    const currentOfficeholderIds = Array.isArray(pointerPayload?.identities) &&
        pointerPayload.identities.every((row) => typeof row.officeholderId === "string")
      ? pointerPayload.identities.map((row) => row.officeholderId as string)
      : [];
    // The chamber's roster authority, reduced once to its digest so every candidate cites identical authority.
    const identityAuthority = officialStateIdentityAuthorityEvidence({
      sourceId: target.sourceId,
      jurisdiction: target.jurisdiction,
      term: "2026",
      session: "regular",
      identityAuthority: {
        contractId: "nh-members",
        versionId: rosterPointer?.versionId ?? "missing-canonical-nh-members-pointer",
        currentOfficeholderIds,
        sessionParticipantIds: projection.participantIds,
        sessionParticipantSourceVersion: projection.participantSourceVersion,
        sessionParticipantAudit: projection.participantAudit,
      },
    });

    // One bounded record per member (the whole matrix in one statement is too large); roll date is joined
    // from the roll index, and every other roll field stays in the per-state roll index.
    const httpStatus = documents.every((document) => document.httpStatus === 200) ? 200 : 0;
    const rollById = new Map(projection.rolls.map((roll) => [roll.id, roll] as const));
    const positionsByMember = new Map<string, StateLegislatorVotePosition[]>();
    const chamberByMember = new Map<string, StateRollCall["chamber"] | null>();
    for (const position of projection.positions) {
      const roll = rollById.get(position.rollCallId);
      const positions = positionsByMember.get(position.officeholderId) ?? [];
      positions.push({ rollCallId: position.rollCallId, position: position.position, date: roll?.date ?? retrievedAt.slice(0, 10) });
      positionsByMember.set(position.officeholderId, positions);
      if (!chamberByMember.has(position.officeholderId)) {
        chamberByMember.set(position.officeholderId, roll?.chamber ?? null);
      }
    }

    // Sorted per-member entries; each member's record is scoped to its own
    // source-namespaced officeholder id.
    const memberEntries = [...positionsByMember.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([officeholderId, positions]) => ({
        officeholderId,
        chamber: chamberByMember.get(officeholderId) ?? null,
        positions: [...positions].sort((left, right) => left.rollCallId.localeCompare(right.rollCallId)),
      }));

    // One batched read of every member's current promotion; an unchanged member is skipped
    // (candidateId folds in retrievedAt, so re-promoting would mint a fresh version each cycle).
    const currentByScope = new Map(
      (await readPromotedCivicDataBatch<StateLegislatorVotes>(
        "STATE_LEGISLATOR_VOTES",
        memberEntries.map(({ officeholderId }) => officeholderId),
        { store, now: retrievedAt, bypassCache: true },
      )).map((result, index) => [memberEntries[index]!.officeholderId, result] as const),
    );
    const positionsFingerprint = (positions: readonly StateLegislatorVotePosition[]): string =>
      positions.map((position) => `${position.rollCallId}\u0000${position.position}\u0000${position.date}`).join("");

    const throughRoll = [...projection.rolls].sort((left, right) => left.date.localeCompare(right.date)).at(-1) ?? null;
    const marker = officialStateLegislatorVotesSessionMarker({
      sourceId: target.sourceId,
      jurisdiction: target.jurisdiction,
      term: "2026",
      session: "regular",
      requestedUrl: NH_ROLL_SUMMARY_URL,
      finalUrl: documents[0]!.finalUrl,
      httpStatus,
      retrievedAt,
      throughRollId: throughRoll?.id ?? null,
      throughDate: throughRoll?.date ?? null,
      rollCount: projection.rolls.length,
      legislatorCount: positionsByMember.size,
      positionCount: projection.positions.length,
      sourceDocumentsSha256: sha256(documents.map((document) => sha256(document.body)).join("\n")),
      identityAuthority,
    });

    // Promote only changed members, then advance the per-state marker last, so a part-way failure
    // leaves the watermark unmoved and the next cycle re-promotes only what did not land.
    let promotedMembers = 0;
    let unchangedMembers = 0;
    for (const { officeholderId, chamber, positions } of memberEntries) {
      const current = currentByScope.get(officeholderId);
      if (current?.kind === "PROMOTED" && positionsFingerprint(current.value.positions) === positionsFingerprint(positions)) {
        unchangedMembers += 1;
        continue;
      }
      const memberCandidate = officialStateLegislatorVotesCandidate({
        sourceId: target.sourceId,
        jurisdiction: target.jurisdiction,
        officeholderId,
        chamber,
        term: "2026",
        session: "regular",
        positions,
        requestedUrl: NH_ROLL_SUMMARY_URL,
        finalUrl: documents[0]!.finalUrl,
        httpStatus,
        retrievedAt,
        identityAuthority,
      });
      const persistedMember = await persistFanOutStateRollCall(store, target.contractId, memberCandidate, retrievedAt);
      if (persistedMember.kind === "WRITE_FAILED") {
        console.error(persistedMember.diagnostic);
        process.exitCode = 2;
        return;
      }
      if (persistedMember.outcome.promoted) promotedMembers += 1;
      else unchangedMembers += 1;
    }

    const persistedMarker = await persistFanOutStateRollCall(store, target.contractId, marker, retrievedAt);
    if (persistedMarker.kind === "WRITE_FAILED") {
      console.error(persistedMarker.diagnostic);
      process.exitCode = 2;
      return;
    }
    const outcome = persistedMarker.outcome;
    console.log("RCD_RECEIPT=" + JSON.stringify({
      source: target.contractId,
      candidateId: marker.id,
      acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
      state: outcome.candidate.state,
      decision: outcome.candidate.receipt?.decision ?? null,
      promotedVersion: outcome.promoted?.versionId ?? null,
      lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
      fanOut: { members: memberEntries.length, promoted: promotedMembers, unchanged: unchangedMembers },
      structuralReleaseContract: ZERO_RELEASE_EVENTS,
    }));
    if (!outcome.promoted && promotedMembers === 0) process.exitCode = 2;
    return;
  }

  if (state === "NJ") {
    let acquired: {
      readonly indexBody: string;
      readonly memberBodies: readonly string[];
      readonly archiveBodies: readonly string[];
      readonly indexFinalUrl: string;
      readonly retrievedAt: string;
      readonly projection: ReturnType<typeof buildNjOfficialRollCallProjection>;
    };
    try {
      acquired = await withPublisherAcquisitionDeadline(
        "New Jersey Legislature complete voting-record horizon",
        ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
        async (signal) => {
          const indexSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
          const indexResponse = await requestPublisher(
            "New Jersey Legislature voting-record session index",
            () => fetch(NJ_VOTING_RECORDS_INDEX_URL, {
              headers: { "user-agent": UA, accept: "application/json" },
              redirect: "follow",
              signal: indexSignal,
            }),
          );
          if (indexResponse.status !== 200) {
            throw sourceAcquisitionFailure(
              "PUBLISHER_RESPONSE_REFUSED",
              `New Jersey Legislature voting-record session index answered HTTP ${indexResponse.status}.`,
            );
          }
          const indexBody = await readPublisherBody(
            "New Jersey Legislature voting-record session index",
            () => indexResponse.text(),
          );
          indexSignal.throwIfAborted();
          const indexFinalUrl = validateNjVotingRecordsIndexFinalUrl(indexResponse.url || NJ_VOTING_RECORDS_INDEX_URL);
          const sessionYear = currentNjVotingSessionYear(new Date().toISOString());
          const index = parseNjVotingRecordsIndex(indexBody, sessionYear);
          const requests: readonly (
            | { readonly kind: "MEMBER"; readonly participant: NjSessionParticipant; readonly url: string }
            | { readonly kind: "ARCHIVE"; readonly definition: NjVoteArchiveDefinition; readonly url: string }
          )[] = [
            ...index.participants.map((participant) => ({
              kind: "MEMBER" as const,
              participant,
              url: njMemberVotingRecordsUrl(sessionYear, participant.rosterKey),
            })),
            ...njVoteArchiveDefinitions(sessionYear).map((definition) => ({
              kind: "ARCHIVE" as const,
              definition,
              url: definition.url,
            })),
          ];
          const settled = await runBoundedWorkPool(
            requests,
            NJ_MEMBER_REQUEST_CONCURRENCY,
            async (request): Promise<
              | { readonly ok: true; readonly document: NjDocument }
              | { readonly ok: false; readonly error: unknown }
            > => {
              try {
                const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
                const response = await requestPublisher(
                  `New Jersey Legislature ${request.kind === "MEMBER" ? `member ${request.participant.rosterKey}` : request.definition.kind}`,
                  () => fetch(request.url, {
                    headers: {
                      "user-agent": UA,
                      // pub.njleg.gov 406s an Accept naming only zip/octet-stream; a trailing */* gets the archive.
                      accept: request.kind === "MEMBER" ? "application/json" : "application/zip,application/octet-stream,*/*",
                    },
                    redirect: "follow",
                    signal: requestSignal,
                  }),
                );
                if (response.status !== 200) {
                  throw sourceAcquisitionFailure(
                    "PUBLISHER_RESPONSE_REFUSED",
                    `New Jersey Legislature ${request.url} answered HTTP ${response.status}.`,
                  );
                }
                if (request.kind === "MEMBER") {
                  const body = await readPublisherBody(
                    `New Jersey Legislature member ${request.participant.rosterKey}`,
                    () => response.text(),
                  );
                  requestSignal.throwIfAborted();
                  const finalUrl = validateNjMemberVotingRecordsFinalUrl(
                    response.url || request.url,
                    sessionYear,
                    request.participant.rosterKey,
                  );
                  return {
                    ok: true,
                    document: {
                      kind: "MEMBER",
                      participant: request.participant,
                      requestedUrl: request.url,
                      finalUrl,
                      httpStatus: response.status,
                      body,
                    },
                  };
                }
                const bytes = new Uint8Array(await readPublisherBody(
                  `New Jersey Legislature ${request.definition.kind} archive`,
                  () => response.arrayBuffer(),
                ));
                requestSignal.throwIfAborted();
                const finalUrl = validateNjVoteArchiveFinalUrl(response.url || request.url, request.definition);
                return {
                  ok: true,
                  document: {
                    kind: "ARCHIVE",
                    definition: request.definition,
                    requestedUrl: request.url,
                    finalUrl,
                    httpStatus: response.status,
                    bytes,
                  },
                };
              } catch (error) {
                return { ok: false, error };
              }
            },
          );
          const poolFailure = settled.find((result) => !result.ok);
          if (poolFailure && !poolFailure.ok) {
            throw new Error(`NJ_DOCUMENT_POOL_BROKEN:${poolFailure.error}`);
          }
          const failedDocument = settled
            .map((result) => result.ok ? result.value : null)
            .find((result) => result?.ok === false);
          if (failedDocument && !failedDocument.ok) throw failedDocument.error;
          const documents = settled.map((result) => {
            if (!result.ok || !result.value.ok) throw new Error("NJ_DOCUMENT_POOL_RESULT_MISSING");
            return result.value.document;
          });
          const memberDocuments = documents.filter((document): document is NjTextDocument => document.kind === "MEMBER");
          const archiveDocuments = documents.filter((document): document is NjArchiveDocument => document.kind === "ARCHIVE");
          const memberBodies = memberDocuments.map(({ body }) => body);
          const archiveBodies = archiveDocuments.map(({ bytes, definition }) => decodeNjVoteArchive(bytes, definition.entryName));
          const retrievedAt = new Date().toISOString();
          if (currentNjVotingSessionYear(retrievedAt) !== sessionYear) {
            throw sourceAcquisitionFailure(
              "PUBLISHER_DOCUMENT_INVALID",
              "New Jersey Legislature session boundary changed during one acquisition; no mixed-term candidate was emitted.",
            );
          }
          const projection = buildNjOfficialRollCallProjection({
            index,
            memberRecords: memberDocuments.map(({ participant, body }) => parseNjMemberVotingRecord(body, participant, sessionYear)),
            archives: archiveDocuments.map(({ definition }, archiveIndex) => parseNjVoteArchive(archiveBodies[archiveIndex]!, definition, sessionYear)),
            retrievedAt,
          });
          return { indexBody, memberBodies, archiveBodies, indexFinalUrl, retrievedAt, projection };
        },
      );
    } catch (error) {
      if (!isSourceAcquisitionFailure(error)) throw error;
      const failed = await recordRegisteredSourceAcquisitionFailure({
        store,
        contractId: target.contractId,
        failure: error,
        requestedUrl: NJ_VOTING_RECORDS_INDEX_URL,
      });
      console.log(failed.line);
      process.exitCode = 2;
      return;
    }

    const rosterPointer = await store.readPromotion("STATE_LEGISLATOR", target.jurisdiction);
    const pointerPayload = rosterPointer?.payload as {
      readonly roster?: { readonly officeholders?: readonly { readonly id?: unknown }[] };
    } | undefined;
    const currentOfficeholderIds = Array.isArray(pointerPayload?.roster?.officeholders) &&
        pointerPayload.roster.officeholders.every((row) => typeof row.id === "string")
      ? pointerPayload.roster.officeholders.map((row) => row.id as string)
      : [];
    const sessionYear = acquired.projection.rolls[0]!.term.slice(0, 4);
    const candidate = officialStateRollCallsCandidate({
      sourceId: target.sourceId,
      jurisdiction: target.jurisdiction,
      rawBodies: [acquired.indexBody, ...acquired.memberBodies, ...acquired.archiveBodies],
      requestedUrl: NJ_VOTING_RECORDS_INDEX_URL,
      finalUrl: acquired.indexFinalUrl,
      httpStatus: 200,
      retrievedAt: acquired.retrievedAt,
      term: acquired.projection.rolls[0]!.term,
      expectedTerm: `${sessionYear}-${Number(sessionYear) + 1}`,
      session: acquired.projection.rolls[0]!.session,
      rolls: acquired.projection.rolls,
      positions: acquired.projection.positions,
      declaredRollTotal: acquired.projection.rolls.length,
      horizonAudit: {
        authorityMode: "API_ARCHIVE_EXACT_RECONCILIATION",
        ...acquired.projection.sourceAudit,
      },
      identityAuthority: {
        contractId: "nj-state-legislators",
        versionId: rosterPointer?.versionId ?? "missing-canonical-nj-state-legislators-pointer",
        currentOfficeholderIds,
        sessionParticipantIds: acquired.projection.participantIds,
        sessionParticipantSourceVersion: acquired.projection.participantSourceVersion,
      },
    });
    const persisted = await persistAcquiredStateRollCall(store, target.contractId, candidate, acquired.retrievedAt);
    if (persisted.kind === "WRITE_FAILED") {
      console.error(persisted.diagnostic);
      process.exitCode = 2;
      return;
    }
    const outcome = persisted.outcome;
    console.log("RCD_RECEIPT=" + JSON.stringify({
      source: target.contractId,
      ...routineReceiptFields(candidate, outcome),
      structuralReleaseContract: ZERO_RELEASE_EVENTS,
    }));
    if (!outcome.promoted) process.exitCode = 2;
    return;
  }

  let response: Response;
  let body: string;
  try {
    const acquired = await withPublisherAcquisitionDeadline(
      `${target.publisher} roll-call horizon`,
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      async (signal) => {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
        const result = await requestPublisher(
          `${target.publisher} roll-call horizon`,
          () => fetch(target.probeUrl, {
            headers: { "user-agent": UA, accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
            redirect: "follow",
            signal: requestSignal,
          }),
        );
        if (!result.ok) {
          throw sourceAcquisitionFailure(
            "PUBLISHER_RESPONSE_REFUSED",
            `${target.publisher} roll-call horizon answered HTTP ${result.status}.`,
          );
        }
        const raw = await readPublisherBody(
          `${target.publisher} roll-call horizon`,
          () => result.text(),
        );
        requestSignal.throwIfAborted();
        if (raw.trim() === "") {
          throw sourceAcquisitionFailure(
            "PUBLISHER_DOCUMENT_INVALID",
            `${target.publisher} roll-call horizon returned an empty document.`,
          );
        }
        return { response: result, body: raw };
      },
    );
    response = acquired.response;
    body = acquired.body;
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: target.contractId,
      failure: error,
      requestedUrl: target.probeUrl,
    });
    console.log(failed.line);
    process.exitCode = 2;
    return;
  }

  const retrievedAt = new Date().toISOString();
  const candidate = officialStateRollCallHorizonRefusalCandidate({
    sourceId: target.sourceId,
    jurisdiction: target.jurisdiction,
    requestedUrl: target.probeUrl,
    finalUrl: response.url || target.probeUrl,
    httpStatus: response.status,
    retrievedAt,
    rawBody: body,
    detail: AZ_HORIZON_GAP,
  });
  const persisted = await persistAcquiredStateRollCall(store, target.contractId, candidate, retrievedAt);
  if (persisted.kind === "WRITE_FAILED") {
    console.error(persisted.diagnostic);
    process.exitCode = 2;
    return;
  }
  const outcome = persisted.outcome;
  if (outcome.promoted || outcome.candidate.state !== "HORIZON_UNRESOLVED") {
    throw new Error(
      `STATE_ROLL_CALL_HORIZON_REFUSAL_BROKEN:${target.contractId}:${outcome.candidate.state}`,
    );
  }
  console.log("RCD_RECEIPT=" + JSON.stringify({
    source: target.contractId,
    candidateId: candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
  process.exitCode = 2;
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/state-rollcalls.mts");
if (invokedDirectly) {
  // Last-resort backstop: anything unexpected exits 2 with an honest line, never a bare Node stack.
  await main().catch((error) => {
    console.error(
      `state-rollcalls: unexpected error; exiting 2 without an uncaught crash — ` +
        `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
    process.exitCode = 2;
  });
}
