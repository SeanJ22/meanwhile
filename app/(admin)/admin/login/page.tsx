/**
 * This screen never displays which account is enrolled. The break-glass section renders only when
 * `WTP_ADMIN_BREAK_GLASS=enabled`, the same flag that makes its route exist. `why` is a rejection class,
 * never a secret, a token or what was typed.
 */

import {
  ADMIN_SECRET_VAR,
  ADMIN_SESSION_KEY_VAR,
  BREAK_GLASS_FLAG_VAR,
  BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW,
  BREAK_GLASS_WINDOW_SECONDS,
  SESSION_LIFETIME_SECONDS,
  isBreakGlassEnabled,
} from "@/lib/control-plane/admin-auth.ts";

/** Derived from the enforced constant so the two can never drift. */
const SESSION_HOURS = Math.round(SESSION_LIFETIME_SECONDS / 3600);
import { OAUTH_START_PATH, googleSignInReadiness } from "@/lib/control-plane/admin-google.ts";
import { Logo } from "@/components/brand/logo.tsx";
import { GoogleG } from "@/components/brand/google-g.tsx";

const WHY: Record<string, string> = {
  EXPIRED: "Your session expired. Sign in again.",
  BAD_SIGNATURE: "That session could not be verified. Sign in again.",
  MALFORMED: "That session could not be read. Sign in again.",
  ORIGIN: "That request did not come from this page.",
  BAD_STATE: "That sign-in did not start from this page, or took longer than ten minutes. Start again.",
  GOOGLE_DENIED: "Google did not complete the sign-in. Start again if that was not intended.",
  TOKEN_EXCHANGE_FAILED:
    "Google accepted the sign-in but we could not complete it on our side. Try once more; if it repeats, " +
    "the OAuth client's secret or redirect URI on the deploy does not match Google's.",
  BAD_ISSUER: "The identity we received was not issued by Google. Nothing was accepted.",
  BAD_AUDIENCE: "The identity we received was issued for a different application. Nothing was accepted.",
  NOT_YET_VALID: "The identity we received is dated in the future. Nothing was accepted.",
  UNVERIFIED_EMAIL: "Google has not verified the email on that account, so it cannot be the owner. Nothing was accepted.",
  REFUSED: "That secret was not accepted. The attempt was recorded.",
  WEAK_SECRET: "The configured admin secret is too short to be accepted. Set a longer one before using the break-glass.",
  RATE_LIMITED:
    `Too many break-glass attempts in the last ${BREAK_GLASS_WINDOW_SECONDS / 60} minutes. ` +
    "The attempts are recorded. Wait, then try once.",
  INCIDENT_LOG_UNAVAILABLE:
    "The break-glass could not reach the incident log, so it refused. A break-glass that cannot be logged is not " +
    "the break-glass the rules permit.",
};

