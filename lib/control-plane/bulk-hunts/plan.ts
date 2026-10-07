/**
 * Budgets for a bulk send. There is no pooled budget across hunts, so "one
 * budget for all" is a total divided evenly, each share rounded down to the
 * cent so the total is never exceeded.
 *
 * ```
 *   split   a total for everything, divided evenly between the hunts
 *   same    the same amount for each hunt
 *   each    a budget for each hunt; a hunt with none named gets the default
 * ```
 *
 * Pure.
 */
import { SCOPE_BUDGET_MAX_USD } from "../expansion/scopes.ts";
import { BULK_MAX_ZIPS } from "./parse.ts";

export type BudgetSpec =
  | { readonly mode: "split"; readonly totalUsd: number }
  | { readonly mode: "same"; readonly eachUsd: number }
  | { readonly mode: "each"; readonly defaultUsd: number; readonly byZip: Readonly<Record<string, number>> };

export interface PlanItem {
  readonly zip: string;
  readonly budgetUsd: number;
}

export type PlanResult =
  | {
      readonly ok: true;
      readonly items: readonly PlanItem[];
      readonly totalUsd: number;
      /** One plain sentence saying how the budget was worked out. */
      readonly words: string;
    }
  | { readonly ok: false; readonly why: string };

const cents = (usd: number): number => Math.round(usd * 100);
const usdOf = (c: number): number => c / 100;
const money = (usd: number): string => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function amount(raw: unknown, what: string): { readonly ok: true; readonly usd: number } | { readonly ok: false; readonly why: string } {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false, why: `${what} has to be a dollar amount of $0 or more` };
  return { ok: true, usd: n };
}

export function planBudgets(zips: readonly string[], spec: BudgetSpec): PlanResult {
  if (zips.length === 0) return { ok: false, why: "there are no ZIPs to send hunts to" };
  if (zips.length > BULK_MAX_ZIPS) return { ok: false, why: `that is ${zips.length.toLocaleString("en-US")} ZIPs; one send takes at most ${BULK_MAX_ZIPS.toLocaleString("en-US")}` };
  let items: PlanItem[];
  let words: string;
  if (spec.mode === "split") {
    const total = amount(spec.totalUsd, "the total budget");
    if (!total.ok) return total;
    const share = Math.floor(cents(total.usd) / zips.length);
    items = zips.map((zip) => ({ zip, budgetUsd: usdOf(share) }));
    words = `${money(total.usd)} shared evenly: ${money(usdOf(share))} for each of ${zips.length.toLocaleString("en-US")} hunts.`;
  } else if (spec.mode === "same") {
    const each = amount(spec.eachUsd, "the budget for each hunt");
    if (!each.ok) return each;
    items = zips.map((zip) => ({ zip, budgetUsd: Math.round(each.usd * 100) / 100 }));
    words = `${money(each.usd)} for each of ${zips.length.toLocaleString("en-US")} hunts.`;
  } else {
    const fallback = amount(spec.defaultUsd, "the default budget");
    if (!fallback.ok) return fallback;
    const items2: PlanItem[] = [];
    for (const zip of zips) {
      const named = spec.byZip[zip];
      const one = amount(named === undefined ? fallback.usd : named, `the budget for ${zip}`);
      if (!one.ok) return one;
      items2.push({ zip, budgetUsd: Math.round(one.usd * 100) / 100 });
    }
    items = items2;
    const own = zips.filter((z) => spec.byZip[z] !== undefined).length;
    words = `Each hunt has its own budget: ${own.toLocaleString("en-US")} named, ${(zips.length - own).toLocaleString("en-US")} at the default ${money(fallback.usd)}.`;
  }
  const over = items.find((i) => i.budgetUsd > SCOPE_BUDGET_MAX_USD);
  if (over) return { ok: false, why: `the budget for ${over.zip} is above the ${money(SCOPE_BUDGET_MAX_USD)} maximum a hunt may have` };
  const totalUsd = usdOf(items.reduce((sum, i) => sum + cents(i.budgetUsd), 0));
  return { ok: true, items, totalUsd, words };
}
