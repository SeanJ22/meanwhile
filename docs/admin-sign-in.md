# Admin sign-in — Sign in with Google, and the break-glass

*(RULING 245, 2026-09-02. Operative code: `lib/control-plane/admin-google.ts`,
`lib/control-plane/admin-auth.ts`, `app/(admin)/admin/auth/google/route.ts`,
`app/(admin)/admin/auth/callback/route.ts`, `app/api/admin/session/route.ts`,
`app/(admin)/admin/login/page.tsx`, `middleware.ts`. Seeded failures:
`tests/admin-google-signin.test.ts`. Live readback: `pnpm admin:login-readback`.)*

> Administrative access to Meanwhile's owner surfaces authenticates the owner's
> identity through Sign in with Google for exactly the enrolled owner address
> (sean@meanwhileusa.com), verified server-side. Shared secrets are not a login
> path except as a documented, rate-limited, incident-logged break-glass held by
> the owner under RULING 238. — RULING 245

The control centre at `https://admin.meanwhileusa.com` no longer asks for a
secret. It asks Google who you are, checks the answer itself, and admits
exactly one address. Everything else about the admin host is unchanged: every
admin path is 404 on the public site, and the session cookie a successful
sign-in issues is the same `__Host-wtp-admin` cookie as before.

---

## What the owner must do before the first sign-in works

The code is deployed with this head. It cannot admit anyone until two
variables exist on the Netlify site. Read back on 2026-09-02 from the Netlify
environment API for site `sparkwtp`: **neither is set, on any site or at the
account level**, so the deployed login page will say so by name until they are.

### 1. The OAuth client, on Google's side

Google Cloud Console → *APIs & Services* → *Credentials* → the OAuth 2.0 Client
ID of type **Web application** that was created for this. Under **Authorized
redirect URIs** there must be exactly:

```
https://admin.meanwhileusa.com/admin/auth/callback
```

No trailing slash, `https`, the `admin.` host. Google compares this byte for
byte with what our start route sends, and our start route builds it from
`ADMIN_ORIGIN` (`lib/ops/origins.ts`) plus `OAUTH_CALLBACK_PATH` — never from
the incoming request — so the two cannot drift unless one is edited by hand.

*Authorized JavaScript origins* is not needed: this is the server-side
authorization-code flow with PKCE; no token ever reaches the browser.

The consent screen may be *Internal* (Workspace accounts only) or *External*.
It does not matter for authorization — the server admits only the one enrolled
address whatever the consent screen allows — but *Internal* means a stranger
cannot even reach Google's chooser with our client id.

### 2. The two variables, on Netlify's side — custody first

RULING 238: a provider that masks a credential after creation makes the
plaintext unrecoverable, so **an owner copy goes into `.env.local` BEFORE the
value is installed in Netlify**, and the event is reported by name.

| Variable | Value | Where it goes first | Netlify context | Netlify scope |
| --- | --- | --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | the client id ending `.apps.googleusercontent.com` | `.env.local` | **Production** | **Functions** |
| `GOOGLE_OAUTH_CLIENT_SECRET` | the client secret | `.env.local` | **Production** | **Functions** |

Netlify UI: *Site configuration → Environment variables → Add a variable*.
Choose *Different value for each deploy context* only if a staging client is
ever created; otherwise one production value is right. Scope: **Functions** is
the scope the route handlers run under (`runtime = "nodejs"`); *Builds* is not
needed and would only widen exposure. The session key `WTP_ADMIN_SESSION_KEY`,
already present, is also required — it signs the ten-minute OAuth state cookie
as well as the session.

Then append one line per variable to `data/ops/credential-events.jsonl` (the
shape is `lib/ops/credential-report.ts`; the session report gate refuses a
record missing any field):

```json
{"kind":"CREATED","reportedAt":"<pnpm stamp>","name":"GOOGLE_OAUTH_CLIENT_SECRET","provider":"Google Cloud Console (OAuth 2.0 client, Web application)","context":"Netlify site sparkwtp, production","scope":"functions","actor":"owner","ownerCopyLocation":".env.local (GOOGLE_OAUTH_CLIENT_SECRET)"}
```

**The value never enters chat, a prompt, a log, a commit, a fixture, a
screenshot, or a command-line argument.** Paste it into the Netlify form and
into `.env.local`, and nowhere else.

### 3. Confirm the deploy sees them

