/**
 * **THE "CONTROLS CHANGED" WAKE HINT.** After an Admin action has been durably
 * applied, the one writer (`submit()` in `gateway.ts`) overwrites a single small
 * object in the runner's Blobs destination. The runner polls that object's etag
 * (cheap) and re-reads the Postgres controls only when it changes.
 *
 * ```
 *   store   WTP_VAULT_STORE (default "meanwhile-evidence"), the destination the
 *           runner already uses; opened with WTP_BLOBS_SITE_ID + WTP_BLOBS_TOKEN
 *   key     control/wake-hint.json        (one object, overwritten every time)
 *   body    { format: "controls-wake@1", receiptId, actionType, at }
 * ```
 *
 * It is a notification, never a record and never a gate: the receipt in
 * Postgres is the truth. A failed or slow write leaves the action's result
 * exactly as it was and costs the runner nothing it did not already do (it still
 * re-reads on its own slow clock). Replaying an applied action writes the hint
 * again, so a retry is how a missed hint is made up.
 */
import type { ActionReceipt } from "./contract.ts";

export const WAKE_HINT_KEY = "control/wake-hint.json";
export const WAKE_HINT_FORMAT = "controls-wake@1";
export const WAKE_HINT_TIMEOUT_MS = 1_500;
export const DEFAULT_WAKE_STORE = "meanwhile-evidence";

export interface WakeHint {
  readonly format: typeof WAKE_HINT_FORMAT;
  readonly receiptId: string;
  readonly actionType: string;
  readonly at: string;
}

export type WakeHintWriter = (hint: WakeHint) => Promise<void>;

export function wakeHintOf(receipt: Pick<ActionReceipt, "receiptId" | "type">, at: string): WakeHint {
  return { format: WAKE_HINT_FORMAT, receiptId: receipt.receiptId, actionType: receipt.type, at };
}

/** The Blobs writer, or null when the host has no Blobs destination configured (nothing to wake). */
export function wakeHintWriterFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): WakeHintWriter | null {
  if (env.WTP_VAULT_PROVIDER !== "netlify") return null;
  const siteID = env.WTP_BLOBS_SITE_ID?.trim();
  const token = env.WTP_BLOBS_TOKEN?.trim();
  if (!siteID || !token) return null;
  const name = env.WTP_VAULT_STORE?.trim() || DEFAULT_WAKE_STORE;
  return async (hint) => {
    const { getStore } = await import("@netlify/blobs");
    await getStore({ name, siteID, token, consistency: "strong" }).set(WAKE_HINT_KEY, JSON.stringify(hint));
  };
}

/** Write the hint without ever throwing and without waiting past the timeout. */
export async function sendWakeHint(writer: WakeHintWriter | null | undefined, hint: WakeHint): Promise<boolean> {
  if (!writer) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      writer(hint),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("wake hint timed out")), WAKE_HINT_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
