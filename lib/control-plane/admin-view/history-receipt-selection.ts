import { ACTIONS, gatewayActionKind } from "../../../app/(admin)/_mw/admin-v6/actions.ts";
import type { ConfirmationReceipt } from "../gateway/contract.ts";

/** The same registered actions the History mapper can render. */
export const HISTORY_GATEWAY_TYPES = [...new Set([...ACTIONS.values()].flatMap(action => action.gateway ? [action.gateway.type] : []))].sort();
const types = HISTORY_GATEWAY_TYPES.map(type => `'${type.replaceAll("'", "''")}'`).join(",");
export const HISTORY_RECEIPT_SUPPORTED_SQL = `record->>'type' IN (${types})
  AND (record->>'type'<>'decision.record' OR coalesce(nullif(record->>'requestedSubject',''),record->>'subject')='fix-queue')`;

export function historyReceiptSupported(receipt: Pick<ConfirmationReceipt, "type" | "subject" | "requestedSubject" | "says">): boolean {
  return gatewayActionKind(receipt.type, { subject: receipt.requestedSubject || receipt.subject, says: receipt.says }) !== null;
}
