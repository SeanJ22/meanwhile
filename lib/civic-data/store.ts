import { and, eq } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import { civicDataCandidateEvents, civicDataCandidates, civicDataPromotions } from "../db/schema.ts";
import type {
  CandidateEvent,
  CandidateState,
  CandidateVersionRecord,
  PromotedProjection,
  RoutineCandidate,
  RoutineRecordClass,
  ValidationReceipt,
} from "./types.ts";

export function projectionKey(recordClass: RoutineRecordClass, scope: string): string {
  return `${recordClass}:${scope}`;
}

export interface RoutineDataStore {
  readonly create: (record: CandidateVersionRecord, firstEvent: CandidateEvent) => Promise<void>;
  readonly transition: (
    candidateId: string,
    state: CandidateState,
    at: string,
    detail: string,
    receipt?: ValidationReceipt,
    failure?: { code: string; detail: string },
  ) => Promise<CandidateVersionRecord>;
  readonly readCandidate: (candidateId: string) => Promise<CandidateVersionRecord | null>;
  readonly readPromotion: <T = unknown>(recordClass: RoutineRecordClass, scope: string) => Promise<PromotedProjection<T> | null>;
  readonly promote: (candidateId: string, receipt: ValidationReceipt, at: string) => Promise<PromotedProjection>;
  readonly events: (candidateId: string) => Promise<readonly CandidateEvent[]>;
}

/** Deterministic store used by destructive/failure tests. */
export class MemoryRoutineDataStore implements RoutineDataStore {
  private readonly candidates = new Map<string, CandidateVersionRecord>();
  private readonly history = new Map<string, CandidateEvent[]>();
  private readonly promotions = new Map<string, PromotedProjection>();

  async create(record: CandidateVersionRecord, firstEvent: CandidateEvent): Promise<void> {
    if (this.candidates.has(record.candidate.id)) throw new Error(`CANDIDATE_ALREADY_EXISTS:${record.candidate.id}`);
    this.candidates.set(record.candidate.id, structuredClone(record));
    this.history.set(record.candidate.id, [structuredClone(firstEvent)]);
  }

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }): Promise<CandidateVersionRecord> {
    const prior = this.candidates.get(candidateId);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const history = this.history.get(candidateId) ?? [];
    const next: CandidateVersionRecord = {
      ...prior,
      state,
      receipt: receipt ?? prior.receipt,
      failureCode: failure?.code ?? prior.failureCode,
      failureDetail: failure?.detail ?? prior.failureDetail,
    };
    this.candidates.set(candidateId, structuredClone(next));
    history.push({ candidateId, sequence: history.length + 1, state, at, detail });
    this.history.set(candidateId, history);
    return structuredClone(next);
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const row = this.candidates.get(candidateId);
    return row ? structuredClone(row) : null;
  }

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const row = this.promotions.get(projectionKey(recordClass, scope));
    return row ? structuredClone(row) as PromotedProjection<T> : null;
  }

  async promote(candidateId: string, receipt: ValidationReceipt, at: string): Promise<PromotedProjection> {
    const record = this.candidates.get(candidateId);
    if (!record || record.state !== "VALIDATED" || receipt.decision !== "GOOD") {
      throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    }
    const key = projectionKey(record.candidate.recordClass, record.candidate.scope);
    const previous = this.promotions.get(key);
    const projection: PromotedProjection = {
      key,
      sourceId: record.candidate.sourceId,
      recordClass: record.candidate.recordClass,
      scope: record.candidate.scope,
      versionId: candidateId,
      lastKnownGoodVersionId: candidateId,
      promotedAt: at,
      payload: structuredClone(record.candidate.readModel),
      receipt: structuredClone(receipt),
    };
    this.promotions.set(key, projection);
    const history = this.history.get(candidateId) ?? [];
    history.push({ candidateId, sequence: history.length + 1, state: "PROMOTED", at, detail: `Atomic pointer ${key} moved from ${previous?.versionId ?? "bootstrap/no-version"} to ${candidateId}.` });
    this.history.set(candidateId, history);
    this.candidates.set(candidateId, {
      ...record,
      state: "PROMOTED",
      receipt,
      promotedVersion: candidateId,
      lastKnownGoodVersion: candidateId,
    });
    return structuredClone(projection);
  }

  async events(candidateId: string): Promise<readonly CandidateEvent[]> {
    return structuredClone(this.history.get(candidateId) ?? []);
  }
}

function rowToCandidate(row: typeof civicDataCandidates.$inferSelect): CandidateVersionRecord {
  return {
    candidate: row.candidate as RoutineCandidate,
    state: row.state as CandidateState,
    acquisitionSucceeded: row.acquisitionSucceeded,
    receipt: row.validationReceipt as ValidationReceipt | null,
    promotedVersion: row.promotedVersionId,
    lastKnownGoodVersion: row.lastKnownGoodVersionId,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  };
}

/** Production store: append-only events plus one atomic canonical projection. */
export class PostgresRoutineDataStore implements RoutineDataStore {
  private readonly db = getDb();

