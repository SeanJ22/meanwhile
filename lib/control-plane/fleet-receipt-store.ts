import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { PROMOTER_VERSION, PROMOTION_REFUSALS, RECEIPTS_DIR, receiptSummary, type PromotionReceipt, type PromotionTarget } from "./promotion/promoter.ts";
import type { WindowRunRecord } from "./promotion/types.ts";
import { canonicalJson } from "./repository/types.ts";

export const FLEET_RECEIPT_LOADING_VERSION = "fleet-receipt-loading/v1";
export interface FleetReceiptLoadEntry {
  readonly receiptId: string;
  readonly target: PromotionTarget["kind"];
  readonly windowId: string;
  readonly state: "LOADED" | "MISSING" | "INVALID" | "UNAVAILABLE" | "RETAINED" | "LIMIT_REACHED";
  readonly observedAt: string;
  readonly lastSuccessfulReadAt: string | null;
  readonly gaps: readonly string[];
}
export interface FleetReceiptLoadReport {
  readonly version: typeof FLEET_RECEIPT_LOADING_VERSION;
  readonly receipts: readonly PromotionReceipt[];
  readonly entries: readonly FleetReceiptLoadEntry[];
  readonly limits: { readonly maximumReceipts: number; readonly maxReceiptBytes: number };
  readonly truncated: number;
}
export interface FleetReceiptStore {
  read(windows: readonly WindowRunRecord[], observedAt: string): Promise<FleetReceiptLoadReport>;
}
type Summary = NonNullable<WindowRunRecord["promotionReceipts"]>[number];
type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
const nullableString = (value: unknown) => value === null || string(value);
const timestamp = (value: unknown): value is string => string(value) && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value);
const nullableCount = (value: unknown) => value === null || (integer(value) && (value as number) >= 0);
const hash = (value: unknown) => value === null || (string(value) && /^[a-f0-9]{64}$/.test(value));
const boolean = (value: unknown) => typeof value === "boolean";
const oneOf = (value: unknown, values: readonly string[]) => string(value) && values.includes(value);

/** Shape validation only. Failed/refused/reversed receipts remain reportable evidence, never upgraded. */
function isReceipt(value: unknown): value is PromotionReceipt {
  if (!object(value)) return false;
  const r = value, a = r.authority, b = r.before, after = r.after;
  if (r.formatVersion !== 1 || r.version !== PROMOTER_VERSION || !string(r.receiptId) || !timestamp(r.at) || !nullableString(r.windowId) ||
    !object(r.target) || !oneOf(r.target.kind, ["READER", "SHADOW"]) || !string(r.target.root) || !object(a) ||
    !boolean(a.enabled) || !strings(a.openRecordClasses) || !oneOf(a.basis, ["LIVE_ACTIVATION_GATE", "SHADOW_CANARY_AS_IF"]) || !string(a.reason) ||
    !Array.isArray(r.items) || !r.items.every(item => object(item) && [item.itemId, item.recordClass, item.factKey, item.meetingId].every(string) &&
      oneOf(item.change, ["ADD", "REPLACE", "UNCHANGED"]) && strings(item.changedFields)) ||
    !Array.isArray(r.refused) || !r.refused.every(item => object(item) && [item.itemId, item.recordClass, item.detail].every(string) && oneOf(item.code, PROMOTION_REFUSALS)) ||
    !object(b) || !string(b.path) || !boolean(b.existed) || !hash(b.sha256) || !nullableString(b.copy) ||
    !object(after) || !hash(after.sha256) || !nullableCount(after.meetings) || !boolean(after.written) || !nullableString(r.receiptPath) || !strings(r.lines)) return false;
  const v = r.verification;
  if (v !== null && (!object(v) || !string(v.instrument) || !(v.exitCode === null || integer(v.exitCode)) ||
    !(v.passed === null || boolean(v.passed)) || !string(v.detail))) return false;
  const g = r.regression;
  if (g !== null && (!object(g) || !oneOf(g.action, ["NONE", "REVERT_AND_INCIDENT", "INCIDENT_WITHOUT_REVERT"]) || !string(g.reason))) return false;
  const reversal = r.reversal;
  if (reversal !== null && (!object(reversal) || !boolean(reversal.executed) || !nullableTimestamp(reversal.at) ||
    !hash(reversal.restoredSha256) || !(reversal.matchesBefore === null || boolean(reversal.matchesBefore)) || !string(reversal.detail))) return false;
  const incident = r.incident;
  return incident === null || (object(incident) && incident.formatVersion === 1 && [incident.incidentId, incident.windowId, incident.code, incident.detail].every(string) &&
    oneOf(incident.stage, ["LEGACY_REFRESH", "PIPELINE_EVALUATION", "POST_PROMOTION_VERIFICATION", "DIGEST", "LOCK", "PROMOTION"]) && timestamp(incident.openedAt) && strings(incident.missedScope));
}