```bash
pnpm admin:login-readback
```

`PASS` means the start route 302s to `accounts.google.com` with PKCE and the
`__Host-wtp-oauth` cookie, the callback refuses a state it did not issue, and
both routes 404 on the public host. `COULD_NOT_TELL` (exit 2) with the
variable names means the deploy still reports `NOT_CONFIGURED` — nothing is
wrong with the code; the variables are not where the functions can read them.
The login page says the same thing in the browser, naming what is not set.

---

## The live proof — the owner's own step

The readback cannot sign in as the owner. This can only be done once, by the
owner, in a browser, and it is the proof RULING 245 asks for:

1. Open `https://admin.meanwhileusa.com/admin`. Expect the login page
   (`why=NO_COOKIE`) with one control: **Sign in with Google**.
2. Click it. Google's chooser opens filtered to the `meanwhileusa.com`
   workspace. Choose **sean@meanwhileusa.com**.
3. Expect to land on `/admin` — *Pilot health* renders, no redirect, no `why`.
4. Open `/admin/research`. Expect it to render with the same session.
5. If a second Google account is to hand, sign out (any admin page's sign-out,
   or clear the cookie) and repeat with the other account. Expect
   `/admin/login?why=WRONG_EMAIL` and no session — that account is refused
   *after* Google verified it, and nothing about it is stored.
6. Run `pnpm admin:login-readback` once more so the record in
   `data/ops/admin-login-readback.json` carries the same head the owner signed
   in on. The record holds hop statuses, redirect classes, and cookie NAMES and
   ATTRIBUTES. No cookie value, no token, no email.

Report the result in reader terms in the session log: *the owner reached the
control centre by identity, not by secret, on `<deploy sha>`*.

---

## How the sign-in works, hop by hop

| Hop | Route | What is checked | On failure |
| --- | --- | --- | --- |
| 1 | `GET /admin/auth/google` | admin host (404 otherwise); `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `WTP_ADMIN_SESSION_KEY` present | 303 to `/admin/login?why=NOT_CONFIGURED` |
| 2 | Google | the owner picks an account; Google issues a one-time `code` to the registered redirect URI | Google sends `error=` |
| 3 | `GET /admin/auth/callback` | admin host; the `__Host-wtp-oauth` cookie is present, signed by our key, under ten minutes old; its `state` equals the query `state` (constant-time); no `error`; a `code` is present | 303 to `/admin/login?why=BAD_STATE` / `GOOGLE_DENIED` / `MALFORMED` |
| 4 | server → Google | the code is exchanged for an ID token with the client secret and the PKCE verifier | `TOKEN_EXCHANGE_FAILED` |
| 5 | server | signature RS256 by the Google key named by `kid` (JWKS fetched from Google, cached per `max-age`, one refetch on a miss); `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}; `aud` = our client id; `exp` not past (60 s skew); `iat` not future; `nonce` = the cookie's | `BAD_SIGNATURE` / `BAD_ISSUER` / `BAD_AUDIENCE` / `EXPIRED` / `NOT_YET_VALID` / `BAD_STATE` |
| 6 | server | `email_verified === true`; `email.toLowerCase() === "sean@meanwhileusa.com"` — `hd` alone is never enough | `UNVERIFIED_EMAIL` / `WRONG_EMAIL` |
| 7 | server | issue `__Host-wtp-admin` (8 h, Strict, `via: "google"`), clear the state cookie | — |

Every `why` is a **class**. No token, code, email or Google error text ever
reaches a URL, a log line or the page.

### The two cookies

| Cookie | Attributes | Lifetime | Carries |
| --- | --- | --- | --- |
| `__Host-wtp-admin` | `Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict` | 8 hours | a signed `{sid, iat, exp, via}` — an opaque session id, two timestamps, and which door issued it. No secret, no email |
| `__Host-wtp-oauth` | `Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax` | 10 minutes, cleared at the callback | a signed `{state, nonce, verifier, iat, exp}` — the PKCE verifier and two single-use random tokens. No secret |

`__Host-wtp-oauth` is the one `Lax` cookie on the admin host, and it has to
be: the callback is a top-level navigation **from Google**, and a `Strict`
cookie is not sent on a cross-site top-level request, so every sign-in would
end in `BAD_STATE`. `Lax` is sent on top-level GET navigations and nothing
looser. The `__Host-` prefix still forbids a `Domain` attribute, so the public
host never sees it.

