/**
 * **THE QUEUE: EVERYTHING IN MOTION IN ONE LIST (BR-14).** Orders, scheduled orders, instructions sent to the fleet, hunts and
 * missions, stuck cases, doors shut now and fix-list items, each one once. A row says what it is, where it stands (a status chip
 * and one of five filters), who has it, when it is due, the next step and how far along it is, and carries the one control that
 * stops or pauses that kind of thing. PURE: the loaded sections in, rows out; a section that could not be read is null and adds no
 * rows (the screen says it could not be read, never "nothing in motion").
 */
import type { ActionRef, ClosedFix, FixView, Hunt, Lane, OpenFix, SentInstruction, StuckItem, UiReceipt } from "./model.ts";
import { orderStepsReached, ORDER_STEPS } from "./receipts.ts";
import { mst, TASK_STAGES } from "./model.ts";

export const QUEUE_FILTERS = ["needs-me", "in-progress", "scheduled", "waiting", "done"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export const QUEUE_FILTER_WORDS: Readonly<Record<QueueFilter, string>> = {
  "needs-me": "Needs me",
  "in-progress": "In progress",
  scheduled: "Scheduled",
  waiting: "Waiting",
  done: "Done",
};

export type QueueKind = "order" | "scheduled" | "send" | "hunt" | "stuck" | "door" | "fix";

export interface QueueRow {
  /** One per thing: `<kind>:<id>`. Never shown. */
  readonly key: string;
  readonly kind: QueueKind;
  readonly what: string;
  readonly chip: string;
  readonly tone: "neutral" | "good" | "warn" | "info" | "slate";
  readonly filter: QueueFilter;
  readonly owner: string;
  /** Finish-by or next round, in words; null when no time is known. */
  readonly due: string | null;
  readonly next: string;
  /** How far along, or null when this kind of thing has no steps. */
  readonly progress: { readonly done: number; readonly of: number; readonly words: string } | null;
  readonly actions: readonly ActionRef[];
  readonly open: { readonly type: "stuck" | "fix"; readonly id: string } | null;
  /** Newest first within a filter. */
  readonly at: string | null;
}

export interface QueueDoor { readonly name: string; readonly why: string | null; readonly since: string | null }
export interface QueueScheduled { readonly id: string; readonly label: string; readonly when: string; readonly repeats: string | null; readonly finishBy: string | null }

export interface QueueInput {
  readonly receipts: readonly UiReceipt[] | null;
  readonly sends: readonly SentInstruction[] | null;
  readonly hunts: readonly Hunt[] | null;
  readonly stuck: readonly StuckItem[] | null;
  readonly fixes: FixView | null;
  readonly doors: readonly QueueDoor[] | null;
  readonly scheduled: readonly QueueScheduled[] | null;
}

const LANE_FILTER: Readonly<Record<Lane, QueueFilter>> = { decision: "needs-me", auto: "in-progress", publisher: "waiting", software: "waiting" };
const LANE_CHIP: Readonly<Record<Lane, string>> = { decision: "Needs your decision", auto: "Being fixed automatically", publisher: "Waiting for the publisher", software: "Needs a software fix" };
const LANE_OWNER: Readonly<Record<Lane, string>> = { decision: "You", auto: "The runner", publisher: "The publisher", software: "Engineering" };

const norm = (words: string): string => words.replace(/\s+/g, " ").trim().toLowerCase();

/** An instruction sent to the fleet is both a saved order and a send; it is listed once, as the send, when the send list holds it. */
function sendOf(receipt: UiReceipt, sends: readonly SentInstruction[]): SentInstruction | null {
  if (receipt.kind !== "send-agents") return null;
  const words = norm(receipt.words ?? "");
  if (words === "") return null;
  return sends.find((x) => norm(x.words) === words && Math.abs(Date.parse(x.sentAt) - Date.parse(receipt.sentAt)) < 86_400_000) ?? null;
}

function orderRow(r: UiReceipt): QueueRow {
  const failed = r.status === "refused" || r.status === "failed" || r.notPickedUp === true;
  const reached = orderStepsReached(r);
  const filter: QueueFilter = failed ? "needs-me" : r.status === "done" || r.status === "partial" ? "done"
    : r.status === "running" || r.lifecycle.workStarted ? "in-progress" : r.plan?.resultsBy && reached === 3 ? "scheduled" : "waiting";
  const due = r.plan?.resultsBy ? mst(r.plan.resultsBy) : null;
  return {
    key: `order:${r.key}`, kind: "order", what: r.label, chip: r.statusWords, tone: failed ? "warn" : filter === "done" ? "good" : "neutral", filter,
    owner: r.plan ? r.plan.who : "—", due, next: r.says,
    progress: { done: reached, of: ORDER_STEPS.length, words: ORDER_STEPS[Math.max(0, reached - 1)] },
    actions: [], open: null, at: r.sentAt,
  };
}

function sendRow(x: SentInstruction): QueueRow {
  const filter: QueueFilter = x.state === "carried" ? "in-progress" : x.state === "waiting" ? "waiting" : "done";
  return {
    key: `send:${x.id}`, kind: "send", what: x.words === "" ? "An instruction sent to the fleet" : x.words, chip: x.stateWords,
    tone: filter === "done" ? "good" : "neutral", filter, owner: "The runner", due: null, next: x.ranAs ?? x.stateWords, progress: null,
    actions: x.canCancel ? [{ kind: "cancel-send", target: x.id, label: "Take it back", payload: { words: x.words } }] : [],
    open: null, at: x.sentAt,
  };
}

function huntRow(h: Hunt): QueueRow {
  const filter: QueueFilter = h.status === "running" ? "in-progress" : h.status === "stopped" ? "done" : "waiting";
  const chip = h.status === "running" ? "Hunting" : h.status === "paused" ? "Paused" : h.status === "stopped" ? "Stopped" : "Saved, not reported running";
  const spent = Math.max(0, h.spentUsd);
  return {
    key: `hunt:${h.id}`, kind: "hunt", what: `Hunt: ${h.name}`, chip, tone: filter === "in-progress" ? "good" : "neutral", filter,
    owner: "The runner", due: null,
    next: h.status === "running" ? "Works on its next round." : h.status === "paused" ? "Resume it to keep going." : h.status === "stopped" ? "Nothing more will be started." : "Whether paid work is running is not reported.",
    progress: h.limitUsd > 0 ? { done: Math.min(spent, h.limitUsd), of: h.limitUsd, words: `$${spent.toFixed(2)} of $${h.limitUsd.toFixed(2)} budget used` } : null,
    actions: h.status === "stopped" ? [] : [{ kind: h.status === "paused" ? "hunt-resume" : "hunt-pause", target: h.placeKey }, { kind: "hunt-stop", target: h.placeKey }],
    open: null, at: h.startedAt,
  };
}

function stuckRow(i: StuckItem): QueueRow {
  return {
    key: `stuck:${i.id}`, kind: "stuck", what: i.title, chip: LANE_CHIP[i.lane], tone: i.lane === "decision" ? "warn" : i.lane === "auto" ? "good" : "slate",
    filter: LANE_FILTER[i.lane], owner: i.owner === "" ? LANE_OWNER[i.lane] : i.owner, due: null, next: i.next, progress: null,
    actions: i.actions.slice(0, 2), open: { type: "stuck", id: i.id }, at: null,
  };
}

function doorRow(d: QueueDoor, n: number): QueueRow {
  return {
    key: `door:${n}:${d.name}`, kind: "door", what: `Door shut: ${d.name}`, chip: "Shut", tone: "warn", filter: "waiting", owner: "The team",
    due: null, next: d.why === null ? "—" : d.why, progress: null, actions: [], open: null, at: d.since,
  };
}

function openFixRow(o: OpenFix): QueueRow {
  const filter: QueueFilter = o.tab === "attention" ? "needs-me" : o.tab === "fixing" ? "in-progress" : "waiting";
  return {
    key: `fix:${o.id}`, kind: "fix", what: o.title, chip: ({ attention: "Needs attention", fixing: "Being fixed", update: "Waiting for update" })[o.tab], tone: filter === "needs-me" ? "warn" : "neutral",
    filter, owner: o.owner, due: null, next: o.problem,
    progress: o.taskStage === null ? null : { done: o.taskStage + 1, of: TASK_STAGES.length, words: TASK_STAGES[o.taskStage] },
    actions: [{ kind: "fixfirst", target: o.id }, { kind: "focus", target: o.id }, ...(o.origin === "engineering" && o.taskId === null ? [{ kind: "eng-task" as const, target: o.id }] : [])],
    open: { type: "fix", id: o.id }, at: null,
  };
}

function closedFixRow(c: ClosedFix, returned: boolean): QueueRow {
  return {
    key: `fix:${c.id}`, kind: "fix", what: c.title, chip: returned ? "Came back" : "Fixed and checked", tone: returned ? "warn" : "good", filter: returned ? "needs-me" : "done",
    owner: c.origin, due: null, next: returned ? (c.returnedDetail ?? c.since) : c.changed, progress: null, actions: [], open: { type: "fix", id: c.id }, at: c.fixedAt,
  };
}

function scheduledRow(x: QueueScheduled): QueueRow {
  return {
    key: `scheduled:${x.id}`, kind: "scheduled", what: x.label, chip: "Scheduled", tone: "neutral", filter: "scheduled", owner: "The runner",
    due: x.finishBy ? `${x.when} · finish by ${x.finishBy}` : x.when, next: x.repeats === null ? "Sent once, at that time." : x.repeats, progress: null,
    actions: [{ kind: "order-unschedule", target: x.id, label: "Cancel this scheduled order" }], open: null, at: null,
  };
}

/** Every row once, in the order a person scans: what needs them first, then what is moving, then the rest; newest first within a group. */
export function buildQueue(input: QueueInput): readonly QueueRow[] {
  const rows: QueueRow[] = [];
  const sends = input.sends ?? [];
  if (input.sends) rows.push(...input.sends.map(sendRow));
  if (input.receipts) rows.push(...input.receipts.filter((r) => sendOf(r, sends) === null).map(orderRow));
  if (input.scheduled) rows.push(...input.scheduled.map(scheduledRow));
  if (input.hunts) rows.push(...input.hunts.map(huntRow));
  if (input.stuck) rows.push(...input.stuck.map(stuckRow));
  if (input.doors) rows.push(...input.doors.map(doorRow));
  if (input.fixes) rows.push(...input.fixes.open.map(openFixRow), ...input.fixes.closed.map((c) => closedFixRow(c, false)), ...input.fixes.returned.map((c) => closedFixRow(c, true)));
  const rank = (f: QueueFilter) => QUEUE_FILTERS.indexOf(f);
  return rows
    .map((r, n) => ({ r, n }))
    .sort((a, b) => rank(a.r.filter) - rank(b.r.filter) || (b.r.at ?? "").localeCompare(a.r.at ?? "") || a.n - b.n)
    .map((x) => x.r);
}

export function queueCounts(rows: readonly QueueRow[]): Readonly<Record<QueueFilter, number>> {
  const out: Record<QueueFilter, number> = { "needs-me": 0, "in-progress": 0, scheduled: 0, waiting: 0, done: 0 };
  for (const r of rows) out[r.filter] += 1;
  return out;
}