const STYLE = `
[data-admin-signin] { min-height: 100dvh; display: grid; place-items: center; padding: 32px; box-sizing: border-box;
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse 70% 50% at 50% 0%, rgba(71,81,92,.22), transparent 70%),
    radial-gradient(ellipse 60% 45% at 50% 100%, rgba(207,216,230,.07), transparent 70%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.018) 0 1px, transparent 1px 56px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.018) 0 1px, transparent 1px 56px); }
[data-admin-signin] .signin-stack { display: flex; flex-direction: column; gap: 16px; width: 452px; max-width: 100%; }
[data-admin-signin] .signin-card { position: relative; width: 100%; padding: 40px 38px 34px; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 26px; border-radius: var(--radius-card);
  background-color: var(--panel);
  background-image: radial-gradient(ellipse 120% 100% at 50% 100%, var(--lumen-peak) 0%, var(--lumen-floor) 66%);
  box-shadow: var(--shadow-popup); }
[data-admin-signin] .signin-card::before { content:""; position:absolute; inset:0; border-radius: inherit;
  box-shadow: inset 0 0 0 1px var(--lumen-rim); pointer-events:none; }
[data-admin-signin] .signin-card::after { content:""; position:absolute; left:15%; right:15%; bottom:0; height:1px;
  background: linear-gradient(90deg, transparent, var(--lumen-horizon), transparent); opacity:.22; pointer-events:none; }
[data-admin-signin] .signin-head { display:flex; justify-content:space-between; align-items:center; }
[data-admin-signin] .signin-chip { font: 500 10.5px var(--font-mono); letter-spacing:.08em; text-transform:uppercase;
  color: var(--text-dim); padding: 5px 10px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--lumen-rim); }
[data-admin-signin] .signin-block { display:flex; flex-direction:column; gap:12px; }
[data-admin-signin] .signin-eyebrow { font: 500 11px var(--font-mono); letter-spacing:.08em; text-transform:uppercase; color: var(--text-dim); margin:0; }
[data-admin-signin] .signin-eyebrow[data-tone="refused"] { color: var(--canceled); }
[data-admin-signin] h1.signin-title { margin:0; font: 500 29px var(--font-sans); line-height:1.15; letter-spacing:-.012em; color: var(--text); }
[data-admin-signin] h1.signin-state-title { margin:0; font: 500 19px var(--font-sans); line-height:1.2; color: var(--text); }
[data-admin-signin] .signin-body { margin:0; font: 400 14.5px var(--font-sans); line-height:1.55; color: var(--text-dim); max-width: 44ch; text-wrap: pretty; }
[data-admin-signin] .signin-body.small { font-size: 13.5px; }
[data-admin-signin] .signin-lumen { position: relative; width: 100%; min-height: 52px; border: 0; border-radius: 7px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 12px; overflow: hidden;
  font: 600 15px var(--font-sans); color: var(--text); text-decoration: none;
  background-color: var(--panel);
  background-image: radial-gradient(ellipse 130% 100% at 50% 100%, var(--lumen-peak) 0%, var(--lumen-floor) 66%);
  box-shadow: inset 0 0 0 1px var(--lumen-rim);
  transition: box-shadow var(--dur-slow) var(--ease-move), transform var(--dur-slow) var(--ease-move); }
[data-admin-signin] .signin-lumen::after { content:""; position:absolute; left:15%; right:15%; bottom:0; height:1px;
  background: linear-gradient(90deg, transparent, var(--lumen-horizon), transparent); opacity:.22;
  transition: opacity var(--dur-slow) var(--ease-move); pointer-events:none; }
[data-admin-signin] .signin-lumen:hover { transform: translateY(-1px);
  box-shadow: inset 0 0 0 1px var(--lumen-rim-strong), 0 0 0 1px var(--ring), 0 0 14px var(--link-glow); }
[data-admin-signin] .signin-lumen:hover::after { opacity: 1; }
[data-admin-signin] .signin-lumen:active { transform: translateY(0); transition-duration: var(--dur-base); }
[data-admin-signin] .signin-lumen:focus-visible { outline: none;
  box-shadow: inset 0 0 0 1px var(--lumen-rim-strong), 0 0 0 1px var(--accent-state), 0 0 16px var(--accent-state-glow); }
[data-admin-signin] .signin-rule { height:1px; background: var(--panel-border); border:0; margin:0; }
[data-admin-signin] .signin-foot { display:flex; flex-direction:column; gap:12px; }
[data-admin-signin] .signin-facts { display:flex; flex-wrap:wrap; gap:16px; font: 500 10.5px var(--font-mono);
  letter-spacing:.07em; text-transform:uppercase; color: var(--text-dim); margin:0; }
[data-admin-signin] .signin-note { margin:0; font: 400 13px var(--font-sans); line-height:1.5; color: var(--text-dim); }
[data-admin-signin] .signin-note code { font: 500 12px var(--font-mono); color: var(--text); }
[data-admin-signin] .signin-breakglass { padding: 20px 22px; }
[data-admin-signin] .signin-breakglass h2 { margin:0 0 10px; font: 600 13px var(--font-mono); letter-spacing:.06em; text-transform:uppercase; color: var(--text-dim); }
[data-admin-signin] .signin-breakglass label { display:flex; flex-direction:column; gap:7px; font: 500 10.5px var(--font-mono); letter-spacing:.08em; text-transform:uppercase; color: var(--text-dim); margin-top: 12px; }
[data-admin-signin] .signin-breakglass input { min-height:44px; padding:0 14px; border-radius:7px; border:0;
  background: var(--surface); color: var(--text); font: 400 15px var(--font-sans); box-shadow: inset 0 0 0 1px var(--panel-border); }
[data-admin-signin] .signin-breakglass button { margin-top: 12px; }
@media (prefers-reduced-motion: reduce) {
  [data-admin-signin] .signin-lumen, [data-admin-signin] .signin-lumen::after { transition-duration: 1ms; }
}
@media (max-width: 500px) { [data-admin-signin] { padding: 20px; } }
`;

