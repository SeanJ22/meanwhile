import { fnv } from "./fnv.ts";

/** The retry key covers every field that can change the saved scope decision. */
export function scopeSendKey(input: {
  readonly type: string; readonly geoid: string; readonly version: string;
  readonly priority: number; readonly budgetUsd: number;
  readonly huntBudget: boolean; readonly newHunt: boolean;
  readonly note: string; readonly questions: readonly string[];
}, nonce: string): string {
  return `scope:${input.geoid}:${fnv(JSON.stringify(input))}:${nonce}`;
}

/** An uncertain response keeps its nonce so a retry can retrieve one receipt. */
export function actionSettled(outcome: string): boolean {
  return outcome === "DONE" || outcome === "REFUSED";
}
