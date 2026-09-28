/** Exact, partial Admin v6 history. This section is not announced in live pulse. */
import { createHash } from "node:crypto";
import { ADMIN_RECEIPT_LOG_KEY, type ActionReceipt } from "../gateway/contract.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

export const ADMIN_V6_HISTORY_CONTRACT = "admin-v6/history@1" as const;
export const ADMIN_V6_HISTORY_MAX_LIMIT = 50;
export type V6ReceiptStatus = "queued" | "read" | "running" | "done" | "partial" | "refused" | "failed" | "unknown";
/** Structural counterpart of Admin v6's UiReceipt; the UI source owns its type. */
export interface V6HistoryReceipt {
  readonly key: string; readonly kind: "global-runner-pause" | "global-runner-resume";
  readonly target: "runner"; readonly targetName: string; readonly label: string;
  readonly scopeKey: "us"; readonly scopeName: "United States"; readonly level: "global";
  readonly status: V6ReceiptStatus; readonly statusWords: string;
  readonly steps: readonly { readonly label: string; readonly at: string }[];
  readonly says: string; readonly items: readonly [];
  readonly lifecycle: { readonly saved: string | null; readonly workersReceived: null;
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

const MISSING = [
  "Only saved pause and resume requests for the whole runner are shown. Place-specific instructions lack a durable scope and action-kind link; their total is unknown.",
  "A saved request does not prove the runner applied it. Worker receipt, repair, verification, publication and public-page effects remain unknown here.",
  "The historical receipt does not record whether a caller replayed the same idempotency key.",
] as const;
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
function mapped(receipt: ActionReceipt, scope: string): V6HistoryReceipt | null {
  if (scope !== "us" || receipt.formatVersion !== 1 ||
    (receipt.type !== "runner.pause" && receipt.type !== "runner.resume") ||
    receipt.subjectKind !== "the standing runner" || !receipt.receiptId || !receipt.idempotencyKey ||
    !eventTime(receipt.startedAt)) return null;
  const status = statusOf(receipt);
  const completed = eventTime(receipt.completedAt);
  return {
    key: receipt.idempotencyKey,
    kind: receipt.type === "runner.pause" ? "global-runner-pause" : "global-runner-resume",
    target: "runner", targetName: "the standing runner", label: receipt.label,
    scopeKey: "us", scopeName: "United States", level: "global", status,
    statusWords: status === "queued" ? "Request saved; runner response unknown" :
      status === "refused" ? "Request refused" : status === "done" ? "Gateway action recorded" :
      status === "running" ? "Gateway action in progress" : "Outcome unknown",
    steps: [{ label: "Sent", at: receipt.startedAt },
      ...(completed ? [{ label: status === "refused" ? "Refused" : "Gateway receipt recorded", at: completed }] : [])],
    says: receipt.says, items: [],
    lifecycle: { saved: status === "queued" || status === "done" ? completed : null,
      workersReceived: null, workStarted: null, workFinished: null, factsChecked: null,
      published: null, checkedOnPublicPage: null },
    simulated: false, gatewayType: receipt.type, gatewayReceiptId: receipt.receiptId,
    readBackAt: receipt.readBackAt, replayed: false, sentAt: receipt.startedAt,
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

/** Pure adapter over exact gateway types. Receipt timestamps order the rows; no append-order claim. */
export function projectV6History(rows: readonly ActionReceipt[], query: V6HistoryQuery): V6HistorySection {
  const q = (query.q ?? "").trim().toLowerCase();
  const status = query.status ?? "all";
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(ADMIN_V6_HISTORY_MAX_LIMIT, query.limit!)) : ADMIN_V6_HISTORY_MAX_LIMIT;
  const cursor = parseCursor(query.cursor, { scope: query.scope, q, status });
  const mappedRows = rows.map(row => mapped(row, query.scope)).filter((row): row is V6HistoryReceipt => row !== null)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt) || a.gatewayReceiptId.localeCompare(b.gatewayReceiptId));
  const revision = createHash("sha256").update(JSON.stringify(mappedRows.map(row => [row.gatewayReceiptId, row.sentAt]))).digest("hex").slice(0, 24);
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

/** Exact type partitions, no whole receipt log or work scan. Non-global scope has no provable rows. */
export async function readV6History(repos: ControlPlaneRepositories, query: V6HistoryQuery): Promise<V6HistorySection> {
  if (query.scope !== "us") return projectV6History([], query);
  const [pauses, resumes] = await Promise.all([
    repos.adminReceipts.readWhere(ADMIN_RECEIPT_LOG_KEY, ["type"], "runner.pause"),
    repos.adminReceipts.readWhere(ADMIN_RECEIPT_LOG_KEY, ["type"], "runner.resume"),
  ]);
  return projectV6History([...pauses, ...resumes], query);
}
export function validV6HistoryStatus(value: string): value is V6ReceiptStatus | "all" {
  return value === "all" || STATUSES.has(value as V6ReceiptStatus);
}
