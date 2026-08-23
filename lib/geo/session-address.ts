/**
 * **RULING 74 — AN ADDRESS, ONCE GIVEN, IS NEVER ASKED FOR TWICE.**
 * (NJ Hunt 3 item 3.6b, 2026-08-22.)
 *
 * Wherever a reader supplies an address — the who-governs surface, the
 * polling-place surface, the ballot, anywhere — it persists for the rest of
 * that SESSION and resolves every surface that could have used it. Asking twice
 * for the same fact is a frustration the product manufactures itself, and it
 * reads as a product that is not paying attention.
 *
 * ## WHAT IS STORED, EXACTLY, AND WHERE
 *
 * This is the part that matters most, so it is stated plainly rather than
 * implied by the code:
 *
 * - **Nothing reaches the server, and nothing reaches disk.** No column on the
 *   search log, no column on the reactions store, no row anywhere. The
 *   collection minimum in `CLAUDE.md` is unchanged by this file — it adds no
 *   field to the user model and creates no table.
 * - **The storage is `sessionStorage`**, which the browser clears when the tab
 *   closes. Not `localStorage`, which survives; not a cookie, which would be
 *   sent to the server on every request and would therefore reach access logs.
 * - **The street address itself is NEVER written.** What is written is the
 *   RESOLVED OUTCOME: the contest ids the point produced, and a short label the
 *   reader typed for their own recognition. The house number is used for one
 *   request and discarded, exactly as `ballot-narrowing.tsx` already discarded
 *   it. A resolved contest list cannot be walked back to a house.
 * - **The coordinates are not written either.** They are the one derived value
 *   that would locate a home, and no surface needs them after the contest list
 *   exists.
 *
 * The claim that survives a hostile reader is *the schemas share no joinable
 * column* — which is architecture, not a policy promise. A session-scoped
 * resolution keeps that claim exactly as it is, because it never becomes a row.
 *
 * ## Why a resolved list rather than the address
 *
 * Because re-resolving would mean re-asking the geocoder on every surface, and
 * because storing the thing that identifies a person in order to avoid asking
 * for it twice would trade a small friction for the exact retention this
 * product refuses. The outcome is the useful part; the input is the sensitive
 * part; only the outcome is kept.
 */

/** The one key. Named so it is greppable and so nothing else claims it. */
export const SESSION_ADDRESS_KEY = "wtp.session_address_scope";

export interface SessionAddressScope {
  /** The zip the address was resolved inside. */
  zip: string;
  /** Contest ids on the ballot at that point. The whole payload's value. */
  contestIds: string[];
  /** What the reader typed for the street, for their own recognition only. */
  streetLabel: string;
  /**
   * The division ids the address CONFIRMED, across every level that resolved.
   *
   * Added for WGH-5 (2026-08-22). The scope used to carry contests only, which
   * meant the who-governs card and the meeting pill could not use it — they ask
   * about jurisdictions, not about a ballot. One address, resolved once, now
   * answers for every surface. RULING 74 is the reason: an address, once given,
   * is never asked for twice, and "never asked twice" was only true of the one
   * surface that happened to store its own answer.
   */
  divisionIds: string[];
  /**
   * Levels the street genuinely crosses, so a surface can keep hedging exactly
   * those rows and nothing else. Partial ambiguity resolves partially.
   */
  splitLevels: string[];
  /** When it was resolved, so a surface can say "you told us this" honestly. */
  resolvedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Private modes and embedded webviews can throw on access rather than
    // return null. A store we cannot reach means no session address, which is
    // the same as never having been given one — never an error to the reader.
    return null;
  }
}

/** Read the session's resolved address scope, or null. Never throws. */
export function readSessionAddress(): SessionAddressScope | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_ADDRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionAddressScope>;
    if (
      typeof parsed.zip !== "string" ||
      !Array.isArray(parsed.contestIds) ||
      typeof parsed.resolvedAt !== "string"
    ) {
      return null;
    }
    return {
      zip: parsed.zip,
      contestIds: parsed.contestIds.filter((id): id is string => typeof id === "string"),
      divisionIds: Array.isArray(parsed.divisionIds)
        ? parsed.divisionIds.filter((id): id is string => typeof id === "string")
        : [],
      splitLevels: Array.isArray(parsed.splitLevels)
        ? parsed.splitLevels.filter((id): id is string => typeof id === "string")
        : [],
      streetLabel: typeof parsed.streetLabel === "string" ? parsed.streetLabel : "",
      resolvedAt: parsed.resolvedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Write it. Called once, by whichever surface the reader happened to use.
 *
 * `resolvedAt` is taken from the browser's clock rather than passed in: this is
 * a client-side fact about the reader's own session, not a stamp entering a
 * document, so the date rule in `CLAUDE.md` — which governs dates written into
 * this repo's records — is not what is in play here. Nothing here is a record.
 */
export function writeSessionAddress(scope: Omit<SessionAddressScope, "resolvedAt">): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      SESSION_ADDRESS_KEY,
      JSON.stringify({ ...scope, resolvedAt: new Date().toISOString() }),
    );
  } catch {
    /* A full or refused store costs the reader a second prompt, never an error. */
  }
}

/** Forget it. The reader asking to see the whole zip again is asking for this. */
export function clearSessionAddress(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SESSION_ADDRESS_KEY);
  } catch {
    /* Nothing to do and nothing to say. */
  }
}

/**
 * Does the session hold an address that answers for THIS zip?
 *
 * A reader who resolved an address in 07866 and then looks at 03255 has not
 * answered anything about 03255, and treating the two as one would be the
 * product asserting a location the reader never gave it.
 */
export function sessionAddressFor(zip: string | null): SessionAddressScope | null {
  if (!zip) return null;
  const scope = readSessionAddress();
  return scope && scope.zip === zip ? scope : null;
}
