import { getOrCreateBrowserKey } from "../state/browser-key.ts";

/**
 * The browser half of Speak Your Mind. The continuity key has its own storage
 * key and its own random value, so it never equals the feedback or reaction
 * key (two identifier-free stores holding one value would join). The server
 * hashes it under its own prefix too (`lib/db/speak.ts`).
 */

const KEY_STORAGE = "wtp.speak_key";

export function getOrCreateSpeakKey(): string {
  return getOrCreateBrowserKey(KEY_STORAGE);
}

/** A CANDIDATE is not an OFFICIAL. See `lib/db/schema.ts`. */
export type SpeakSubjectType = "OFFICIAL" | "BODY" | "MEETING" | "CANDIDATE";

/**
 * What the surface may tell the reader afterwards. "No database" (a demo) and
 * "the write failed" deserve different sentences, so this is not a boolean.
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
    // Accepted but nothing kept (no database): not a success.
    if (response.status === 202) return "NOT_STORED";
    if (response.status === 429 || response.status === 503) return "REFUSED";
    return "FAILED";
  } catch {
    return "FAILED";
  }
}
