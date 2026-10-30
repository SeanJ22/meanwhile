import { openBlank, type Query } from "./publish.ts";

/** Hold an identity question open for a detective with every candidate named; nothing is picked, merged or published meanwhile. */
export async function sendToDetective(query: Query, hold: {
  /** An entity that exists today: the one thing the question hangs on. */
  readonly entityId: string;
  readonly field: string;
  readonly reason: "IDENTITY_TIE" | "IDENTITY_NAME_ONLY";
  readonly candidates: readonly string[];
  readonly about?: Readonly<Record<string, unknown>>;
  readonly retryMinutes?: number;
}): Promise<void> {
  await openBlank(query, { entityId: hold.entityId, field: hold.field, stage: "CHECK", reason: hold.reason,
    detail: JSON.stringify({ candidates: [...hold.candidates].sort(), ...hold.about }), retryMinutes: hold.retryMinutes ?? 24 * 60 });
}
