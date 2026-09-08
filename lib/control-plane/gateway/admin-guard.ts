/**
 * **HOST, THEN ORIGIN, THEN SESSION — ONCE, FOR THE GATEWAY'S TWO ROUTES.**
 * (Admin Pass C, ADM-C6.)
 *
 * The admin security sequence is `host -> origin -> session`, in that order,
 * and the order is the design: a request on the public host must 404 before
 * anything reveals that an admin surface exists at all, and a cross-origin
 * request must be refused before a session cookie is even consulted.
 *
 * The four existing admin routes each spell that sequence out inline. This does
 * not change them — they are not this lane's files — and it does not add a
 * fifth and sixth copy either: the gateway's two routes share this one function,
 * which returns a typed VERDICT and builds no response. Keeping the response out
 * of it is what lets one caller answer JSON and the other redirect, without
 * either one re-deriving the check to get the answer it wants.
 *
 * ## The read/write asymmetry is deliberate, not accidental
 *
 * `checkOrigin` is a parameter because the existing read route
 * (`GET /api/admin/release-review`) checks host and session but NOT origin,
 * while every write route checks all three. That asymmetry is correct — an
 * origin check on a GET buys nothing, because a cross-site read cannot see the
 * response anyway — but an asymmetry nobody wrote down is one somebody later
 * "fixes" in the wrong direction. So it is a named argument at every call site.
 *
 * ## Why the handler re-verifies what middleware already checked
 *
 * `middleware.ts` refuses an unauthenticated admin request upstream of every
 * handler. These routes verify again because they are about to write a durable
 * audit record that says *the owner did this*, and a record that says so must
 * be one this process checked rather than one it assumed.
 *
 * SERVER-SIDE, Node runtime. It reads the session key from the environment by
 * NAME and never renders it.
 */

import {
  ADMIN_SESSION_KEY_VAR,
  isAdminHostRequest,
  originAllowed,
  rejectionWords,
  verifySession,
  type SessionRejection,
} from "../admin-auth.ts";
import { ADMIN_ORIGIN } from "../../ops/origins.ts";

export type AdminGuardVerdict =
  | { readonly ok: true; readonly sessionRef: string }
  | {
      readonly ok: false;
      /** 404 hides the surface, 403 refuses the origin, 401 asks for a session. */
      readonly status: 404 | 403 | 401;
      /** The plain sentence the caller may show. Never a class name. */
      readonly says: string;
      /**
       * What the owner can DO about it, when there is something (ADM-49).
       *
       * Separate from `says` because they are different sentences with
       * different lifetimes: what happened is a fact about this request, and
       * what to do is advice that a surface may render as a control. A caller
       * that only has room for one renders `says`.
       */
      readonly whatToDo?: string;
      /**
       * The refusal CLASS, for a log and for a surface that wants to offer the
       * right control. Present only on a 401 — the other two statuses are about
       * the host and the origin, which the owner cannot act on and which must
       * not be described to a caller that should not know the surface exists.
       *
       * **This is the field whose absence was ADM-49.** `verifySession` has
       * always named the reason; nothing carried it past this function, so the
       * console printed the HTTP status instead and the owner read "401" as a
       * verdict on his decision.
       */
      readonly rejection?: SessionRejection;
      /** False when signing in again cannot fix it (a deployment fault). */
      readonly fixedBySigningIn?: boolean;
    };

/**
 * Run the sequence.
 *
 * `cookie` is the raw cookie VALUE, so the caller reads it from wherever its
 * request type keeps cookies, and this function stays free of a framework type.
 */
export async function guardAdminRequest(input: {
  readonly headers: Headers;
  readonly cookie: string | undefined;
  readonly checkOrigin: boolean;
  readonly nowSeconds: number;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<AdminGuardVerdict> {
  if (!isAdminHostRequest(input.headers, ADMIN_ORIGIN)) {
    return { ok: false, status: 404, says: "There is nothing here." };
  }
  if (input.checkOrigin && !originAllowed(input.headers.get("origin"), ADMIN_ORIGIN)) {
    return {
      ok: false,
      status: 403,
      says: "That came from somewhere the console does not accept requests from, so nothing was done.",
    };
  }
  const env = input.env ?? process.env;
  const verdict = await verifySession(input.cookie, env[ADMIN_SESSION_KEY_VAR], input.nowSeconds);
  if (!verdict.ok) {
    /*
     * ADM-49: the class travels. It was always known here and always thrown
     * away, so "You need to be signed in" was told to an owner whose console
     * had no signing key — advice that could not work, given as if it could.
     * The sentence now comes from the class, and `fixedBySigningIn` lets the
     * surface offer a sign-in control only when signing in is the answer.
     */
    const words = rejectionWords(verdict.rejection);
    return {
      ok: false,
      status: 401,
      says: words.says,
      whatToDo: words.whatToDo,
      rejection: verdict.rejection,
      fixedBySigningIn: words.fixedBySigningIn,
    };
  }
  return { ok: true, sessionRef: verdict.session.sid };
}