---

## The break-glass — the shared secret's only remaining use

The secret path was **retained, not removed**, because the Google path could
not be proven live in the session that built it (the variables above were
absent), and removing the only working door at that moment would have locked
the owner out again. It survives under four mechanisms, each of which is code:

| Word in RULING 245 | Mechanism |
| --- | --- |
| documented | this section |
| held by the owner | RULING 238: `WTP_ADMIN_SECRET` is a value the owner holds a copy of. See the custody record below |
| rate-limited | at most **5 attempts per 15 minutes**, counted from the durable control plane's own incident log — never from a per-instance counter, which resets on every serverless cold start |
| incident-logged | every attempt the path accepts or refuses appends a record under key `admin-break-glass` in the control plane's `owner_digests` log: the class, the moment, the outcome, and the opaque session id issued (if any). Never the value, its length, or a prefix |

### Enabling it

The path **does not exist** until the owner sets, on Netlify (production
context, functions scope):

```
WTP_ADMIN_BREAK_GLASS=enabled
```

The exact word. `true`, `1`, `Enabled` and a blank keep the route at 404 —
the same answer the public host gives, so a prober cannot tell a disabled
break-glass from a path that was never there. `WTP_ADMIN_SECRET` (24+
characters) and `WTP_ADMIN_SESSION_KEY` must also be set.

While the flag is on, the login page shows a second section, **Break-glass**,
with the secret field under a notice that every attempt is logged. Enabling it
is itself visible: the first attempt after enabling writes the first incident
record, and `pnpm admin:login-readback` reports the path as **OPEN** on every
run until the flag is removed.

### What happens on an attempt

```
host → flag → Origin → open the control plane → count attempts in the window
→ compare (constant-time) → append the incident → issue the session
```

- If the control plane cannot be opened or the log cannot be read or written,
  the attempt is refused as `INCIDENT_LOG_UNAVAILABLE` **even when the secret
  is right**. An unloggable break-glass is the old login with a new name.
- Beyond 5 attempts in 15 minutes the path answers `RATE_LIMITED` and appends
  nothing — the five records already in the window are the evidence, and a log
  that grew by one row per refused request would amplify a flood.
- A session issued this way is marked `via: "break-glass"`; any decision
  intent recorded under it carries that session id, so what was done under the
  break-glass is distinguishable from what was done under the owner's identity.

### After the incident

Remove `WTP_ADMIN_BREAK_GLASS` from Netlify. The route returns to 404 on the
next request; no redeploy is needed for a functions-scope variable. Then rotate
`WTP_ADMIN_SECRET` if the incident gave any reason to, owner copy first.

### Reading the incident log

There is no page for it yet (see *Not yet built*). The records are in the
control-plane database named by `WTP_CONTROL_PLANE_DATABASE_URL`, table
`owner_digests`, `log_key = 'admin-break-glass'`, ordered by `position`. Each
record's `headline` reads `BREAK-GLASS SIGN-IN ACCEPTED: ACCEPTED` or
`BREAK-GLASS SIGN-IN REFUSED: <class>`.

---

## The custody violation this closes — record for the tracker

**HIGH-RISK ADJACENT.** The first `WTP_ADMIN_SECRET` was generated by a session
and installed masked in Netlify with no owner-recoverable copy. The owner could
not sign in to his own control centre. RULING 238 (2026-09-01) already required
the owner copy to exist BEFORE provider installation; the secret predates the
ruling's enforcement. **Fix applied:** the owner reset `WTP_ADMIN_SECRET` and
`WTP_ADMIN_SESSION_KEY` to values he holds (Netlify shows both updated
2026-09-02T01:44Z), and RULING 245 retires the secret as a login path. **What
remains:** the two Google variables must be installed under RULING 238 custody
(owner copy first, event appended to `data/ops/credential-events.jsonl`), and
the Google path must be proven live by the owner once. Until that proof, the
break-glass is the only door, which is why it was retained.

---

## Not yet built

- A control-centre panel listing break-glass incidents (the log exists; the
  page does not read it).
- A sign-out control on the admin pages themselves. `DELETE /api/admin/session`
  clears the cookie and needs the admin Origin, so it is a fetch from the page,
  not a link.
- A staging OAuth client for `test.meanwhileusa.com`. The redirect URI is
  registered for the admin host only; a staging sign-in would need a second
  client and branch-deploy-scoped variables.
