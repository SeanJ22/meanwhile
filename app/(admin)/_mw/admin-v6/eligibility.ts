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
  connecting: "Connecting to live updates. Buttons that change things turn on once the first update arrives.",
  stale: "The numbers are out of date, so buttons that change things are off. That way you don’t act on old information.",
  reconnecting: "Reconnecting. Buttons that change things are off until the connection is back.",
  offline: "Disconnected. Buttons that change things are off. Nothing you did now would be saved.",
};

export function pendingFor(receipts: readonly UiReceipt[], def: Pick<ActionDef, "kind">, target: string): UiReceipt | null {
  return receipts.find((r) => r.kind === def.kind && r.target === target && PENDING_STATUSES.includes(r.status)) ?? null;
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
  if (access.role === "viewer") return "Your account can look but can’t make changes.";
  if (def.needs === "spend" && !access.canSpend) return "This changes spending, and your account doesn’t have spending permission.";
  const pending = pendingFor(input.receipts, def, input.target);
  if (pending) {
    return pending.status === "unknown"
      ? "We don’t know if the last try worked. Check its result in History before trying again."
      : `You already sent this at ${mst(pending.sentAt, false)}. Waiting to hear what happened.`;
  }
  if (input.mode === "live" && !input.supported) {
    return `Not connected yet. This button turns on by itself when the backend supports it. ${def.dependency?.need ?? ""}`.trim();
  }
  return input.itemState ?? null;
}
