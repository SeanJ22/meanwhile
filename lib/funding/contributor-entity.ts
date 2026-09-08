import type { ContributorGroup } from "./grouping.ts";
import type { CommitteeTypeLabel } from "./committee-types.ts";

export interface ContributorEntityExplanation {
  text: string;
  sourceLabel: string;
  sourceUrl: string;
}

const KNOWN_PLATFORMS: Readonly<Record<string, ContributorEntityExplanation>> = {
  ACTBLUE: {
    text: "ActBlue is a nonprofit digital fundraising platform used by Democratic campaigns and organizations.",
    sourceLabel: "ActBlue",
    sourceUrl: "https://www.actblue.com/about/",
  },
  WINRED: {
    text: "WinRed is fundraising technology used by conservative and Republican campaigns and committees.",
    sourceLabel: "WinRed",
    sourceUrl: "https://winred.com/about",
  },
};

/**
 * A reader-facing answer to “what is this entity?” Exact named-platform
 * records are sourced to the platform itself; every other answer stays on
 * the FEC's filed category and never infers an industry from a name.
 */
export function contributorEntityExplanation(
  group: ContributorGroup,
  typeLabel: CommitteeTypeLabel | null,
  filedLabel: string | null,
): ContributorEntityExplanation | null {
  const exactName = group.contributorName.trim().toUpperCase().replace(/\s+/g, " ");
  const platformKey =
    exactName === "ACTBLUE" || exactName === "ACTBLUE TECHNICAL SERVICES"
      ? "ACTBLUE"
      : exactName === "WINRED" ||
          exactName === "WINRED TECHNICAL SERVICES" ||
          exactName === "WINRED TECHNICAL SERVICES LLC"
        ? "WINRED"
        : null;
  const known = platformKey ? KNOWN_PLATFORMS[platformKey] : null;
  if (known) return known;

  if (typeLabel) {
    return {
      text: firstSentence(typeLabel.explainer),
      sourceLabel: "FEC definition",
      sourceUrl: typeLabel.sourceUrl,
    };
  }

  if (!filedLabel || group.kind === "INDIVIDUAL") return null;
  return {
    text: `The FEC filing identifies this contributor as ${filedLabel}.`,
    sourceLabel: "FEC filing",
    sourceUrl: "https://www.fec.gov/data/receipts/",
  };
}

function firstSentence(text: string): string {
  const stop = text.indexOf(". ");
  return stop === -1 ? text : text.slice(0, stop + 1);
}
