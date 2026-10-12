/**
 * The one place an admin test session is minted: the admin and public hosts, a signed session
 * cookie, and save-and-restore of the signing key. Not a test file.
 */
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  SESSION_LIFETIME_SECONDS,
  signSession,
} from "@/lib/control-plane/admin-auth.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN, hostOf } from "@/lib/ops/origins.ts";

/** The host the admin console answers on. Everything else must 404. */
export const ADMIN_HOST = hostOf(ADMIN_ORIGIN);

/** The reader's host, where every admin path must be invisible. */
export const PUBLIC_HOST = hostOf(PUBLIC_SITE_ORIGIN);

/**
 * A signing key for tests only. Long enough to satisfy the real signer's
 * minimum, and obviously not a secret — a short key would fail for the wrong
 * reason and teach a future reader that the length check is optional.
 */
export const SESSION_KEY = "test-session-key-that-is-long-enough-to-sign-with";

/** A `Cookie` header carrying a validly signed, unexpired admin session. */
export async function adminSessionCookie(): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const value = await signSession({ sid: "adm_test-session", iat, exp: iat + SESSION_LIFETIME_SECONDS }, SESSION_KEY);
  return `${ADMIN_SESSION_COOKIE}=${value}`;
}

/**
 * Run `fn` with the session-signing key installed in the environment, and put
 * the environment back exactly as it was — including deleting the variable
 * again when it was unset, which is not the same as setting it to "".
 */
export async function withAdminSessionKey<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env[ADMIN_SESSION_KEY_VAR];
  process.env[ADMIN_SESSION_KEY_VAR] = SESSION_KEY;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[ADMIN_SESSION_KEY_VAR];
    else process.env[ADMIN_SESSION_KEY_VAR] = before;
  }
}
