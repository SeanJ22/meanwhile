/**
 * **WHO CARRIES A SENT ACTION OUT.**
 *
 * The screens never decide an outcome. They hand a send to an `Executor` and
 * render whatever receipt it reports. Two executors exist:
 *
 *   live    posts to the deployed `/api/admin/action` (the only state-changing
 *           door) with a caller-minted idempotency key, and folds the saved
 *           receipt into the view. It never retries on its own. The gateway
 *           type is the control's fixed mapping (runner pause/resume) or the
 *           type the backend announces on the pulse (contract.ts).
 *   sample  lives under ./sample/ and is used only by the development preview
 *           and tests; every receipt it makes is marked `simulated`.
 *
 * `check` is "Check what happened": it asks without sending the action again,
 * through the announced read-only receipt lookup. Until one is announced it
 * returns null and the screen explains why.
 */
import type { ActionDef } from "./actions.ts";
import { actionInput, RECEIPT_LOOKUP_CONTRACT, supportedAction, type V6Capabilities } from "./contract.ts";
import type { UiReceipt } from "./model.ts";
import { applyGatewayReply } from "./receipts.ts";

export interface SendRequest {
  readonly def: ActionDef;
  readonly target: string;
  readonly scopeKey: string;
  readonly option: string | null;
  readonly words: string;
  readonly amount: string;
  readonly selectedItems: readonly string[];
  readonly payload?: Readonly<Record<string, string>>;
}

export interface Executor {
  readonly mode: "live" | "sample";
  /** Does something real carry this action out right now? */
  supports(def: ActionDef): boolean;
  /** Carry out one send; call `update` with each new state of the receipt. */
  send(receipt: UiReceipt, request: SendRequest, update: (next: UiReceipt) => void): Promise<void>;
  /** Can "Check what happened" ask right now, without sending again? */
  canCheck(): boolean;
  /** Ask what happened to an unknown result without repeating it, or null when nothing can be asked. */
  check(receipt: UiReceipt, def: ActionDef, update: (next: UiReceipt) => void): Promise<void> | null;
}

export const ACTION_ROUTE = "/api/admin/action";

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export function liveExecutor(opts: {
  readonly capabilities: () => V6Capabilities | null;
  /** The latest pulse revision, quoted when an announced action requires the rendered state. */
  readonly stateVersion?: () => string | null;
  readonly fetch?: Fetch;
  readonly now?: () => string;
}): Executor {
  const doFetch: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? (() => new Date().toISOString());
  const gatewayFor = (def: ActionDef) => {
    if (def.gateway) return { type: def.gateway.type, requiresStateVersion: false };
    const a = supportedAction(opts.capabilities(), def.kind);
    return a ? { type: a.type, requiresStateVersion: a.requiresStateVersion } : null;
  };
  return {
    mode: "live",
    supports: (def) => gatewayFor(def) !== null,
    canCheck: () => opts.capabilities()?.receiptLookup?.contract === RECEIPT_LOOKUP_CONTRACT,
    async send(sent, request, update) {
      let receipt = sent;
      const gw = gatewayFor(request.def);
      if (!gw) {
        update({ ...receipt, status: "refused", statusWords: "Not sent", steps: [...receipt.steps, { label: "Not sent", at: now() }],
          says: `Not sent. Nothing in the system can carry this out yet. ${request.def.dependency?.need ?? ""}`.trim() });
        return;
      }
      const stateVersion = gw.requiresStateVersion ? opts.stateVersion?.() ?? null : null;
      if (gw.requiresStateVersion && stateVersion === null) {
        update({ ...receipt, status: "refused", statusWords: "Not sent", steps: [...receipt.steps, { label: "Not sent", at: now() }],
          says: "Not sent. This action needs the current state of the page, and no live update has arrived yet. Wait for “Live”, then try again." });
        return;
      }
      const input = actionInput(request.def.kind, { target: request.target, scopeKey: request.scopeKey, option: request.option, words: request.words, amount: request.amount, selected: request.selectedItems, payload: request.payload });
      const body = { type: gw.type, subject: request.target, stateVersion, idempotencyKey: receipt.key, ...input };
      receipt = { ...receipt, gatewayType: gw.type };
      let status: number | null = null;
      let parsed: unknown = null;
      try {
        const res = await doFetch(ACTION_ROUTE, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
        status = res.status;
        parsed = await res.json().catch(() => null);
      } catch {
        status = null;
      }
      update(applyGatewayReply(receipt, request.def, status, parsed, now()));
    },
    check(receipt, def, update) {
      const lookup = opts.capabilities()?.receiptLookup;
      if (!lookup || lookup.contract !== RECEIPT_LOOKUP_CONTRACT) return null;
      return (async () => {
        update({ ...receipt, steps: [...receipt.steps, { label: "Checking what happened", at: now() }], says: "Asking what happened. Nothing is sent again." });
        let status: number | null = null;
        let body: unknown = null;
        try {
          const type = receipt.gatewayType ?? def.gateway?.type ?? supportedAction(opts.capabilities(), def.kind)?.type ?? "";
          const res = await doFetch(`${lookup.href}?type=${encodeURIComponent(type)}&key=${encodeURIComponent(receipt.key)}`, { method: "GET", headers: { accept: "application/json" } });
          status = res.status;
          body = await res.json().catch(() => null);
        } catch {
          status = null;
        }
        const r = (body as { contract?: unknown; receipt?: unknown } | null);
        if (status === 200 && r?.contract === RECEIPT_LOOKUP_CONTRACT && r.receipt === null) {
          update({ ...receipt, status: "failed", statusWords: "Not saved", steps: [...receipt.steps, { label: "Checked: never saved", at: now() }],
            says: "Checked: the earlier send never reached the gateway, so nothing happened. You can send it again." });
          return;
        }
        if (status === 200 && r?.contract === RECEIPT_LOOKUP_CONTRACT && r.receipt) {
          update(applyGatewayReply(receipt, def, 200, { ok: (r.receipt as { outcome?: string }).outcome !== "REFUSED", receipt: r.receipt, replayed: true }, now()));
          return;
        }
        update({ ...receipt, steps: [...receipt.steps, { label: "Check didn’t answer", at: now() }], says: "The check didn’t get an answer. The result is still unknown. Don’t send it again yet; try checking later." });
      })();
    },
  };
}