function pathEqual(a: string, b: string): boolean {
  const left = resolve(a), right = resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
class InvalidReceipt extends Error {}

async function readBoundedFile(root: string, path: string, maximum: number): Promise<Buffer> {
  // Check every component, including configured root ancestors: no symlink/junction traversal.
  const absolute = resolve(path), parsed = parse(absolute);
  let cursor = parsed.root;
  for (const part of relative(parsed.root, absolute).split(sep)) {
    cursor = join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw new InvalidReceipt("RECEIPT_SYMLINK_REFUSED");
    if (!pathEqual(cursor, absolute) && !info.isDirectory()) throw new InvalidReceipt("RECEIPT_PARENT_NOT_DIRECTORY");
  }
  if (!pathEqual(await realpath(root), root) || !pathEqual(await realpath(path), path)) throw new InvalidReceipt("RECEIPT_REALPATH_MISMATCH");
  const before = await lstat(path);
  if (!before.isFile()) throw new InvalidReceipt("RECEIPT_NOT_REGULAR_FILE");
  if (before.size > maximum) throw new InvalidReceipt("RECEIPT_BYTE_LIMIT_EXCEEDED");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new InvalidReceipt("RECEIPT_CHANGED_DURING_OPEN");
    const buffer = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, size);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size > maximum) throw new InvalidReceipt("RECEIPT_BYTE_LIMIT_EXCEEDED");
    const after = await handle.stat();
    const finalPath = await lstat(path);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || size !== after.size || !pathEqual(await realpath(path), path) ||
      finalPath.isSymbolicLink() || finalPath.dev !== after.dev || finalPath.ino !== after.ino ||
      finalPath.size !== after.size || finalPath.mtimeMs !== after.mtimeMs) {
      throw new InvalidReceipt("RECEIPT_CHANGED_DURING_READ");
    }
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

function validateBinding(receipt: PromotionReceipt, summary: Summary, windowId: string, target: PromotionTarget, path: string, observedAt: string): void {
  if (receipt.receiptId !== summary.receiptId || receipt.windowId !== windowId || receipt.target.kind !== target.kind ||
    !pathEqual(receipt.target.root, target.root)) throw new InvalidReceipt("RECEIPT_ID_TARGET_OR_WINDOW_MISMATCH");
  if (Date.parse(receipt.at) > Date.parse(observedAt)) throw new InvalidReceipt("RECEIPT_FROM_FUTURE");
  if (receipt.receiptPath === null || !pathEqual(receipt.receiptPath, path) ||
    !pathEqual(receipt.before.path, join(target.root, "data", "meetings-snapshot.json")) ||
    (receipt.before.copy !== null && !pathEqual(receipt.before.copy, join(dirname(path), `${receipt.receiptId}.before.json`)))) throw new InvalidReceipt("RECEIPT_BOUND_PATH_MISMATCH");
  const actual = receiptSummary(receipt);
  if (actual.target !== summary.target || actual.promoted !== summary.promoted || actual.refused !== summary.refused ||
    actual.reverted !== summary.reverted || actual.incidentId !== summary.incidentId ||
    (summary.path !== null && !pathEqual(summary.path, path))) throw new InvalidReceipt("WINDOW_RECEIPT_SUMMARY_MISMATCH");
}