  async create(record: CandidateVersionRecord, firstEvent: CandidateEvent): Promise<void> {
    await this.db.batch([
      this.db.insert(civicDataCandidates).values({
        id: record.candidate.id,
        sourceId: record.candidate.sourceId,
        recordClass: record.candidate.recordClass,
        scope: record.candidate.scope,
        state: record.state,
        acquisitionSucceeded: record.acquisitionSucceeded,
        rawHash: record.candidate.retrieval.rawHash,
        normalizedHash: record.candidate.normalization.normalizedHash,
        retrievedAt: record.candidate.retrieval.retrievedAt,
        sourceThrough: record.candidate.temporal.sourceThrough,
        parserVersion: record.candidate.normalization.parserVersion,
        identity: record.candidate.identities,
        candidate: record.candidate,
        validationReceipt: record.receipt,
        promotedVersionId: record.promotedVersion,
        lastKnownGoodVersionId: record.lastKnownGoodVersion,
        failureCode: record.failureCode,
        failureDetail: record.failureDetail,
      }),
      this.db.insert(civicDataCandidateEvents).values(firstEvent),
    ]);
  }

  async transition(candidateId: string, state: CandidateState, at: string, detail: string, receipt?: ValidationReceipt, failure?: { code: string; detail: string }): Promise<CandidateVersionRecord> {
    const [prior] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    if (!prior) throw new Error(`CANDIDATE_NOT_FOUND:${candidateId}`);
    const eventRows = await this.db.select({ sequence: civicDataCandidateEvents.sequence }).from(civicDataCandidateEvents).where(eq(civicDataCandidateEvents.candidateId, candidateId));
    const [updatedRows] = await this.db.batch([
      this.db.update(civicDataCandidates).set({
        state,
        ...(receipt ? { validationReceipt: receipt } : {}),
        ...(failure ? { failureCode: failure.code, failureDetail: failure.detail } : {}),
      }).where(eq(civicDataCandidates.id, candidateId)).returning(),
      this.db.insert(civicDataCandidateEvents).values({ candidateId, sequence: eventRows.length + 1, state, at, detail }),
    ]);
    return rowToCandidate(updatedRows[0]);
  }

  async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
    const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    return row ? rowToCandidate(row) : null;
  }

  async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
    const [row] = await this.db.select().from(civicDataPromotions).where(and(eq(civicDataPromotions.recordClass, recordClass), eq(civicDataPromotions.scope, scope))).limit(1);
    if (!row) return null;
    return {
      key: row.key,
      sourceId: row.sourceId,
      recordClass: row.recordClass as RoutineRecordClass,
      scope: row.scope,
      versionId: row.currentVersionId,
      lastKnownGoodVersionId: row.lastKnownGoodVersionId,
      promotedAt: row.promotedAt,
      payload: row.payload as T,
      receipt: row.validationReceipt as ValidationReceipt,
    };
  }

  async promote(candidateId: string, receipt: ValidationReceipt, at: string): Promise<PromotedProjection> {
    const [row] = await this.db.select().from(civicDataCandidates).where(eq(civicDataCandidates.id, candidateId)).limit(1);
    if (!row || row.state !== "VALIDATED" || receipt.decision !== "GOOD") throw new Error(`CANDIDATE_NOT_PROMOTABLE:${candidateId}`);
    const candidate = row.candidate as RoutineCandidate;
    const key = projectionKey(candidate.recordClass, candidate.scope);
    const [prior] = await this.db.select().from(civicDataPromotions).where(eq(civicDataPromotions.key, key)).limit(1);
    await this.db.batch([
      this.db.insert(civicDataPromotions).values({
        key,
        sourceId: candidate.sourceId,
        recordClass: candidate.recordClass,
        scope: candidate.scope,
        currentVersionId: candidateId,
        lastKnownGoodVersionId: candidateId,
        promotedAt: at,
        payload: candidate.readModel,
        validationReceipt: receipt,
      }).onConflictDoUpdate({
        target: civicDataPromotions.key,
        set: {
          sourceId: candidate.sourceId,
          currentVersionId: candidateId,
          lastKnownGoodVersionId: candidateId,
          promotedAt: at,
          payload: candidate.readModel,
          validationReceipt: receipt,
        },
      }),
      this.db.insert(civicDataCandidateEvents).values({ candidateId, sequence: 4, state: "PROMOTED", at, detail: `Atomic pointer ${key} moved from ${prior?.currentVersionId ?? "bootstrap/no-version"} to ${candidateId}.` }),
      this.db.update(civicDataCandidates).set({ state: "PROMOTED", validationReceipt: receipt, promotedVersionId: candidateId, lastKnownGoodVersionId: candidateId }).where(eq(civicDataCandidates.id, candidateId)),
    ]);
    return {
      key,
      sourceId: candidate.sourceId,
      recordClass: candidate.recordClass,
      scope: candidate.scope,
      versionId: candidateId,
      lastKnownGoodVersionId: candidateId,
      promotedAt: at,
      payload: candidate.readModel,
      receipt,
    };
  }

  async events(candidateId: string): Promise<readonly CandidateEvent[]> {
    const rows = await this.db.select().from(civicDataCandidateEvents).where(eq(civicDataCandidateEvents.candidateId, candidateId));
    return rows.sort((a, b) => a.sequence - b.sequence).map((row) => ({ candidateId: row.candidateId, sequence: row.sequence, state: row.state as CandidateState, at: row.at, detail: row.detail }));
  }
}
