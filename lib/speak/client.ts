import { getOrCreateBrowserKey } from "../state/browser-key.ts";

/**
 * **BC-11 — the browser half of Speak Your Mind.**
 *
 * ## The continuity key gets its OWN storage key, and that is not a detail
 *
 * `NH79` consolidated the minting into `lib/state/browser-key.ts` and recorded
 * the near-miss that made it worth writing down: sharing one module-level
 * fallback cell between two callers would have made the feedback key and the
 * reaction key THE SAME VALUE for any browser that refuses `localStorage` —
 * two identifier-free stores holding one identical browser-minted value are
 * two stores that join.
 *
 * This is the third caller. `wtp.speak_key` is its own string holding its own
 * independently random value, and the shared module's per-storage-key `Map`
 * keeps the fallback path apart too. Server-side the value is hashed under its
 * own prefix as well (`lib/db/speak.ts`), so the boundary holds at both ends
 * rather than at one.
 */

const KEY_STORAGE = "wtp.speak_key";

export function getOrCreateSpeakKey(): string {
  return getOrCreateBrowserKey(KEY_STORAGE);
}

/** BAL-19 (2026-08-25): a CANDIDATE is not an OFFICIAL. See `lib/db/schema.ts`. */
export type SpeakSubjectType = "OFFICIAL" | "BODY" | "MEETING" | "CANDIDATE";

/**
 * What the surface may tell the reader afterwards.
 *
 * **A submission never silently succeeds into a void** — the render-default
 * rule applied to a write, which a boolean cannot carry: `false` would have to
 * mean both "there is no database, which is an ordinary demo state" and "the
 * write failed", and those deserve different sentences.
 */
export type SpeakResult = "RECORDED" | "NOT_STORED" | "REFUSED" | "FAILED";

export interface SpeakContext {
  /** Where the map is looking, so the row can be district-stamped server-side. */
  lat?: number | null;
  lng?: number | null;
}

export async function submitSpeakYourMind(
  subjectType: SpeakSubjectType,
  subjectId: string,
  text: string,
  context?: SpeakContext,
): Promise<SpeakResult> {
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subjectType,
        subjectId,
        text,
        speakKey: getOrCreateSpeakKey(),
        lat: context?.lat ?? null,
        lng: context?.lng ?? null,
      }),
      keepalive: true,
    });
    if (response.status === 204) return "RECORDED";
    // Accepted but nothing kept — a demo with no database. Honest, not a
    // success, and the surface must not thank anybody for it.
    if (response.status === 202) return "NOT_STORED";
    if (response.status === 429 || response.status === 503) return "REFUSED";
    return "FAILED";
  } catch {
    return "FAILED";
  }
}
