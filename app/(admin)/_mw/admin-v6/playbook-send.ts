import type { PlaybookSend } from "./playbook-editor.tsx";
import type { ActionOutcome } from "@/lib/control-plane/gateway/contract.ts";

export async function savePlaybook(send: PlaybookSend, idempotencyKey: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl("/api/admin/action", { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...send, subject: send.role, idempotencyKey, returnTo: "/admin?view=settings" }) });
  const result = await response.json() as ActionOutcome;
  if (!response.ok || !result.ok || !["DONE", "QUEUED"].includes(result.receipt.outcome)) {
    throw new Error(result.receipt?.says ?? "The instructions could not be saved. Try again.");
  }
  return result.receipt.says;
}
