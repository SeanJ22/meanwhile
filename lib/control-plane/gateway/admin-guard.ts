/**
 * Order matters: host (a public-host request 404s), then origin, then session.
 * Read routes pass `checkOrigin: false` on purpose; a cross-site GET cannot read the response.
 */

import {
  ADMIN_SESSION_KEY_VAR,
  isAdminHostRequest,
  originAllowed,
  verifySession,
} from "../admin-auth.ts";
import { ADMIN_ORIGIN } from "../../ops/origins.ts";

/** A localhost origin is accepted only outside a production build. */
const LOCAL_DEV_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;

export function localDevOriginAllowed(origin: string | null, env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV !== "production" && origin !== null && LOCAL_DEV_ORIGIN.test(origin);
}

export type AdminGuardVerdict =
  | { readonly ok: true; readonly sessionRef: string }
  | {
      readonly ok: false;
      readonly status: 404 | 403 | 401;
      readonly says: string;
    };

/** `cookie` is the raw cookie value, not the header. */
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
  const env = input.env ?? process.env;
  if (
    input.checkOrigin &&
    !originAllowed(input.headers.get("origin"), ADMIN_ORIGIN) &&
    !localDevOriginAllowed(input.headers.get("origin"), env)
  ) {
    return {
      ok: false,
      status: 403,
      says: "That came from somewhere the console does not accept requests from, so nothing was done.",
    };
  }
  const verdict = await verifySession(input.cookie, env[ADMIN_SESSION_KEY_VAR], input.nowSeconds);
  if (!verdict.ok) {
    return { ok: false, status: 401, says: "You need to be signed in for this. Nothing was done." };
  }
  return { ok: true, sessionRef: verdict.session.sid };
}
