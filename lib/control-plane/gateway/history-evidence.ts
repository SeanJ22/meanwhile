/** BR-36: classify a receipt's identity and place, without claiming its effect. */
import type { ActionReceipt } from "./contract.ts";
import { lookupAction } from "./registry.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import type { ValidatedActionEvidence } from "../admin-view/action-history-projection.ts";

export function registeredHistoryEvidence(receipt: ActionReceipt): ValidatedActionEvidence {
  const action = lookupAction(receipt.type);
  if (!action) return { kind: "UNAVAILABLE", legacy: false };
  if ((receipt.type === "runner.pause" || receipt.type === "runner.resume") && receipt.subjectKind === "the standing runner")
    return { kind: "GLOBAL_RUNNER", type: receipt.type };
  const place = [receipt.requestedSubject, receipt.subject].find(subject => subject && parseV6PlaceKey(subject) && subject !== "us") ?? "us";
  return { kind: "REGISTERED", type: action.definition.type, scopeKey: place };
}
