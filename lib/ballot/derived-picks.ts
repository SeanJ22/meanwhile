import type { StoredPick } from "./picks.ts";

export interface PickResolution {
  chosen: string[];
  basis: "EXPLICIT" | "DERIVED" | "NONE";
  conflicting: string[];
  asks: boolean;
}

/** A derived pick is computed at render and never written; an explicit pick always outranks it, and a Yes elsewhere is a conflict to surface, never an overwrite. */
export function resolvePick(
  explicit: StoredPick | null,
  yesChoiceIds: readonly string[],
  voteFor: number,
): PickResolution {
  const yes = [...new Set(yesChoiceIds)];
  const picked = explicit?.choiceIds ?? [];

  if (picked.length > 0) {
    return {
      chosen: picked,
      basis: "EXPLICIT",
      conflicting: yes.filter((id) => !picked.includes(id)),
      asks: false,
    };
  }

  if (yes.length >= 1 && yes.length <= Math.max(1, voteFor)) {
    return { chosen: yes, basis: "DERIVED", conflicting: [], asks: false };
  }

  if (yes.length > Math.max(1, voteFor)) {
    return { chosen: [], basis: "NONE", conflicting: yes, asks: true };
  }

  return { chosen: [], basis: "NONE", conflicting: [], asks: true };
}

export const DERIVED_PICK_LINE =
  "You said you'd vote for them, so we've marked this as your pick. Change it any time.";

export function conflictLine(
  chosenLabels: readonly string[],
  otherLabels: readonly string[],
): string {
  if (chosenLabels.length === 0) {
    return `You said you'd vote for ${list(otherLabels)}. That's more than this race elects — pick the one you want on your ballot.`;
  }
  return `Your pick here is ${list(chosenLabels)}, and you also said you'd vote for ${list(otherLabels)}. We haven't changed anything — pick the one you want.`;
}

function list(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