type SignInState = { readonly eyebrow: string; readonly tone?: "refused"; readonly title: string; readonly body: string; readonly action: string };

function stateFor(why: string | undefined): SignInState | null {
  if (!why) return null;
  if (why === "NO_COOKIE") {
    return {
      eyebrow: "Not signed in",
      title: "No session on this device.",
      body:
        `The control center found no sign-in session, so it sent you here. Sign in with Google to start one — ` +
        `sessions last ${SESSION_HOURS} hours, and after that you sign in again.`,
      action: "Continue with Google",
    };
  }
  if (why === "WRONG_EMAIL") {
    return {
      eyebrow: "REFUSED",
      tone: "refused",
      title: "That account is not enrolled.",
      body: "Google verified the address and the control center refused it.",
      action: "Use another account",
    };
  }
  const message = WHY[why];
  if (!message) return null;
  return { eyebrow: `WHY=${why}`, title: "Sign-in did not complete.", body: message, action: "Try again" };
}

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ why?: string }> }) {
  const { why } = await searchParams;
  const state = stateFor(why);

  // Runtime reads, by name. Names reach the page; values never do.
  const google = googleSignInReadiness(process.env);
  const breakGlass = isBreakGlassEnabled(process.env);
  const breakGlassMissing = [ADMIN_SECRET_VAR, ADMIN_SESSION_KEY_VAR].filter((name) => !process.env[name]);

  return (
    <main data-admin-signin>
      <style>{STYLE}</style>
      <div className="signin-stack">
        <section className="signin-card">
          <div className="signin-head">
            <Logo size={26} />
            <span className="signin-chip">Owner</span>
          </div>

          {state ? (
            <div className="signin-block">
              <p className="signin-eyebrow" data-tone={state.tone}>{state.eyebrow}</p>
              <h1 className="signin-state-title">{state.title}</h1>
              <p className="signin-body small">{state.body}</p>
              <a className="signin-lumen" href={OAUTH_START_PATH} style={{ minHeight: 44 }}>
                {state.action}
              </a>
            </div>
          ) : (
            <div className="signin-block">
              <h1 className="signin-title">Control center</h1>
              <p className="signin-body">Google verifies the address; the control center admits it only if it is enrolled.</p>
              {google.ready ? (
                <a className="signin-lumen" href={OAUTH_START_PATH}>
                  <GoogleG size={19} />
                  Continue with Google
                </a>
              ) : (
                <p className="signin-note">
                  Continue with Google is not configured on this deploy. Not set:{" "}
                  <code>{google.missing.join(", ")}</code>. Until every one is set in the deploy&rsquo;s environment,
                  no one can sign in this way &mdash; including the owner.
                </p>
              )}
            </div>
          )}

          <hr className="signin-rule" />
          <div className="signin-foot">
            <p className="signin-note">This host serves the owner control center only. Every admin route returns 404 on the public site.</p>
            <p className="signin-facts">
              <span>SESSION &middot; {SESSION_HOURS} H</span>
              <span>COOKIE &middot; DEVICE-BOUND</span>
              <span>AUDIT &middot; ON</span>
            </p>
          </div>
        </section>

        {breakGlass && (
          <section className="signin-card signin-breakglass">
            <h2>Break-glass</h2>
            <p className="signin-note">
              <code>{BREAK_GLASS_FLAG_VAR}</code> is <code>enabled</code> on this deploy, so the shared-secret path exists
              right now. Every attempt &mdash; accepted or refused &mdash; is written to the incident log with its class and
              time. At most {BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW} attempts per {BREAK_GLASS_WINDOW_SECONDS / 60} minutes.
              Turn the flag off when the incident is over.
            </p>
            {breakGlassMissing.length > 0 ? (
              <p className="signin-note">
                Not set: <code>{breakGlassMissing.join(", ")}</code>. The break-glass cannot accept anything until these exist.
              </p>
            ) : (
              <form method="post" action="/api/admin/session">
                <label>
                  Admin secret (break-glass)
                  <input type="password" name="secret" autoComplete="current-password" required minLength={24} />
                </label>
                <button type="submit" className="signin-lumen" style={{ minHeight: 44 }}>Use the break-glass</button>
              </form>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
