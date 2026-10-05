/**
 * **FIRING SCHEDULED ORDERS ON TIME (BR-16, the library half of BR-37).** The runner's always-running parent timer
 * calls `fireDueOrders` between rounds and outside them, and once at start for anything overdue. A due order is sent
 * through the gateway's `submit()` under an idempotency key made from the order and its occurrence, so a restart, a
 * second timer or a hung round never sends it twice. A one-time order is removed once sent; a repeating one moves on.
 */
import { ADMIN_CONFIG_ID, isAdminConfig, type AdminConfig } from "./admin-config.ts";
import { refreshFixDispatchHonors } from "../fix-list.ts";
import { migrateQueuedFixes } from "./fix-migrate.ts";
import { confirmReceipt } from "./confirmation.ts";
import { findReceipt, findScheduledChild } from "./receipts.ts";
import { submit } from "./gateway.ts";
import type { GatewayDeps } from "./registry.ts";
import { scheduledOrders, type ScheduledOrder } from "./scheduled-orders.ts";

const REPEAT_MS = { hourly: 3_600_000, daily: 86_400_000, weekly: 7 * 86_400_000 } as const;

/** The moment this order is next due, or null while it waits on another order, or when it has run out. */
export function dueAt(order: ScheduledOrder, all: readonly ScheduledOrder[], lastFiredAt: string | null): string | null {
  if (order.after) return null; // Completion must be read, never inferred from removal.
  if (order.repeat) {
    const base = lastFiredAt ?? order.startAt ?? order.decidedAt;
    return lastFiredAt ? new Date(Date.parse(base) + REPEAT_MS[order.repeat]).toISOString() : base;
  }
  return order.startAt ?? order.decidedAt;
}

/** A missed finish-by is late; it must still run and never pauses publishing. */
export function expired(order: ScheduledOrder, nowMs: number): boolean {
  return order.finishBy !== null && Date.parse(order.finishBy) < nowMs;
}

export interface FiredOrder { readonly id: string; readonly orderType: string; readonly occurrence: string; readonly ok: boolean }

/** Key for one occurrence of one order: the same order and moment is the same key. Only characters the gateway accepts. */
export function occurrenceKey(orderId: string, occurrence: string): string {
  return `sched-${orderId}-${occurrence}`.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 120);
}

/**
 * Send every order that is due at `nowIso`. Safe to call from two places at once and after a restart: each occurrence
 * has one key. Returns what was sent this call.
 */
export async function fireDueOrders(deps: GatewayDeps, nowIso: string, lastFired: ReadonlyMap<string, string> = new Map()): Promise<readonly FiredOrder[]> {
  await migrateQueuedFixes(deps, nowIso).catch(() => undefined);
  await refreshFixDispatchHonors(deps.repos, nowIso).catch(() => undefined);
  const nowMs = Date.parse(nowIso);
  const held = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config: AdminConfig | null = held && isAdminConfig(held.value) ? held.value : null;
  if (!held || !config) return [];
  const all = scheduledOrders(config);
  const fired: FiredOrder[] = [];
  const done = new Set<string>();
  const moved = new Map<string, string>();
  for (const order of all) {
    const afterDone = order.after ? await completedDependency(deps, order.after, nowMs) : false;
    const due = order.after && afterDone ? order.startAt ?? order.decidedAt : dueAt(order, all, order.lastFiredAt ?? lastFired.get(order.id) ?? null);
    if (due === null || Date.parse(due) > nowMs) continue;
    const outcome = await submit({ type: order.orderType, subject: order.subject ?? "", input: order.input, stateVersion: null,
      idempotencyKey: occurrenceKey(order.id, due), scheduleOrigin: { id: order.id, occurrence: due, finishBy: order.finishBy }, caller: "OWNER_SESSION", actorRef: order.decidedBy }, deps);
    fired.push({ id: order.id, orderType: order.orderType, occurrence: due, ok: outcome.ok });
    if (order.repeat) moved.set(order.id, due); else done.add(order.id);
  }
  if (done.size === 0 && moved.size === 0) return fired;
  // Gateway actions can change this same config. Re-read and merge only schedule fields,
  // retrying CAS without replacing a setting or a schedule added during the sends.
  for (let attempt = 0; attempt < 4; attempt++) {
    const latest = await deps.repos.adminConfig.read(ADMIN_CONFIG_ID);
    if (!latest || !isAdminConfig(latest.value)) break;
    const next: AdminConfig = { ...latest.value, updatedAt: nowIso,
      scheduledOrders: scheduledOrders(latest.value).filter(o => !done.has(o.id)).map(o => moved.has(o.id) ? { ...o, lastFiredAt: moved.get(o.id)! } : o) };
    try { await deps.repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, latest.revision, next, nowIso); break; }
    catch { /* A concurrent timer uses the same occurrence keys. */ }
  }
  return fired;
}

/** A schedule's removal is not Done. Find its child receipt, then use the same confirmation as Admin. */
async function completedDependency(deps: GatewayDeps, id: string, nowMs: number): Promise<boolean> {
  try {
    let receipt = await findReceipt(deps.repos,id);
    if(!receipt || receipt.type === "orders.schedule") receipt = await findScheduledChild(deps.repos,id);
    if (!receipt || receipt.outcome === "REFUSED") return false;
    const confirmation = await confirmReceipt(deps.repos,receipt,nowMs,deps.readPlaceScore);
    return confirmation.state === "applied" || confirmation.state === "not-needed";
  } catch { return false; }
}
