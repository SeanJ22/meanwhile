import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

/**
 * **admin-v6/sends@1 — THE INSTRUCTIONS YOU SENT THE FLEET, AND WHICH ARE STILL RUNNING.**
 *
 * A "Deploy fleet here" instruction (DISPATCH) keeps being carried by the runner
 * while it still has requirements to create, so one click can keep working for
 * many rounds. This lists each recent instruction with where it stands, so any
 * one can be taken back (CANCEL_DISPATCH). Read from three bounded statements:
 * the recent DISPATCH and CANCEL_DISPATCH intents, the runner's own HONORED
 * records for them, and the targets the last cycle carried. "Cancelled" is shown
 * only once the runner has recorded it; before that it is a request.
 */
export const ADMIN_V6_SENDS_CONTRACT = "admin-v6/sends@1" as const;
export const SENDS_LIMIT = 20;

export type SendState = "waiting" | "carried" | "finished" | "cancel-requested" | "cancelled";
export interface SendIntentRaw { readonly intentId: string; readonly action: "DISPATCH" | "CANCEL_DISPATCH"; readonly note: string | null; readonly requestedAt: string }
export interface SendHonoredRaw { readonly honors: string; readonly honoredAt: string; readonly detail: string }
export interface SendCarriedRaw { readonly ref: string; readonly deferred: number; readonly created: number }

/** Structurally `SentInstruction` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6Send {
  readonly id: string;
  readonly words: string;
  readonly sentAt: string;
  readonly state: SendState;
  readonly stateWords: string;
  /** What the runner recorded when it read it, in its own words. */
  readonly ranAs: string | null;
  readonly canCancel: boolean;
}

export function sendViews(input: {
  readonly intents: readonly SendIntentRaw[]; readonly honored: readonly SendHonoredRaw[]; readonly carried: readonly SendCarriedRaw[];
}): readonly AdminV6Send[] {
  const honored = new Map(input.honored.map((h) => [h.honors, h]));
  const carried = new Map(input.carried.map((c) => [c.ref, c]));
  const cancelOf = new Map(input.intents.filter((i) => i.action === "CANCEL_DISPATCH" && i.note).map((i) => [i.note as string, i]));
  return input.intents.filter((i) => i.action === "DISPATCH").sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1)).map((i): AdminV6Send => {
    const cancel = cancelOf.get(i.intentId);
    const cancelDone = cancel ? honored.get(cancel.intentId) : undefined;
    const read = honored.get(i.intentId);
    const c = carried.get(i.intentId);
    const state: SendState = cancelDone ? "cancelled" : cancel ? "cancel-requested" : c ? "carried" : read ? "finished" : "waiting";
    const stateWords = state === "cancelled" ? "Taken back. The runner stopped carrying it."
      : state === "cancel-requested" ? "Taking it back: waiting for the runner to record it."
      : state === "carried" ? `Still running: ${c!.deferred.toLocaleString("en-US")} requirement${c!.deferred === 1 ? "" : "s"} left to create, ${c!.created.toLocaleString("en-US")} created so far.`
      : state === "finished" ? "Finished. The runner read it and has nothing left to create for it."
      : "Waiting for the runner’s next round to read it.";
    return { id: i.intentId, words: i.note ?? "", sentAt: i.requestedAt, state, stateWords, ranAs: read?.detail ?? null, canCancel: state === "waiting" || state === "carried" };
  }).slice(0, SENDS_LIMIT);
}

export async function readSends(sql: Sql): Promise<readonly AdminV6Send[]> {
  const op = (operation: string) => ({ operation, callClass: "PAGE" as const });
  const intentRows = await boundedQuery(sql, op("cp_log_research_intents.recent_sends"),
    `SELECT record->>'intentId' AS intent_id, record->>'action' AS action, left(record->>'note', 280) AS note, record->>'requestedAt' AS requested_at
     FROM cp_log_research_intents WHERE record->>'kind' = 'INTENT' AND record->>'action' IN ('DISPATCH', 'CANCEL_DISPATCH')
     ORDER BY position DESC LIMIT ${SENDS_LIMIT * 3}`, []) as readonly Record<string, unknown>[];
  const intents = intentRows.map((r): SendIntentRaw => ({ intentId: String(r.intent_id), action: r.action === "CANCEL_DISPATCH" ? "CANCEL_DISPATCH" : "DISPATCH",
    note: typeof r.note === "string" ? r.note : null, requestedAt: String(r.requested_at) }));
  if (intents.length === 0) return [];
  const [honoredRows, carriedRows] = await Promise.all([
    boundedQuery(sql, op("cp_log_research_intents.send_honored"),
      `SELECT record->>'honors' AS honors, record->>'honoredAt' AS honored_at, left(record->>'detail', 600) AS detail
       FROM cp_log_research_intents WHERE record->>'kind' = 'HONORED' AND record->>'honors' = ANY($1::text[])`, [intents.map((i) => i.intentId)]),
    boundedQuery(sql, op("cp_research_state.carried_sends"),
      `SELECT t->>'ref' AS ref, COALESCE((t->'requirements'->>'deferred')::int, 0) AS deferred, COALESCE((t->'requirements'->>'created')::int, 0) AS created
       FROM cp_research_state s, jsonb_array_elements(COALESCE(s.value->'dispatchWork'->'targets', '[]'::jsonb)) t
       WHERE t->>'kind' = 'DISPATCH' AND COALESCE((t->'requirements'->>'deferred')::int, 0) > 0`, []),
  ]) as readonly (readonly Record<string, unknown>[])[];
  return sendViews({ intents,
    honored: honoredRows.map((r): SendHonoredRaw => ({ honors: String(r.honors), honoredAt: String(r.honored_at), detail: String(r.detail ?? "") })),
    carried: carriedRows.map((r): SendCarriedRaw => ({ ref: String(r.ref), deferred: Number(r.deferred) || 0, created: Number(r.created) || 0 })) });
}
