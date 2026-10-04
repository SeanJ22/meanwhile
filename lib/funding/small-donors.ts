import { shareWords } from "./concentration.ts";

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
