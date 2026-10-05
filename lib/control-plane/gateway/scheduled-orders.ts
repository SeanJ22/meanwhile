/**
 * **SCHEDULED ORDERS (BR-15).** An order Sean sends for later: at a time (`startAt`), after something else (`after`),
 * repeating (`repeat`), and/or by a date (`finishBy`). Records live on the Admin config row beside place targets, with
 * who decided and the receipt, so they survive a reload and a runner restart. Firing them on time is BR-16.
 */
import type { AdminConfig } from "./admin-config.ts";

export const REPEATS = ["hourly", "daily", "weekly"] as const;
export type Repeat = (typeof REPEATS)[number];

export interface ScheduledOrder {
  /** The receipt that scheduled it: stable, and what `orders.unschedule` names. */
  readonly id: string;
  /** The registered action it will send. */
  readonly orderType: string;
  readonly subject?: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly startAt: string | null;
  /** Another scheduled order's id, or a receipt id: this one waits for it to be done. */
  readonly after: string | null;
  readonly repeat: Repeat | null;
  readonly finishBy: string | null;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly receiptId: string;
  /** Plain words for the order, shown while it waits. */
  readonly label: string;
  /** For a repeating order: the occurrence last sent. */
  readonly lastFiredAt?: string | null;
}

export const SCHEDULED_ORDERS_MAX = 100;

export function scheduledOrders(config: AdminConfig): readonly ScheduledOrder[] {
  return config.scheduledOrders ?? [];
}

const isTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));

export interface ScheduleInput {
  readonly startAt: string | null;
  readonly after: string | null;
  readonly repeat: Repeat | null;
  readonly finishBy: string | null;
}

/** Read the "when" fields. Needs at least one; a time must be a real time. */
export function parseWhen(input: Readonly<Record<string, unknown>>): { ok: true; value: ScheduleInput } | { ok: false; why: string } {
  const get = (k: string) => (input[k] === undefined || input[k] === null || input[k] === "" ? null : input[k]);
  const startAt = get("startAt"), after = get("after"), repeat = get("repeat"), finishBy = get("finishBy");
  if (startAt !== null && !isTime(startAt)) return { ok: false, why: "give the start as a date and time" };
  if (finishBy !== null && !isTime(finishBy)) return { ok: false, why: "give the finish-by as a date and time" };
  if (after !== null && (typeof after !== "string" || after.length > 200)) return { ok: false, why: "say which order it follows" };
  if (repeat !== null && !(REPEATS as readonly unknown[]).includes(repeat)) return { ok: false, why: "repeat hourly, daily or weekly" };
  if (startAt === null && after === null && repeat === null && finishBy === null) return { ok: false, why: "say when: a time, after something, a repeat or a finish-by date" };
  if (startAt !== null && finishBy !== null && Date.parse(finishBy as string) < Date.parse(startAt as string)) return { ok: false, why: "the finish-by date is before the start" };
  return { ok: true, value: { startAt: startAt as string | null, after: after as string | null, repeat: repeat as Repeat | null, finishBy: finishBy as string | null } };
}

export function withScheduled(config: AdminConfig, order: ScheduledOrder): AdminConfig {
  const held = scheduledOrders(config);
  if (held.some((o) => o.id === order.id)) return config;
  return { ...config, scheduledOrders: [...held, order].slice(-SCHEDULED_ORDERS_MAX), updatedAt: order.decidedAt };
}

export function withoutScheduled(config: AdminConfig, id: string, at: string): AdminConfig {
  const held = scheduledOrders(config);
  if (!held.some((o) => o.id === id)) return config;
  return { ...config, scheduledOrders: held.filter((o) => o.id !== id), updatedAt: at };
}

/** When a waiting order is next due, in words the screen prints. Null when it waits on something else. */
export function nextDue(order: Pick<ScheduledOrder, "startAt" | "after" | "finishBy">): string | null {
  return order.startAt ?? (order.after ? null : order.finishBy);
}
