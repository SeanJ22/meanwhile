/**
 * The behavior-event wire format shared by the browser batcher and
 * `/api/events`. Pure, so both import it. An event carries a type, id, time,
 * the ZIP and district viewed, how the reader arrived at that ZIP, the card
 * and for how long, and for a reaction or pick the choice. No name, no
 * address or typed question; Ask capture uses its own server path.
 */

export const CLIENT_EVENT_TYPES = [
  "ZIP_VIEW",
  "CARD_OPEN",
  "CARD_VISIBLE",
  "ACTIVE_SCROLL",
  "AGENDA_VIEW",
  "REACTION",
  "BALLOT_PICK",
] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const PICK_CHOICES = ["PICKED", "UNSURE", "BLANK"] as const;
export type PickChoice = (typeof PICK_CHOICES)[number];

export interface ClientEvent {
  /** Random, unique per event: lets the store drop a batch that is sent twice. */
  id: string;
  type: ClientEventType;
  /** The reader's clock when it happened, ISO 8601. The store keeps the exact time internally. */
  occurredAt: string;
  zip?: string;
  /** A division id (an OCD id) the event is about. */
  district?: string;
  /**
   * HOW the reader arrived at the ZIP (typed, tapped a demo chip, link, ...).
   * The endpoint turns this into the stamped residency relation; a client can
   * never assert a confidence of its own.
   */
  locationOrigin?: string;
  /** The exact card: `<kind>:<id>`, e.g. `MEETING:clerksboards:39:2026-07-27`. */
  cardId?: string;
  cardKind?: string;
  durationMs?: number;
  /** A reaction's value, tied to `cardId`. */
  reaction?: string;
  ballotPick?: { contestId: string; candidateIds: string[]; choice: PickChoice };
}

export interface EventBatch {
  /** Stable across retries of the same batch. */
  batchId: string;
  /** The returning-reader ID, RAW; the server digests it. */
  continuityKey: string;
  events: ClientEvent[];
  /** The synthetic-run declaration, so an automated run is never counted as a reader. */
  syntheticRun?: string;
}

export const MAX_EVENTS_PER_BATCH = 128;

const ID_SHAPE = /^[A-Za-z0-9_.:-]{8,80}$/;
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;
const ZIP_SHAPE = /^\d{5}$/;
/** The event store's identifier alphabet (`lib/db/reader-events.ts`): anything else it refuses, so refuse it here with a 400 instead of a retry loop. */
export const STORE_ID_SHAPE = /^[A-Za-z0-9/_.:#=+-]+$/;
/** Make a free-form label (a card title) storable. */
export function storeSafeId(value: string): string {
  return value.replace(/[^A-Za-z0-9/_.:#=+-]/g, "_");
}

function text(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || !STORE_ID_SHAPE.test(value)) return null;
  return value;
}

function readEvent(raw: unknown): ClientEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !ID_SHAPE.test(e.id)) return null;
  if (!CLIENT_EVENT_TYPES.includes(e.type as ClientEventType)) return null;
  if (typeof e.occurredAt !== "string" || !Number.isFinite(Date.parse(e.occurredAt))) return null;

  const event: ClientEvent = { id: e.id, type: e.type as ClientEventType, occurredAt: e.occurredAt };

  if (e.zip !== undefined) {
    if (typeof e.zip !== "string" || !ZIP_SHAPE.test(e.zip)) return null;
    event.zip = e.zip;
  }
  for (const key of ["district", "locationOrigin", "cardId", "cardKind", "reaction"] as const) {
    const value = text(e[key]);
    if (value === null) return null;
    if (value !== undefined) event[key] = value;
  }
  if (e.durationMs !== undefined) {
    if (typeof e.durationMs !== "number" || !Number.isFinite(e.durationMs) || e.durationMs < 0) {
      return null;
    }
    event.durationMs = Math.round(e.durationMs);
  }
  if (e.ballotPick !== undefined) {
    const pick = e.ballotPick as Record<string, unknown> | null;
    if (typeof pick !== "object" || pick === null) return null;
    const contestId = text(pick.contestId);
    if (typeof contestId !== "string") return null;
    if (!PICK_CHOICES.includes(pick.choice as PickChoice)) return null;
    if (!Array.isArray(pick.candidateIds)) return null;
    const candidateIds: string[] = [];
    for (const id of pick.candidateIds) {
      const value = text(id);
      if (typeof value !== "string") return null;
      candidateIds.push(value);
    }
    event.ballotPick = { contestId, candidateIds, choice: pick.choice as PickChoice };
  }
  return event;
}

/** A parsed batch, or null with nothing partially accepted: a malformed batch is refused whole. */
export function readEventBatch(raw: unknown): EventBatch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.batchId !== "string" || !ID_SHAPE.test(b.batchId)) return null;
  if (typeof b.continuityKey !== "string" || !KEY_SHAPE.test(b.continuityKey)) return null;
  if (!Array.isArray(b.events) || b.events.length === 0) return null;
  const events: ClientEvent[] = [];
  const seen = new Set<string>();
  for (const item of b.events) {
    const event = readEvent(item);
    if (event === null || seen.has(event.id)) return null;
    seen.add(event.id);
    events.push(event);
  }
  const batch: EventBatch = { batchId: b.batchId, continuityKey: b.continuityKey, events };
  if (typeof b.syntheticRun === "string") batch.syntheticRun = b.syntheticRun;
  return batch;
}
