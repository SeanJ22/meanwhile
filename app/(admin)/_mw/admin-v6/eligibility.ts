/**
 * **ONE RULE FOR WHETHER A BUTTON THAT CHANGES THINGS IS ON.**
 *
 * Checked in this order, and the first failure is the reason shown
 * (INTERACTIONS-AND-DATA.md, "One eligibility rule"):
 *
 *   1. the connection is live
 *   2. the role allows it (viewer: nothing; spending needs its own permission)
 *   3. no earlier send of the same action on the same target is pending
 *   4. something real can carry it out (live mode only: a named dependency)
 *   5. the item is in the right state
 *
 * The server re-checks all of it; this is only so the owner is never offered a
 * control that would be refused for a reason the page already knows.
 *
 * PURE.
 */
import type { ActionDef } from "./actions.ts";
import { mst, PENDING_STATUSES, type UiReceipt } from "./model.ts";

export type Connection = "connecting" | "live" | "stale" | "reconnecting" | "offline";

export interface Access {
  readonly role: "owner" | "viewer";
  readonly canSpend: boolean;
  readonly outreachAuthorized: boolean;
}

export const CONNECTION_REASON: Readonly<Record<Exclude<Connection, "live">, string>> = {
  connecting: "Connecting.",
  stale: "Numbers are out of date.",
  reconnecting: "Reconnecting.",
  offline: "Disconnected.",
};

/**
 * An earlier send that has not settled. A send the gateway has SAVED is settled
 * as far as sending again goes: it is durable, and waiting for the runner to
 * pick it up must not stop the owner giving a newer instruction (a corrected
 * limit, say). Only a send whose outcome is not known blocks another.
 */
export function pendingFor(receipts: readonly UiReceipt[], def: Pick<ActionDef, "kind">, target: string): UiReceipt | null {
  return receipts.find((r) => r.kind === def.kind && r.target === target && PENDING_STATUSES.includes(r.status) && (r.gatewayReceiptId === null || r.status === "unknown")) ?? null;
}

export function whyNot(input: {
  readonly connection: Connection;
  readonly access: Access;
  readonly def: ActionDef;
  readonly target: string;
  readonly receipts: readonly UiReceipt[];
  readonly mode: "live" | "sample";
  /** Live mode: the backend positively supports this action (wired, or announced on the pulse). */
  readonly supported: boolean;
  /** The item-specific reason, when the item is not in a state this action applies to. */
  readonly itemState?: string | null;
}): string | null {
  const { connection, access, def } = input;
  if (connection !== "live") return CONNECTION_REASON[connection];
  if (access.role === "viewer") return "View only.";
  if (def.needs === "spend" && !access.canSpend) return "Needs spending permission.";
  const pending = pendingFor(input.receipts, def, input.target);
  if (pending) {
    return pending.status === "unknown"
      ? "Last try unconfirmed. Check History."
      : `Sent at ${mst(pending.sentAt, false)}. Waiting.`;
  }
  if (input.mode === "live" && !input.supported) {
    return "Not connected yet.";
  }
  return input.itemState ?? null;
}
