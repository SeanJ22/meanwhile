/**
 * **ONE PLACE MINTS AN ADMIN TEST SESSION.** (RULING 103.)
 *
 * Every guard that drives an admin route has to answer the same two questions
 * before it can ask its own: which host is the admin host, and what does a
 * signed session cookie look like. Six suites had each answered them for
 * themselves — the same two constants, the same cookie minter, the same
 * save-and-restore of the signing key around a block. Four of those copies were
 * byte-identical, which is how `tests/duplicate-implementations.test.ts` found
 * them.
 *
 * The reason that matters here is sharper than tidiness. These helpers encode
 * the SHAPE OF AN ADMIN SESSION — the claim set, the lifetime, the cookie name.
 * If the real session gains a field, six copies drift one at a time, and a
 * suite still passing against last month's shape is worse than a suite that
 * fails: it is a guard reporting that a boundary holds when nobody checked the
 * boundary that ships. One definition means the next change to a session breaks
 * every guard at once, which is the correct blast radius.
 *
 * The per-file `request()` builders are deliberately NOT here. They take
 * different arguments because they drive different routes, and collapsing them
 * into one variadic helper would trade a real difference for a false one.
 *
 * NOT a test file: no `test()` calls, so `tests/guard-census.json` counts no
 * guards here.
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
