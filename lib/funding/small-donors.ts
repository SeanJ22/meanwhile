import { shareWords } from "./concentration.ts";

/** A donor whose total for the cycle is this many cents or less is never named. */
export const SMALL_DONOR_CENTS = 20_000;
export const isSmallDonorTotal = (amount: number): boolean => Math.round(amount * 100) <= SMALL_DONOR_CENTS;

/** The one authorized share: dollars from the filing's own individual lines. */
export function smallDonorShare(itemized: number | null, unitemized: number | null): number | null {
  if (typeof itemized !== "number" || typeof unitemized !== "number" || !Number.isFinite(itemized) || !Number.isFinite(unitemized) ||
    itemized < 0 || unitemized < 0 || itemized + unitemized <= 0) return null;
  return unitemized / (itemized + unitemized);
}

export function smallDonorSentence(itemized: number | null, unitemized: number | null): string | null {
  const share = smallDonorShare(itemized, unitemized);
  if (share === null || unitemized === null || itemized === null) return null;
  const amount = "$" + unitemized.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${amount} (${shareWords(unitemized, itemized + unitemized)}) of individual money came from donors giving $200 or less in the cycle.`;
}
