/**
 * **THE SAMPLE EXECUTOR — DEVELOPMENT PREVIEW ONLY.**
 *
 * Walks a send through Queued → Read by the workers → Running → one final
 * result, using `sampleOutcome`. Every receipt it produces carries
 * `simulated: true`, and the screens add "(sample)" to its chip. A production
 * page must use `liveExecutor` instead; nothing here is evidence.
 *
 * `forceOutcome` lets the preview's review panel force any of the final results
 * (the prototype's `simulateOutcome` tweak).
 */
import type { Executor } from "../executor.ts";
import type { ReceiptStatus, UiReceipt } from "../model.ts";
import { STATUS_WORDS } from "../receipts.ts";
import { sampleCheck, sampleOutcome, type SampleOutcome, type SampleWorld } from "./world.ts";

export type ForcedOutcome = "natural" | "done" | "partial" | "refused" | "failed" | "unknown";

const FORCED_SAYS: Readonly<Record<Exclude<ForcedOutcome, "natural">, string>> = {
  done: "Done (forced in the review panel).",
  partial: "Partly done (forced in the review panel).",
  refused: "Refused: the system wouldn’t do this. Nothing changed.",
  failed: "Failed: something broke while doing it. Nothing changed. You can try again.",
  unknown: "No answer within 30 seconds. It may still have run. Check what happened before trying again.",
};

export function sampleExecutor(opts: {
  readonly names: (id: string) => string;
  readonly applyEffect: (effect: (w: SampleWorld) => SampleWorld) => void;
  readonly forced: () => ForcedOutcome;
  /** Milliseconds per step. The tests pass 0. */
  readonly stepMs?: number;
}): Executor {
  const step = opts.stepMs ?? 900;
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const at = () => new Date().toISOString();
  const finish = (r: UiReceipt, o: SampleOutcome, label: string): UiReceipt => ({
    ...r,
    status: o.final,
    statusWords: o.statusWords ?? STATUS_WORDS[o.final],
    steps: [...r.steps, { label, at: at() }],
    says: o.says,
    items: o.items ?? [],
    lifecycle: o.final === "done" || o.final === "partial" ? { ...r.lifecycle, workFinished: at() } : r.lifecycle,
  });
  return {
    mode: "sample",
    supports: () => true,
    canCheck: () => true,
    async send(receipt, request, update) {
      let r: UiReceipt = { ...receipt, lifecycle: { ...receipt.lifecycle, saved: at() } };
      update(r);
      await wait(step);
      r = { ...r, status: "read", statusWords: STATUS_WORDS.read, steps: [...r.steps, { label: "Read by the workers", at: at() }], says: "The workers read it.", lifecycle: { ...r.lifecycle, workersReceived: at() } };
      update(r);
      await wait(step);
      r = { ...r, status: "running", statusWords: STATUS_WORDS.running, steps: [...r.steps, { label: "Running", at: at() }], says: "Running.", lifecycle: { ...r.lifecycle, workStarted: at() } };
      update(r);
      await wait(step * 1.3);
      const natural = sampleOutcome(request.def.kind, request.target, { option: request.option, words: request.words, amount: request.amount, selected: request.selectedItems }, { names: opts.names });
      const forced = opts.forced();
      const o: SampleOutcome = forced === "natural" ? natural : { final: forced as Exclude<ReceiptStatus, "queued" | "read" | "running">, says: FORCED_SAYS[forced], effect: forced === "done" ? natural.effect : undefined };
      update(finish(r, o, STATUS_WORDS[o.final]));
      if ((o.final === "done" || o.final === "partial") && o.effect) opts.applyEffect(o.effect);
    },
    check(receipt, _def, update) {
      return (async () => {
        let r: UiReceipt = { ...receipt, status: "read", statusWords: "Checking", steps: [...receipt.steps, { label: "Checking what happened", at: at() }], says: "Asking the workers what happened. Nothing is sent again." };
        update(r);
        await wait(step * 1.5);
        const o = sampleCheck(receipt.kind);
        r = finish(r, o, "Done (checked)");
        update(r);
      })();
    },
  };
}
