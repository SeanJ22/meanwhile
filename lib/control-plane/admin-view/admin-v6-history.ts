import { createHash } from "node:crypto";
import { ADMIN_RECEIPT_LOG_KEY, type ActionReceipt } from "../gateway/contract.ts";
import { gatewayActionKind } from "../../../app/(admin)/_mw/admin-v6/actions.ts";
import type { ActionKind } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import { confirmReceipt, type Confirmation } from "../gateway/confirmation.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

export const ADMIN_V6_HISTORY_CONTRACT = "admin-v6/history@1" as const;
export const ADMIN_V6_HISTORY_MAX_LIMIT = 50;
export type V6ReceiptStatus = "queued" | "read" | "running" | "done" | "partial" | "refused" | "failed" | "unknown";
/** Structural counterpart of Admin v6's UiReceipt; the UI source owns its type. */
export interface V6HistoryReceipt {
  readonly key: string; readonly kind: ActionKind;
  readonly notPickedUp?: boolean; readonly finishBy?: string | null; readonly scheduledParentId?:string;
  readonly target: string; readonly targetName: string; readonly label: string;
  readonly scopeKey: string; readonly scopeName: string; readonly level: "local" | "global";
  readonly status: V6ReceiptStatus; readonly statusWords: string;
  readonly steps: readonly { readonly label: string; readonly at: string }[];
  readonly says: string; readonly items: readonly { readonly name: string; readonly status: V6ReceiptStatus; readonly note: string; readonly label?: string }[];
  readonly lifecycle: { readonly saved: string | null; readonly workersReceived: string | null;
    readonly workStarted: null; readonly workFinished: null; readonly factsChecked: null;
    readonly published: null; readonly checkedOnPublicPage: null };
  readonly simulated: false; readonly gatewayType: string; readonly gatewayReceiptId: string;
  readonly readBackAt: string | null; readonly replayed: false; readonly sentAt: string;
}
export interface V6HistorySection {
  readonly contract: typeof ADMIN_V6_HISTORY_CONTRACT; readonly scope: string;
  readonly revision: string; readonly asOf: string; readonly data: readonly V6HistoryReceipt[];
  readonly missingParts: readonly string[];
  readonly page: { readonly total: null; readonly nextCursor: string | null; readonly prevCursor: string | null };
}
export type V6HistoryQuery = { readonly scope: string; readonly asOf: string; readonly q?: string;
  readonly status?: V6ReceiptStatus | "all"; readonly limit?: number; readonly cursor?: string | null };

const MISSING: readonly string[] = [];
const STATUSES = new Set<V6ReceiptStatus>(["queued", "read", "running", "done", "partial", "refused", "failed", "unknown"]);
type Cursor = { readonly v: 1; readonly scope: string; readonly q: string; readonly status: string;
  readonly revision: string; readonly offset: number };

