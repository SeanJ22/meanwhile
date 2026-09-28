/** The gateway's saved receipt, rather than HTTP 200, determines an action's state. */
export type AdminActionReply =
  | { readonly kind: "DONE" | "PENDING" | "REFUSED"; readonly says: string; readonly receiptId: string; readonly readBackAt: string | null; readonly replayed: boolean }
  | { readonly kind: "UNCONFIRMED"; readonly says: string; readonly receiptId: null; readonly readBackAt: null; readonly replayed: false };

export function decodeAdminActionResponse(status: number, body: unknown): AdminActionReply {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const receipt = value?.receipt && typeof value.receipt === "object" ? value.receipt as Record<string, unknown> : null;
  const outcome = receipt?.outcome;
  const receiptId = typeof receipt?.receiptId === "string" && receipt.receiptId ? receipt.receiptId : null;
  const says = typeof receipt?.says === "string" ? receipt.says : typeof value?.says === "string" ? value.says : null;
  if (status >= 200 && status < 300 && receiptId &&
      (outcome === "REFUSED" || value?.ok === true) &&
      (outcome === "DONE" || outcome === "QUEUED" || outcome === "IN_PROGRESS" || outcome === "REFUSED")) {
    return { kind: outcome === "DONE" ? "DONE" : outcome === "REFUSED" ? "REFUSED" : "PENDING",
      says: says ?? (outcome === "DONE" ? "The action was saved." : outcome === "REFUSED" ? "The action was refused." : "The action is still in progress."),
      receiptId, readBackAt: typeof receipt?.readBackAt === "string" ? receipt.readBackAt : null, replayed: value?.replayed === true };
  }
  return { kind: "UNCONFIRMED", says: `${says ? `${says} ` : ""}The action outcome could not be confirmed${status ? ` (HTTP ${status})` : ""}. Check the action ledger before retrying.`,
    receiptId: null, readBackAt: null, replayed: false };
}

export async function postAdminAction(body: Record<string, unknown>): Promise<AdminActionReply> {
  try {
    const response = await fetch("/api/admin/action", { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    return decodeAdminActionResponse(response.status, await response.json().catch(() => null));
  } catch {
    return { kind: "UNCONFIRMED", says: "The response was lost. The action may have been recorded; check the action ledger before retrying.",
      receiptId: null, readBackAt: null, replayed: false };
  }
}

export function actionReplyWords(reply: AdminActionReply): string {
  if (reply.kind === "UNCONFIRMED") return reply.says;
  const state = reply.kind === "DONE" ? "Saved" : reply.kind === "PENDING" ? "Pending" : "Refused";
  return `${state}. ${reply.says} Receipt ${reply.receiptId}${reply.replayed ? " (repeat submission)" : ""}.${reply.readBackAt ? ` Saved state read back at ${reply.readBackAt}.` : reply.kind === "DONE" ? " Saved-state readback time is not recorded." : ""}`;
}
