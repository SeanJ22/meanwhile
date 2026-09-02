/**
 * The admin login. (Session C final, ITEM H, 2026-09-01. Sign in with Google,
 * RULING 245, 2026-09-02.)
 *
 * One link: **Sign in with Google.** It is a plain `<a>` to the start route —
 * no JavaScript, nothing read, nothing stored. The owner's identity is proven
 * by Google and verified server-side against the one enrolled address
 * (`lib/control-plane/admin-google.ts`).
 *
 * The secret form is gone from the surface. It renders in exactly one state:
 * when the owner has set `WTP_ADMIN_BREAK_GLASS=enabled` on the deploy, which
 * is the same flag that makes the route exist at all. Then it appears under a
 * notice saying every attempt is logged as an incident, because that is true.
 *
 * Configuration is read at render, by name, so a deploy missing a variable
 * says which one — a fact about our configuration, never a 500 and never a
 * door that opens because a check read `undefined`.
 *
 * `why` is a REJECTION CLASS — from middleware, from the Google callback, or
 * from the break-glass — never the secret, never a token, never what was typed.
 */

import {
  ADMIN_SECRET_VAR,
  ADMIN_SESSION_KEY_VAR,
  BREAK_GLASS_FLAG_VAR,
  BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW,
  BREAK_GLASS_WINDOW_SECONDS,
  isBreakGlassEnabled,
} from "@/lib/control-plane/admin-auth.ts";
import { OAUTH_START_PATH, googleSignInReadiness } from "@/lib/control-plane/admin-google.ts";

const WHY: Record<string, string> = {
  NO_COOKIE: "You are not signed in.",
  EXPIRED: "Your session expired. Sign in again.",
  BAD_SIGNATURE: "That session could not be verified. Sign in again.",
  MALFORMED: "That session could not be read. Sign in again.",
  NOT_CONFIGURED:
    "This deploy is missing a variable that sign-in needs, so no session can be issued. " +
    "The names are listed below. That is a fact about our configuration, not about you.",
  ORIGIN: "That request did not come from this page.",
  // Sign in with Google.
  BAD_STATE:
    "That sign-in did not start from this page, or took longer than ten minutes. Start again.",
  GOOGLE_DENIED: "Google did not complete the sign-in. Start again if that was not intended.",
  TOKEN_EXCHANGE_FAILED:
    "Google accepted the sign-in but we could not complete it on our side. Try once more; " +
    "if it repeats, the OAuth client's secret or redirect URI on the deploy does not match Google's.",
  BAD_ISSUER: "The identity we received was not issued by Google. Nothing was accepted.",
  BAD_AUDIENCE: "The identity we received was issued for a different application. Nothing was accepted.",
  NOT_YET_VALID: "The identity we received is dated in the future. Nothing was accepted.",
  UNVERIFIED_EMAIL:
    "Google has not verified the email on that account, so it cannot be the owner. Nothing was accepted.",
  WRONG_EMAIL:
    "That Google account is not the enrolled owner. Only one address is allowed in, and this is not it.",
  // The break-glass.
  REFUSED: "That secret was not accepted. The attempt was recorded.",
  WEAK_SECRET:
    "The configured admin secret is too short to be accepted. Set a longer one before using the break-glass.",
  RATE_LIMITED:
    `Too many break-glass attempts in the last ${BREAK_GLASS_WINDOW_SECONDS / 60} minutes. ` +
    "The attempts are recorded. Wait, then try once.",
  INCIDENT_LOG_UNAVAILABLE:
    "The break-glass could not reach the incident log, so it refused. A break-glass that cannot " +
    "be logged is not the break-glass the rules permit.",
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ why?: string }>;
}) {
  const { why } = await searchParams;
  const message = why ? (WHY[why] ?? "Sign in to continue.") : null;

  // Runtime reads, by name. Names reach the page; values never do.
  const google = googleSignInReadiness(process.env);
  const breakGlass = isBreakGlassEnabled(process.env);
  const breakGlassMissing = [ADMIN_SECRET_VAR, ADMIN_SESSION_KEY_VAR].filter(
    (name) => !process.env[name],
  );

  return (
    <main className="admin">
      <h1>Control centre</h1>
      {message && <p className="note">{message}</p>}

      {google.ready ? (
        <p>
          <a
            href={OAUTH_START_PATH}
            style={{
              display: "inline-block",
              padding: ".6rem 1.1rem",
              border: "1px solid currentColor",
              borderRadius: ".4rem",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Sign in with Google
          </a>
        </p>
      ) : (
        <div className="refusal">
          <p>
            <strong>Sign in with Google is not configured on this deploy.</strong>
          </p>
          <p className="note">
            Not set: <code>{google.missing.join(", ")}</code>. Until every one of these is set in
            the deploy&rsquo;s environment, no one can sign in this way &mdash; including the owner.
          </p>
        </div>
      )}
      <p className="note">
        Only the enrolled owner address is admitted. Any other Google account is refused after
        Google verifies it, and nothing is stored about it.
      </p>

      {breakGlass && (
        <section className="card">
          <h2>Break-glass</h2>
          <p className="note">
            <code>{BREAK_GLASS_FLAG_VAR}</code> is set to <code>enabled</code> on this deploy, so
            the shared-secret path exists right now. Every attempt on it &mdash; accepted or refused
            &mdash; is written to the incident log with its class and time. At most{" "}
            {BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW} attempts per {BREAK_GLASS_WINDOW_SECONDS / 60}{" "}
            minutes. Turn the flag off when the incident is over.
          </p>
          {breakGlassMissing.length > 0 ? (
            <p className="note">
              Not set: <code>{breakGlassMissing.join(", ")}</code>. The break-glass cannot accept
              anything until these exist.
            </p>
          ) : (
            <form method="post" action="/api/admin/session">
              <label>
                Admin secret (break-glass)
                <input
                  type="password"
                  name="secret"
                  autoComplete="current-password"
                  required
                  minLength={24}
                />
              </label>
              <button type="submit">Use the break-glass</button>
            </form>
          )}
        </section>
      )}

      <p className="note">
        This host serves the owner control centre only. Every admin route returns 404 on the public
        site.
      </p>
    </main>
  );
}
