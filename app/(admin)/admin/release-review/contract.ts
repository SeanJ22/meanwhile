/**
 * **THE SOFTWARE RELEASE REVIEW'S OWN CONSTANTS.** (Admin Pass B, 2026-09-06.)
 *
 * The Admin CONSUMES Prompt 3's release manifest and never defines it. What
 * lives here is what the master brief makes law regardless of what any
 * manifest enumerates — the five required review sections and the three
 * Raised State variants — plus the two URLs the Admin reads (the manifest and
 * production's build identity), the page's own paths, and the cache horizon.
 *
 * Nothing here is a civic fact. This reviews a BUILD.
 */
import { PUBLIC_SITE_ORIGIN, STAGING_RENDER_ORIGIN } from "@/lib/ops/origins.ts";
import { RAISED_STATE_CHOICES, type RaisedStateChoice } from "@/lib/control-plane/software-release-review.ts";

/** Prompt 3's live manifest on the staging deploy. Read only; never modified here. */
export const MANIFEST_URL = `${STAGING_RENDER_ORIGIN}/api/release-manifest`;
/** The staging review page, rendered as a plain anchor. */
export const REVIEW_PAGE_URL = `${STAGING_RENDER_ORIGIN}/review`;
/** Production's existing build-identity endpoint, the fallback source for the production SHA. */
export const PRODUCTION_BUILD_URL = `${PUBLIC_SITE_ORIGIN}/api/build`;

export const HERE = "/admin/release-review";
export const WRITE_ROUTE = "/api/admin/release-review";

/** Seconds a manifest reading is reused before it is fetched again; "refresh manifest" bypasses it. */
export const MANIFEST_CACHE_SECONDS = 15;
export const PRODUCTION_CACHE_SECONDS = 30;
/** How long a fetch may take before the manifest counts as unreachable. */
export const FETCH_TIMEOUT_MS = 8_000;
export const FEEDBACK_MAX_CHARS = 2_000;

/**
 * The manifest status value that makes a SHA review-ready. The source on
 * `test` (lib/review/release-manifest.ts) emits `prompt3Status` and
 * `reviewState`; both are read, `prompt3Status` first, and the composite keys
 * on either reading exactly this value. The brief names it; the observed
 * contract does not emit it yet (VISUAL_WORK_IN_PROGRESS at observation).
 */
export const REVIEW_READY_STATUS = "READY_FOR_REVIEW";

/**
 * Optional: the name of an environment variable carrying a Cookie header for
 * staging's password gate (the manifest answered 401 "Password Protection" at
 * observation). Read by NAME; the value is sent to the staging origin only and
 * is never rendered or logged. Absent, the Admin simply reports the 401.
 */
export const STAGING_MANIFEST_COOKIE_VAR = "WTP_STAGING_MANIFEST_COOKIE";

export interface RequiredSection {
  readonly id: string;
  /** The section as the master brief names it. */
  readonly name: string;
  /** Manifest section ids and names (lower-cased) that reconcile to this required section. */
  readonly matches: readonly string[];
}

/** The five required sections, law regardless of what the manifest enumerates. */
export const REQUIRED_SECTIONS: readonly RequiredSection[] = [
  { id: "map-movement", name: "Map Movement", matches: ["map-movement", "map movement", "map"] },
  { id: "pearl", name: "Pearl", matches: ["pearl", "pearl interactive pills"] },
  { id: "lumen", name: "Lumen", matches: ["lumen", "lumen popup family + theme parity"] },
  { id: "theme", name: "Theme", matches: ["theme", "theme behavior", "theme behaviour"] },
  { id: "raised-state", name: "Raised State A/B/C", matches: ["raised-state", "raised state", "raised state a/b/c"] },
];
export const RAISED_STATE_SECTION_ID = "raised-state";

export const RAISED_STATE_LABEL: Record<RaisedStateChoice, string> = {
  A_SOFT_LIFT: "A — Soft Lift",
  B_MATERIAL_LIFT: "B — Material Lift",
  C_DEEP_LIFT: "C — Deep Lift",
};

export function isRaisedStateChoice(value: string): value is RaisedStateChoice {
  return (RAISED_STATE_CHOICES as readonly string[]).includes(value);
}

/** A full 40-hex git SHA, or nothing. Never a guess. */
export function fullSha(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value) ? value : null;
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 8) : "—";
}
