import { askSettings } from "./runtime-settings.ts";
import { ASK_GROUNDED_CAP_SETTING } from "./model.ts";
import type { interpretQuestion } from "./interpret.ts";
import { BoundedTtlCache } from "./model-result-cache.ts";
import type { LadderResult } from "./synthesize.ts";

/** Bounds spend per instance per day, the same shape the classifier uses. */
const DAILY_MAX = 400;
let spentOn = "";
let spent = 0;

function ceiling(): number {
  const raw = askSettings()[ASK_GROUNDED_CAP_SETTING];
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : DAILY_MAX;
}

export function allowCall(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (spentOn !== day) {
    spentOn = day;
    spent = 0;
  }
  if (spent >= ceiling()) return false;
  spent += 1;
  return true;
}

type InterpretReadOutcome = Extract<Awaited<ReturnType<typeof interpretQuestion>>, { kind: "READ" }>;
/** Successful model results, keyed by their exact inputs. */
export const interpretationCache = new BoundedTtlCache<InterpretReadOutcome>();
export const synthesisCache = new BoundedTtlCache<LadderResult>();

/** Test seam — the suite must never inherit another test's counter or cached model result. */
export function resetGroundedState(): void {
  spentOn = "";
  spent = 0;
  interpretationCache.clear();
  synthesisCache.clear();
}
