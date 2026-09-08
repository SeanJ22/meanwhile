/**
 * **ONE SHAPE FOR "THE CONSOLE REFUSED", AND ONE READER FOR IT.**
 * (ADM-49, the 9.7.26 admin feedback. Critical. RULING 103, RULING 262.)
 *
 * ## The instance
 *
 * The owner typed *"I did rule on this — that picture is approved"* on NH166,
 * clicked **Record my answer**, and the queue told him:
 *
 * > *Not recorded — … The server answered 401. Nothing was written, so the row
 * > is still waiting on you.*
 *
 * He read the red dot as **"Not approved"** and could not see how the console
 * had decided that. It had not decided anything. It had been refused, it had
 * been told exactly why, and it printed a three-digit number instead.
 *
 * ## The class
 *
 * The sentence was not the bug; the SHAPE was. One refusal was leaving the
 * server in four different bodies —
 *
 * ```
 *   middleware.ts                    { error, rejection }
 *   /api/admin/action                { ok: false, says }
 *   /api/admin/live                  { says }
 *   /api/admin/deploy-preview        { error }
 * ```
 *
 * — and three clients were each guessing at a different one, so every one of
 * them fell through to the status code:
 *
 * ```
 *   decisions.tsx     receipt?.says ?? `The server answered ${res.status}…`
 *   deploy-fleet.tsx  receipt?.says ?? `Nothing was sent. The server answered ${res.status}.`
 *   deploy-fleet.tsx  throw `…the server answered ${res.status}`
 *   live-refresh.tsx  throw `…the server answered ${res.status}`
 * ```
 *
 * Four producers and four consumers agreeing on nothing is not four bugs. It is
 * one missing contract, which is why this module is the fix and a better
 * fallback string would not have been: RULING 262 — the fix closes the class.
 *
 * ## Why one module rather than a server one and a client one
 *
 * The producer and the reader are the two halves of one comparison, and RULING
 * 103 is explicit that those live together. Two modules would drift the first
 * time a field was added to one and not the other, and the failure would be
 * silent — a field the client looks for and the server stopped sending reads
 * exactly like a server that never sent it.
 *
 * PURE. No clock, no store, no framework, no environment. Import-free except
 * for the rejection vocabulary it is total over, so `middleware.ts` can use it
 * on the Edge runtime where `node:` builtins do not exist.
 */

import { rejectionWords, type SessionRejection } from "./admin-auth.ts";

/**
 * The one body an admin surface sends when it refuses before doing anything.
 *
 * `says` and `error` carry the SAME sentence. That is a deliberate alias, not a
 * duplicate: three shipped consumers already read `error` or `says`, and this
 * change is not allowed to break a caller in order to tidy a field name. New
 * code reads `says`.
 */
export interface AdminRefusalBody {
  /** Always false, so a caller can branch on the body rather than the status. */
  readonly ok: false;
  /** What happened, in the owner's words. Never a class name, never a number. */
  readonly says: string;
  /** Compatibility alias for `says` — shipped consumers read this name. */
  readonly error: string;
  /** What the owner can do about it, when there is something. */
  readonly whatToDo?: string;
  /** The refusal class, for a log and for choosing a control. 401 only. */
  readonly rejection?: SessionRejection;
  /** False when signing in again cannot fix it (a deployment fault). */
  readonly fixedBySigningIn?: boolean;
}

/** Build the one body from the parts every refusal site already has. */
export function adminRefusalBody(input: {
  readonly says: string;
  readonly whatToDo?: string;
  readonly rejection?: SessionRejection;
  readonly fixedBySigningIn?: boolean;
}): AdminRefusalBody {
  return {
    ok: false,
    says: input.says,
    error: input.says,
    ...(input.whatToDo === undefined ? {} : { whatToDo: input.whatToDo }),
    ...(input.rejection === undefined ? {} : { rejection: input.rejection }),
    ...(input.fixedBySigningIn === undefined ? {} : { fixedBySigningIn: input.fixedBySigningIn }),
  };
}

