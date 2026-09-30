/** Exact, read-only Admin action receipt lookup. Never replays an action. */
import { ADMIN_RECEIPT_LOG_KEY, receiptIdFor, type ActionReceipt } from "../gateway/contract.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

export const ADMIN_V6_RECEIPT_CONTRACT = "admin-v6/receipt@1" as const;
const ACTION_TYPE = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export function validReceiptIdentity(type: string, key: string): boolean {
  return type.length <= 64 && ACTION_TYPE.test(type) && IDEMPOTENCY_KEY.test(key);
}

export async function lookupAdminReceipt(repos: ControlPlaneRepositories, type: string, key: string):
  Promise<ActionReceipt | null> {
  if (!validReceiptIdentity(type, key)) throw new Error("INVALID_RECEIPT_IDENTITY");
  const receiptId = receiptIdFor(type, key);
  const rows = await repos.adminReceipts.readWhere(ADMIN_RECEIPT_LOG_KEY, ["receiptId"], receiptId);
  if (rows.length > 1) throw new Error("DUPLICATE_RECEIPT_IDENTITY");
  const receipt = rows[0] ?? null;
  if (receipt && (receipt.receiptId !== receiptId || receipt.type !== type || receipt.idempotencyKey !== key))
    throw new Error("RECEIPT_IDENTITY_MISMATCH");
  return receipt;
}