/** Trusted roots are application configuration. Summary paths and HTTP input never choose a root or filename. */
export function createFleetReceiptStore(input: { readonly targets: readonly PromotionTarget[]; readonly maximumReceipts?: number;
  readonly maxReceiptBytes?: number }): FleetReceiptStore {
  const maximumReceipts = input.maximumReceipts ?? 64, maxReceiptBytes = input.maxReceiptBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maximumReceipts) || maximumReceipts < 1 || maximumReceipts > 1024 ||
    !Number.isSafeInteger(maxReceiptBytes) || maxReceiptBytes < 1 || maxReceiptBytes > 16_777_216 || input.targets.length > 16) throw new Error("FLEET_RECEIPT_LIMIT_INVALID");
  const targets = input.targets.map(target => {
    if (!isAbsolute(target.root) || !["SHADOW", "READER"].includes(target.kind) || target.root.split(/[\\/]/).includes("..")) throw new Error("FLEET_RECEIPT_TARGET_INVALID");
    return { kind: target.kind, root: resolve(target.root) };
  });
  if (new Set(targets.map(target => target.kind)).size !== targets.length) throw new Error("FLEET_RECEIPT_TARGET_AMBIGUOUS");
  const cache = new Map<string, { receipt: PromotionReceipt; at: string; readSequence: number }>();
  let readSequence = 0;
  return { async read(windows, observedAt) {
    if (!timestamp(observedAt)) throw new Error("FLEET_RECEIPT_CLOCK_INVALID");
    const thisRead = ++readSequence;
    const candidates = new Map<string, { windowId: string; summary: Summary; conflict: boolean }>();
    let additionalSkippedReferences = 0;
    for (const window of [...windows].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || a.windowId.localeCompare(b.windowId))) {
      for (const summary of window.promotionReceipts ?? []) {
        const key = `${summary.target}:${window.windowId}:${summary.receiptId}`;
        const previous = candidates.get(key);
        if (!previous) {
          if (candidates.size < maximumReceipts + 1) candidates.set(key, { windowId: window.windowId, summary, conflict: false });
          else additionalSkippedReferences++;
        }
        else if (canonicalJson(previous.summary) !== canonicalJson(summary)) previous.conflict = true;
      }
    }
    const receipts: PromotionReceipt[] = [], entries: FleetReceiptLoadEntry[] = [];
    let count = 0;
    for (const [key, candidate] of candidates) {
      const { summary, windowId } = candidate;
      let prior = cache.get(key);
      const base = { receiptId: summary.receiptId, target: summary.target, windowId, observedAt };
      let state: FleetReceiptLoadEntry["state"] = "MISSING", gaps: string[] = [];
      let loaded: PromotionReceipt | null = null;
      if (count++ >= maximumReceipts) { state = "LIMIT_REACHED"; gaps = ["RECEIPT_COUNT_LIMIT_REACHED"]; }
      else if (!/^pr-[a-f0-9]{24}$/.test(summary.receiptId)) { state = "INVALID"; gaps = ["RECEIPT_ID_INVALID"]; }
      else if (candidate.conflict) { state = "INVALID"; gaps = ["WINDOW_RECEIPT_SUMMARIES_CONTRADICT"]; }
      else {
        const applicable = targets.filter(target => target.kind === summary.target);
        if (!applicable.length) { state = "UNAVAILABLE"; gaps = ["RECEIPT_TARGET_NOT_CONFIGURED"]; }
        for (const target of applicable) {
          const path = join(target.root, ...RECEIPTS_DIR, `${summary.receiptId}.json`);
          try {
            const body = await readBoundedFile(target.root, path, maxReceiptBytes);
            let decoded: unknown;
            try { decoded = JSON.parse(body.toString("utf8")); } catch { throw new InvalidReceipt("RECEIPT_JSON_INVALID"); }
            if (!isReceipt(decoded)) throw new InvalidReceipt("RECEIPT_SCHEMA_INVALID");
            validateBinding(decoded, summary, windowId, target, path, observedAt);
            if (loaded) throw new InvalidReceipt("RECEIPT_MULTIPLE_CONFIGURED_ROOT_MATCHES");
            loaded = decoded;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            state = error instanceof InvalidReceipt ? "INVALID" : "UNAVAILABLE";
            gaps.push(error instanceof InvalidReceipt ? error.message : "RECEIPT_FILE_UNAVAILABLE");
          }
        }
        if (loaded && !gaps.length) {
          prior = cache.get(key) ?? prior;
          if (prior && (Date.parse(prior.at) > Date.parse(observedAt) ||
            (Date.parse(prior.at) === Date.parse(observedAt) && prior.readSequence > thisRead))) {
            state = "RETAINED";
            gaps.push("RECEIPT_READ_SUPERSEDED_BY_NEWER_OBSERVATION");
          } else {
            state = "LOADED";
            cache.delete(key); cache.set(key, { receipt: structuredClone(loaded), at: observedAt, readSequence: thisRead });
            while (cache.size > maximumReceipts) cache.delete(cache.keys().next().value!);
            receipts.push(loaded);
          }
        } else if (!gaps.length) gaps.push("RECEIPT_FILE_MISSING");
      }
      if (state !== "LOADED") prior = cache.get(key) ?? prior;
      if (state !== "LOADED" && state !== "LIMIT_REACHED" && prior) {
        receipts.push(structuredClone(prior.receipt));
        state = "RETAINED";
        gaps.push("RETAINED_HISTORICAL_RECEIPT_NOT_CURRENT_PROOF");
      }
      entries.push({ ...base, state, lastSuccessfulReadAt: state === "LOADED" ? observedAt : prior?.at ?? null, gaps: [...new Set(gaps)] });
    }
    return { version: FLEET_RECEIPT_LOADING_VERSION, receipts, entries, limits: { maximumReceipts, maxReceiptBytes },
      truncated: additionalSkippedReferences + Math.max(0, candidates.size - maximumReceipts) };
  } };
}
