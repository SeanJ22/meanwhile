/** Each due occurrence is sent under a key made from the order and its moment, so a restart or a second timer never sends it twice. */
import { ADMIN_CONFIG_ID, isAdminConfig, type AdminConfig } from "./admin-config.ts";
import { submit } from "./gateway.ts";
import type { GatewayDeps } from "./registry.ts";
import { scheduledOrders, type ScheduledOrder } from "./scheduled-orders.ts";

const REPEAT_MS = { hourly: 3_600_000, daily: 86_400_000, weekly: 7 * 86_400_000 } as const;

/** The moment this order is next due, or null while it waits on another order, or when it has run out. */
export function dueAt(order: ScheduledOrder, all: readonly ScheduledOrder[], lastFiredAt: string | null): string | null {
  if (order.after && all.some((o) => o.id === order.after)) return null;
  if (order.repeat) {
    const base = lastFiredAt ?? order.startAt ?? order.decidedAt;
    return lastFiredAt ? new Date(Date.parse(base) + REPEAT_MS[order.repeat]).toISOString() : base;
  }
  return order.startAt ?? order.decidedAt;
}

/** Past its finish-by date with nothing sent: it will never be sent. */
export function expired(order: ScheduledOrder, nowMs: number): boolean {
  return order.finishBy !== null && Date.parse(order.finishBy) < nowMs && !order.repeat;
}

export interface FiredOrder { readonly id: string; readonly orderType: string; readonly occurrence: string; readonly ok: boolean }

export function occurrenceKey(orderId: string, occurrence: string): string {
  return `sched-${orderId}-${occurrence}`.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 120);
}

export async function fireDueOrders(deps: GatewayDeps, nowIso: string, lastFired: ReadonlyMap<string, string> = new Map()): Promise<readonly FiredOrder[]> {
  const nowMs = Date.parse(nowIso);
  const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config: AdminConfig | null = held && isAdminConfig(held.value) ? held.value : null;
  if (!held || !config) return [];
  const all = scheduledOrders(config);
  const fired: FiredOrder[] = [];
  const done = new Set<string>();
  const moved = new Map<string, string>();
  for (const order of all) {
    if (expired(order, nowMs)) { done.add(order.id); continue; }
    const due = dueAt(order, all, order.lastFiredAt ?? lastFired.get(order.id) ?? null);
    if (due === null || Date.parse(due) > nowMs) continue;
    const outcome = await submit({ type: order.orderType, subject: "", input: order.input, stateVersion: null,
      idempotencyKey: occurrenceKey(order.id, due), caller: "OWNER_SESSION", actorRef: order.decidedBy }, deps);
    fired.push({ id: order.id, orderType: order.orderType, occurrence: due, ok: outcome.ok });
    if (order.repeat) moved.set(order.id, due); else done.add(order.id);
  }
  if (done.size === 0 && moved.size === 0) return fired;
  const next: AdminConfig = { ...config, updatedAt: nowIso,
    scheduledOrders: all.filter((o) => !done.has(o.id)).map((o) => (moved.has(o.id) ? { ...o, lastFiredAt: moved.get(o.id)! } : o)) };
  try { await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, held.revision, next, nowIso); } catch { }
  return fired;
}
