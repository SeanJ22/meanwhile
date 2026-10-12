import { formatEastern } from "../eastern-time.ts";
import { nextDue, scheduledOrders, type ScheduledOrder } from "../gateway/scheduled-orders.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";

export interface ScheduledRow {
  /** What `orders.unschedule` names; the control carries it, the screen never shows it. */
  readonly id: string;
  readonly label: string;
  readonly status: "Scheduled";
  readonly when: string;
  readonly repeats: string | null;
  readonly finishBy: string | null;
  readonly finishByAt: string | null;
}
export interface ScheduledView { readonly rows: readonly ScheduledRow[]; readonly observedAt: string }

const REPEAT_WORDS = { hourly: "Repeats every hour", daily: "Repeats every day", weekly: "Repeats every week" } as const;

function row(o: ScheduledOrder, all: readonly ScheduledOrder[]): ScheduledRow {
  const due = nextDue(o);
  const follows = o.after ? all.find((x) => x.id === o.after)?.label : null;
  return {
    id: o.id, label: o.label, status: "Scheduled",
    when: due ? formatEastern(due) : o.after ? `After ${follows ?? "another order"}` : o.repeat ? "On its repeat" : "—",
    repeats: o.repeat ? REPEAT_WORDS[o.repeat] : null,
    finishBy: o.finishBy ? formatEastern(o.finishBy) : null, finishByAt:o.finishBy,
  };
}

export function scheduledView(config: AdminConfig | null, observedAt: string): ScheduledView {
  const all = config ? scheduledOrders(config) : [];
  return { rows: all.map((o) => row(o, all)), observedAt };
}
