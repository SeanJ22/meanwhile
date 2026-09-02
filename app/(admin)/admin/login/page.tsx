/**
 * The admin login. (Session C final, ITEM H, 2026-09-01.)
 *
 * A plain HTML form POSTing to `/api/admin/session`. Deliberately plain:
 *
 *   - **POST, so the secret is in the request BODY.** A GET would put it in the
 *     query string, where it is written to every access log on every hop, kept
 *     in browser history, and sent in the `Referer` of the next request. The
 *     constitution forbids sensitive data in query strings outright and this is
 *     the archetype of why.
 *   - **No JavaScript.** Nothing reads the field, nothing stores it, nothing
 *     transmits it anywhere but the one POST. There is no client component here
 *     to accidentally put the value in state, in `localStorage`, or in a
 *     telemetry breadcrumb.
 *   - `autoComplete="current-password"` so a password manager fills it, which
 *     is the way this secret should be handled.
 *
 * `why` is a REJECTION CLASS from middleware — `EXPIRED`, `BAD_SIGNATURE`,
 * `NO_COOKIE`, `NOT_CONFIGURED` — never the secret and never what was typed.
 */

const WHY: Record<string, string> = {
  NO_COOKIE: "You are not signed in.",
  EXPIRED: "Your session expired. Sign in again.",
  BAD_SIGNATURE: "That session could not be verified. Sign in again.",
  MALFORMED: "That session could not be read. Sign in again.",
  NOT_CONFIGURED:
    "This deploy has no admin session key configured, so no session can be issued. " +
    "That is a fact about our configuration, not about your credentials.",
  REFUSED: "That secret was not accepted.",
  WEAK_SECRET:
    "The configured admin secret is too short to be accepted. Set a longer one before signing in.",
  ORIGIN: "That request did not come from this page.",
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ why?: string }>;
}) {
  const { why } = await searchParams;
  const message = why ? (WHY[why] ?? "Sign in to continue.") : null;

  return (
    <main className="admin">
      <h1>Control centre</h1>
      {message && <p className="note">{message}</p>}
      <form method="post" action="/api/admin/session">
        <label>
          Admin secret
          <input
            type="password"
            name="secret"
            autoComplete="current-password"
            required
            minLength={24}
          />
        </label>
        <button type="submit">Sign in</button>
      </form>
      <p className="note">
        This host serves the owner control centre only. Every admin route returns 404 on the public
        site.
      </p>
    </main>
  );
}
