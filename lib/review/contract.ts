import { STAGING_RENDER_ORIGIN } from "../ops/origins.ts";

/** Public software-review contract. Never a civic-data approval interface. */
export const REVIEW_CONTRACT_VERSION = 1;
export const RAISED_STATE_CANDIDATES = [
  { id: "A_SOFT_LIFT", label: "A — Soft Lift" },
  { id: "B_MATERIAL_LIFT", label: "B — Material Lift" },
  { id: "C_DEEP_LIFT", label: "C — Deep Lift" },
] as const;
export type RaisedStateCandidate = typeof RAISED_STATE_CANDIDATES[number]["id"];

export function reviewUrl(parameters: Record<string, string>, path = "/"): string {
  const url = new URL(path, STAGING_RENDER_ORIGIN);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}

export const REVIEW_SECTIONS = [
  { id: "map-movement", name: "Map movement", url: reviewUrl({ zip: "85701", review: "map" }) },
  { id: "pearl", name: "Pearl interactive pills", url: reviewUrl({ zip: "85701", review: "pearl" }) },
  { id: "lumen", name: "Lumen popup family + theme parity", url: reviewUrl({ zip: "85701", review: "lumen", popup: "district", theme: "dark" }) },
  { id: "raised-state", name: "Raised state", url: reviewUrl({ zip: "85701", review: "raised-state" }) },
  { id: "theme", name: "Theme behavior", url: reviewUrl({ zip: "85701", review: "theme" }) },
] as const;

export const LUMEN_REVIEW_EXAMPLES = [
  { id: "district", name: "District" },
  { id: "school", name: "School district" },
  { id: "body", name: "Governing body" },
  { id: "meeting", name: "Meeting" },
  { id: "official", name: "Official" },
].map(example => ({ ...example,
  dark: reviewUrl({ zip: "85701", review: "lumen", popup: example.id, theme: "dark" }),
  light: reviewUrl({ zip: "85701", review: "lumen", popup: example.id, theme: "light" }),
}));

export const STAGING_OWNERSHIP = {
  prompt3: ["test", "Netlify staging deployment", "reader components", "visual code", "/api/release-manifest", "visual proof"],
  prompt4: ["Fleet/runtime/research/control-plane work", "method learning", "civic promotion pipeline"],
  baselineChangeProtocol: "Notify Prompt 3 before a main merge changes the reader/staging dependency set or reviewed baseline. Prompt 3 integrates and re-proves the exact staging SHA before changing the review target.",
} as const;
