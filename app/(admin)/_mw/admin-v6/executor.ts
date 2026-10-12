/**
 * A saved request is not a done request: after a send the live executor keeps asking the receipt lookup,
 * without sending again, until the runner's record confirms the action or a final state arrives.
 */
import { scheduledWhen, type OrderWhen } from "./order-when.ts";
import type { ActionDef } from "./actions.ts";
import { actionInput, RECEIPT_LOOKUP_CONTRACT, supportedAction, type V6Capabilities } from "./contract.ts";
import type { UiReceipt } from "./model.ts";
import { applyConfirmation, applyGatewayReply, confirmationOf, isOpen } from "./receipts.ts";

export interface SendRequest {
  readonly def: ActionDef;
  readonly target: string;
  readonly scopeKey: string;
  readonly option: string | null;
  readonly words: string;
  readonly amount: string;
  readonly selectedItems: readonly string[];
  readonly when?: OrderWhen;
  readonly payload?: Readonly<Record<string, string>>;
}

export interface Executor {
  readonly mode: "live" | "sample";
  supports(def: ActionDef): boolean;
  send(receipt: UiReceipt, request: SendRequest, update: (next: UiReceipt) => void): Promise<void>;
  canCheck(): boolean;
  check(receipt: UiReceipt, def: ActionDef, update: (next: UiReceipt) => void): Promise<void> | null;
  dispose?(): void;
}

/** How often an open receipt asks the runner's record: quickly at first, then calmly. */
export function followUpDelayMs(asked: number): number {
  if (asked < 30) return 3_000; // the first 90 seconds
  if (asked < 30 + 56) return 15_000; // then calmly
  return 60_000; // an open order keeps asking until the runner takes it or it is taken back
}

export const ACTION_ROUTE = "/api/admin/action";

type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export function liveExecutor(opts: {
  readonly capabilities: () => V6Capabilities | null;
  readonly stateVersion?: () => string | null;
  readonly fetch?: Fetch;
  readonly now?: () => string;
  /** Wait between follow-up asks; injected so tests do not sleep. */
  readonly wait?: (ms: number) => Promise<void>;
}): Executor {
  const doFetch: Fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const now = opts.now ?? (() => new Date().toISOString());
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** Bumped by dispose(): a loop started before it stops, and one started after it (a remount) runs. */
  let epoch = 0;
  /** One follow-up loop per receipt key, so a re-render or a second check never doubles the asking. */
  const following = new Set<string>();
  const lookupUrl = (receipt: UiReceipt, def: ActionDef): string | null => {
    const lookup = opts.capabilities()?.receiptLookup;
    if (!lookup || lookup.contract !== RECEIPT_LOOKUP_CONTRACT) return null;
    const type = receipt.gatewayType ?? def.gateway?.type ?? supportedAction(opts.capabilities(), def.kind)?.type ?? "";
    return `${lookup.href}?type=${encodeURIComponent(type)}&key=${encodeURIComponent(receipt.key)}`;
  };
  const follow = (first: UiReceipt, def: ActionDef, update: (next: UiReceipt) => void): void => {
    if (!isOpen(first) || following.has(first.key)) return;
    following.add(first.key);
    const mine = epoch;
    void (async () => {
      let current = first;
      try {
        for (let asked = 0; epoch === mine && isOpen(current); asked += 1) {
          const delay = followUpDelayMs(asked);
          await wait(delay);
          const url = lookupUrl(current, def);
          if (epoch !== mine || url === null) return;
          try {
            const res = await doFetch(url, { method: "GET", headers: { accept: "application/json" } });
            const body = res.status === 200 ? await res.json().catch(() => null) : null;
            const confirmation = confirmationOf(body);
            if (confirmation !== null) {
              const next = applyConfirmation(current, confirmation, now());
              if (next !== current) { current = next; update(next); }
            }
          } catch {
            /* a missed ask is asked again */
          }
        }
      } finally {
        following.delete(first.key);
      }
    })();
  };
  const gatewayFor = (def: ActionDef) => {
    if (def.gateway) return { type: def.gateway.type, requiresStateVersion: def.gateway.requiresStateVersion === true };
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
          says: "Not sent." });
        return;
      }
      const stateVersion = gw.requiresStateVersion ? opts.stateVersion?.() ?? null : null;
      if (gw.requiresStateVersion && stateVersion === null) {
        update({ ...receipt, status: "refused", statusWords: "Not sent", steps: [...receipt.steps, { label: "Not sent", at: now() }],
          says: "Not sent. Waiting for Live." });
        return;
      }
      const input = actionInput(request.def.kind, { target: request.target, scopeKey: request.scopeKey, option: request.option, words: request.words, amount: request.amount, selected: request.selectedItems, payload: request.payload });
      const timing = request.when ? scheduledWhen(request.when,now()) : null;
      const effectiveType = timing ? "orders.schedule" : gw.type;
      const body = timing ? {type:effectiveType,subject:request.target,stateVersion:null,idempotencyKey:receipt.key,input:{orderType:gw.type,subject:request.target,input,...timing}} : { type: gw.type, subject: request.target, stateVersion, idempotencyKey: receipt.key, ...input };
      receipt = { ...receipt, gatewayType: effectiveType,finishBy:timing?.finishBy??null };
      let status: number | null = null;
      let parsed: unknown = null;
      try {
        const res = await doFetch(ACTION_ROUTE, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
        status = res.status;
        parsed = await res.json().catch(() => null);
      } catch {
        status = null;
      }
      const settled = applyGatewayReply(receipt, request.def, status, parsed, now());
      update(settled);
      if(request.when?.mode==="now" && status===200 && (parsed as {ok?:boolean}|null)?.ok===true && gw.type!=="runner.runCycleNow") {
        // A separate idempotent wake order preserves pauses and spending controls.
        await doFetch(ACTION_ROUTE,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({type:"runner.runCycleNow",subject:"us",note:null,idempotencyKey:`${receipt.key.slice(0,110)}-start-now`})}).catch(()=>undefined);
      }
      follow(settled, request.def, update);
    },
    dispose() {
      epoch += 1;
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
          const answered = applyGatewayReply(receipt, def, 200, { ok: (r.receipt as { outcome?: string }).outcome !== "REFUSED", receipt: r.receipt, replayed: true, confirmation: (body as { confirmation?: unknown }).confirmation }, now());
          update(answered);
          follow(answered, def, update);
          return;
        }
        update({ ...receipt, steps: [...receipt.steps, { label: "Check didn’t answer", at: now() }], says: "The check didn’t get an answer. The result is still unknown. Don’t send it again yet; try checking later." });
      })();
    },
  };
}