function eventTime(value: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}
function statusOf(receipt: ActionReceipt): V6ReceiptStatus {
  if (receipt.outcome === "REFUSED") return "refused";
  if (receipt.outcome === "QUEUED") return "queued";
  if (receipt.outcome === "IN_PROGRESS") return "running";
  return eventTime(receipt.completedAt) ? "done" : "unknown";
}
function targetWords(kind: ActionKind): string {
  if (kind.startsWith("global-runner-")) return "the standing runner";
  if (kind === "global-ceiling") return "the daily budget";
  if (kind.startsWith("global-")) return "the whole system";
  if (kind.startsWith("setting-")) return "a setting";
  if (kind === "send-agents" || kind === "cancel-send") return "where the fleet works";
  if (kind.startsWith("hunt-")) return "a hunt";
  if (kind.startsWith("target-")) return "a place's target";
  if (kind.startsWith("data-switch-")) return "who can see a number";
  if (kind === "leads-send") return "research leads";
  return "";
}
function mapped(receipt: ActionReceipt, scope: string, confirmation: Confirmation | null = null): V6HistoryReceipt | null {
  const target = receipt.requestedSubject || receipt.subject;
  const kind = gatewayActionKind(receipt.type, { subject: target, says: receipt.says });
  if (receipt.formatVersion !== 1 || !kind || !receipt.receiptId || !receipt.idempotencyKey || !eventTime(receipt.startedAt)) return null;
  const global = kind.startsWith("global-") || kind === "hunt-start-many" || kind === "leads-send";
  const place = /^(?:us|st:[a-z]{2}|geo:[a-z]{2}\.[a-z_]+\.[0-9A-Za-z]{1,16})$/.test(target) ? target : global ? "us" : "unknown";
  if (scope !== "us" && place !== scope && receipt.subject !== scope) return null;
  const confirmed = confirmation?.state === "applied" && receipt.outcome !== "REFUSED";
  const status = receipt.outcome==="REFUSED" ? "refused" : confirmed ? "done" : confirmation?.state === "in-progress" || confirmation?.state === "working" ? "running" : confirmation && ["waiting","unread","not-picked-up"].includes(confirmation.state) ? "queued" : receipt.huntScores?.length ? "queued" : statusOf(receipt);
  const completed = eventTime(receipt.completedAt);
  const confirmedAt = confirmed ? eventTime(confirmation!.at) ?? completed : null;
  return {
    key: receipt.idempotencyKey,
    notPickedUp:confirmation?.state==="not-picked-up", finishBy:receipt.scheduleOrigin?.finishBy??null,
    ...(receipt.scheduleOrigin?{scheduledParentId:receipt.scheduleOrigin.id}:{}),
    kind,
    target: kind.startsWith("global-runner-") ? "runner" : target, targetName: targetWords(kind), label: receipt.label,
    scopeKey: place, scopeName: place === "us" ? "United States" : place === "unknown" ? "Place not recorded" : "—", level: place === "us" ? "global" : "local", status,
    statusWords: confirmation?.state==="not-picked-up" ? "Not picked up" : status === "queued" ? "Request saved; runner response unknown" :
      status === "refused" ? "Request refused" : confirmed ? "Done" : status === "done" ? "Gateway action recorded" :
      status === "running" ? (confirmation?.state === "working" ? "Running" : "Gateway action in progress") : "Outcome unknown",
    steps: [{ label: "Sent", at: receipt.startedAt },
      ...(completed ? [{ label: status === "refused" ? "Refused" : "Gateway receipt recorded", at: completed }] : []),
      ...(confirmedAt ? [{ label: "Runner confirmed", at: confirmedAt }] : [])],
    says: confirmation ? confirmation.words : receipt.says, items: confirmation?.items ?? [],
    lifecycle: { saved: status === "queued" || status === "done" ? completed : null,
      workersReceived: confirmedAt, workStarted: null, workFinished: null, factsChecked: null,
      published: null, checkedOnPublicPage: null },
    simulated: false, gatewayType: receipt.type, gatewayReceiptId: receipt.receiptId,
    readBackAt: receipt.readBackAt, replayed: false, sentAt: receipt.startedAt,
    ...(confirmation?.change ? { change: confirmation.change } : receipt.change ? { change: receipt.change } : {}),
    ...(confirmation?.plan ? { plan: confirmation.plan } : {}), ...(confirmation?.progress ? { progress: confirmation.progress } : {}),
  };
}
function token(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor)).toString("base64url"); }
function parseCursor(raw: string | null | undefined, query: { scope: string; q: string; status: string }): Cursor | null {
  if (!raw) return null;
  if (raw.length > 700 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("INVALID_HISTORY_CURSOR");
  let value: unknown;
  try { value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); }
  catch { throw new Error("INVALID_HISTORY_CURSOR"); }
  if (!value || typeof value !== "object") throw new Error("INVALID_HISTORY_CURSOR");
  const c = value as Partial<Cursor>;
  if (c.v !== 1 || c.scope !== query.scope || c.q !== query.q || c.status !== query.status ||
    typeof c.revision !== "string" || !/^[a-f0-9]{24}$/.test(c.revision) ||
    !Number.isSafeInteger(c.offset) || (c.offset ?? -1) < 0) throw new Error("INVALID_HISTORY_CURSOR");
  return c as Cursor;
}