/** What a client decided to tell the owner, and which control to offer. */
export interface ReadRefusal {
  /** The sentence to show. Always non-empty. */
  readonly says: string;
  /** The follow-up sentence, when one is known. */
  readonly whatToDo: string | null;
  /** Offer a sign-in control: the refusal is one signing in actually fixes. */
  readonly offerSignIn: boolean;
  /** Offer a retry: the request may succeed unchanged on a second attempt. */
  readonly offerRetry: boolean;
  /** The class, when the server named one. For a disclosure, never the face. */
  readonly rejection: SessionRejection | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRejection(value: unknown): value is SessionRejection {
  return (
    value === "NO_COOKIE" ||
    value === "MALFORMED" ||
    value === "BAD_SIGNATURE" ||
    value === "EXPIRED" ||
    value === "NOT_CONFIGURED"
  );
}

/**
 * Resolve a non-OK response into something the owner can act on.
 *
 * The order is most-specific first, and every step is a real case that has been
 * observed rather than defensive padding:
 *
 * ```
 *   1  the server's own sentence          says / error
 *   2  the class, translated              rejection  (middleware's shape)
 *   3  a refusal that is not JSON at all  a platform/CDN 401 in front of us
 *   4  the status, named honestly         nothing else is known
 * ```
 *
 * Step 3 matters and is the reason `contentType` is a parameter. When a proxy,
 * an SSO layer or a CDN refuses in front of the application, the body is an
 * HTML page and `res.json()` throws — which every one of the three clients was
 * swallowing into `catch (() => null)` and then reporting as the same bare
 * status. That case is not "you are signed out"; it is "something in front of
 * the console refused", and telling the owner to sign in again would send him
 * round a loop that cannot end.
 *
 * Step 4 still names the status, because a number the owner can read out is
 * better than a shrug — but it is now the LAST answer rather than the first.
 */
export function readRefusal(input: {
  readonly status: number;
  readonly body: unknown;
  readonly contentType?: string | null;
}): ReadRefusal {
  const body = (input.body ?? null) as Record<string, unknown> | null;
  const rejection = body !== null && isRejection(body.rejection) ? body.rejection : null;
  const words = rejection === null ? null : rejectionWords(rejection);

  const said = body === null ? null : (text(body.says) ?? text(body.error));
  const toDo = body === null ? null : text(body.whatToDo);

  /*
   * A 401 whose body is not JSON did not come from this application: every
   * refusal path here answers JSON. Something in front of it refused.
   */
  const jsonish = (input.contentType ?? "").toLowerCase().includes("json");
  if (input.status === 401 && body === null && !jsonish) {
    return {
      says: "Something in front of the console refused this before it reached the console itself, so nothing was written.",
      whatToDo: "Reload the page. If it keeps happening, the sign-in is being refused upstream and signing in again will not clear it.",
      offerSignIn: false,
      offerRetry: true,
      rejection: null,
    };
  }

  /*
   * THE CLASS OUTRANKS THE SENTENCE, and that ordering is the whole point.
   *
   * It looks backwards — the server's own words ought to win — until you look
   * at what the shipped middleware actually sends:
   *
   *     { error: "authentication required", rejection: "EXPIRED" }
   *
   * `error` there is MACHINE SPEECH. A reader that preferred it would render
   * "authentication required" to an owner who has been told, for three
   * sessions, that the console does not explain itself. The class is a closed
   * union whose words are written FOR him, so a body that names one has already
   * told us the best available sentence, whatever else it carries.
   *
   * A caller that wants its own wording simply omits the class; a caller that
   * sends both is sending the same fact twice, which is what ours does. The
   * body's own `whatToDo` still wins over the class's, because that is the
   * field a caller would add context to.
   *
   * (Caught by this module's own test: the old-shape case asserted "run out"
   * and got "authentication required".)
   */
  if (words !== null) {
    return {
      says: words.says,
      whatToDo: toDo ?? words.whatToDo,
      offerSignIn:
        typeof body?.fixedBySigningIn === "boolean" ? body.fixedBySigningIn : words.fixedBySigningIn,
      offerRetry: false,
      rejection,
    };
  }

  if (said !== null) {
    return {
      says: said,
      whatToDo: toDo,
      // No class to fall back on, so do not offer a door we cannot say is right.
      offerSignIn: typeof body?.fixedBySigningIn === "boolean" ? body.fixedBySigningIn : false,
      offerRetry: input.status >= 500,
      rejection,
    };
  }

  return {
    says: `The console was refused and nothing was written. The server answered ${input.status} and did not say why.`,
    whatToDo: "Nothing you typed has been lost. Try once more, and if it happens again say so — a refusal with no reason is itself a defect.",
    offerSignIn: false,
    offerRetry: true,
    rejection: null,
  };
}