export function projectV6History(
  rows: readonly ActionReceipt[],
  query: V6HistoryQuery,
  confirmations: ReadonlyMap<string, Confirmation> = new Map(),
): V6HistorySection {
  const q = (query.q ?? "").trim().toLowerCase();
  const status = query.status ?? "all";
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(ADMIN_V6_HISTORY_MAX_LIMIT, query.limit!)) : ADMIN_V6_HISTORY_MAX_LIMIT;
  const cursor = parseCursor(query.cursor, { scope: query.scope, q, status });
  const mappedRows = rows.map(row => mapped(row, query.scope, confirmations.get(row.receiptId) ?? null)).filter((row): row is V6HistoryReceipt => row !== null)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt) || a.gatewayReceiptId.localeCompare(b.gatewayReceiptId));
  const revision = createHash("sha256").update(JSON.stringify(mappedRows.map(row => [row.gatewayReceiptId, row.sentAt, row.status]))).digest("hex").slice(0, 24);
  if (cursor && cursor.revision !== revision) throw new Error("STALE_HISTORY_CURSOR");
  const filtered = mappedRows.filter(row => (status === "all" || row.status === status) &&
    (!q || [row.label, row.targetName, row.says].some(value => value.toLowerCase().includes(q))));
  const offset = cursor?.offset ?? 0;
  if (offset > filtered.length) throw new Error("STALE_HISTORY_CURSOR");
  const data = filtered.slice(offset, offset + limit);
  const nextCursor = offset + data.length < filtered.length ? token({ v: 1, scope: query.scope, q, status, revision, offset: offset + data.length }) : null;
  const prevCursor = offset > 0 ? token({ v: 1, scope: query.scope, q, status, revision, offset: Math.max(0, offset - limit) }) : null;
  return { contract: ADMIN_V6_HISTORY_CONTRACT, scope: query.scope, revision, asOf: query.asOf,
    data, missingParts: MISSING, page: { total: null, nextCursor, prevCursor } };
}

type ReadCursor = { readonly v: 2; readonly scope: string; readonly q: string; readonly status: string; readonly beforePosition: number };
function readCursor(query: V6HistoryQuery): ReadCursor | null {
  if (!query.cursor) return null;
  if (query.cursor.length > 700 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error("INVALID_HISTORY_CURSOR");
  let value: Partial<ReadCursor>;
  try { value = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")); }
  catch { throw new Error("INVALID_HISTORY_CURSOR"); }
  if (!value || value.v !== 2 || value.scope !== query.scope || value.q !== (query.q ?? "").trim().toLowerCase() ||
    value.status !== (query.status ?? "all") || !Number.isSafeInteger(value.beforePosition) || value.beforePosition! < 0) throw new Error("INVALID_HISTORY_CURSOR");
  return value as ReadCursor;
}
export async function readV6History(repos: ControlPlaneRepositories, query: V6HistoryQuery): Promise<V6HistorySection> {
  const cursor = readCursor(query);
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(ADMIN_V6_HISTORY_MAX_LIMIT, query.limit!)) : ADMIN_V6_HISTORY_MAX_LIMIT;
  // Postgres and memory stores read one indexed page; a store without one (the local file store) pages its log in place.
  const page = repos.adminActionHistoryPage ?? (async (q: { scope: string; limit: number; beforePosition?: number | null }) =>
    (await repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY)).map((receipt, position) => ({ receipt, position }))
      .filter((row) => (q.scope === "us" || row.receipt.subject === q.scope || row.receipt.requestedSubject === q.scope) &&
        (q.beforePosition == null || row.position < q.beforePosition))
      .reverse().slice(0, q.limit));
  const rows = await page({ scope: query.scope, limit: limit + 1, beforePosition: cursor?.beforePosition });
  const window = rows.slice(0, limit);
  const confirmations = new Map<string, Confirmation>();
  await Promise.all(window.map(async row => { confirmations.set(row.receipt.receiptId, await confirmReceipt(repos, row.receipt)); }));
  const receipts = window.map(row => query.scope === "us" ? row.receipt : { ...row.receipt, requestedSubject: query.scope });
  const section = projectV6History(receipts, { ...query, cursor: null }, confirmations);
  const nextCursor = rows.length > limit && window.length ? Buffer.from(JSON.stringify({ v: 2, scope: query.scope,
    q: (query.q ?? "").trim().toLowerCase(), status: query.status ?? "all", beforePosition: window.at(-1)!.position })).toString("base64url") : null;
  return { ...section, page: { total: null, nextCursor, prevCursor: null } };
}
export function validV6HistoryStatus(value: string): value is V6ReceiptStatus | "all" {
  return value === "all" || STATUSES.has(value as V6ReceiptStatus);
}
