# MapTiler — keys, quota, and what is and is not proven

**MAPQ-1 through MAPQ-8, 2026-09-07.** This file is the standing record for the
map provider: what the code now enforces, what only the owner can do, and — the
part that matters most — exactly what a number on the admin console licenses
anyone to conclude.

---

## What happened

The first MapTiler billing period closed at **101,863 requests against a
100,000-request free allowance**, while actual public readership was tiny.

The strongest correlation in this repository is dated. `lib/ops/origin-confinement.ts`
records that until **2026-08-22** our own `x-wtp-synthetic-run` header was
breaking MapTiler's CORS preflight, so **every capture and every walk this repo
had ever taken was accidentally offline at MapTiler**. That was repaired, and
provider traffic rose sharply from there. The bill is what a fixed instrument
looks like when nobody bounded it.

Two things follow, and both are now enforced rather than remembered:

- **"Local" is not evidence of "offline."** A page on `localhost` carrying the
  real public key spends the real allowance.
- **"Production origin" is not evidence of "human."** A deployed URL driven by
  our own robot is our own robot.

Nothing about the map, the provider, the styles or the plan was changed. What
changed is that ordinary automation cannot reach MapTiler, and that a request
which does reach it can be attributed.

---

## 0. MEASURED 2026-09-07: the production key is being refused

**The production basemap is not drawing for readers right now.**

A guarded browser loaded `https://meanwhileusa.com/` and the app's own style
request answered:

| | |
| --- | --- |
| request | `GET https://api.maptiler.com/maps/basic-v2-dark/style.json?key=<20 chars>` |
| `Origin` sent | `https://meanwhileusa.com` |
| `Referer` sent | `https://meanwhileusa.com/` |
| answer | **403**, empty body |

That is a reader-equivalent request: the production origin, the production key,
a real browser, no synthetic header on it (RULING 101 strips ours before it
crosses). A reader gets the same 403.

**What the reader sees instead**, photographed the same minute: the plain-ground
fallback (`#0b1518`) with every one of the app's own layers still drawing —
district boundaries, place labels, meeting markers and counts, the rail, the
panel, the legend. The map style carries 30 layers and **zero vector sources**.
Nothing is broken; the background is simply absent.

**Why is not established here, and must not be guessed.** A 403 with an empty
body distinguishes nothing on its own. The account overran its allowance
(101,863 of 100,000), which is the obvious candidate, but confirming it needs
the MapTiler account — see the owner actions below. The honest statement is:
*the provider refuses this key from its own allowed origin, and we do not yet
know why.*

**One consequence for every number below.** The per-page-load request count that
produced the bill **cannot be re-measured today**, because the style never
loads and the sprite, glyph and tile cascade behind it never starts. Today a
Reader page load attempts exactly one MapTiler request. That is a fact about
the current refusal, not about the traffic that overran the allowance.

### Requests this repair itself spent, declared

Four bounded, opted-in runs on 2026-09-07 spent **3 requests** in total against
the production key, and one against no key at all. They are recorded here so
they can be subtracted from public-origin usage rather than inflating it:

| Run id prefix | Requests | What it measured |
| --- | ---: | --- |
| `maptiler-quota-isolation-before-measurement@` | 1 | the pre-repair path, opted in — 403 |
| `maptiler-quota-isolation-why403@` (×2) | 2 | the refusal's status, origin and body |
| `provider-smoke` (local, bogus key) | 1 | the smoke's allowed path — not this account's key |

**Cadence: none.** These were one-off measurements, not a schedule.

---

## 1. The barrier — what the code enforces now

`scripts/browser.mts` is the only place this repository opens a browser
(`tests/browser-construction.test.ts` refuses any other). Every context it
makes is now **fail-closed** against MapTiler.

Opting in takes **two gates, and one alone does nothing**:

| Gate | Where |
| --- | --- |
| `spendsProviderQuota: "maptiler"` | the launch, in code |
| `WTP_PROVIDER_ACCESS=maptiler` | the process environment |

Two, because an environment variable exported once in a shell would otherwise be
inherited by every sweep started in it — and a broad visual sweep silently
spending the tile allowance is the exact failure this exists to make impossible.

An opted-in run **prints that it is spending**, is **capped**
(`WTP_PROVIDER_REQUEST_CEILING`, default 25, maximum 200), and **ends non-zero**
if it asks for more than its ceiling.

The policy is a pure function in `lib/ops/provider-access.ts`. It matches the
whole `maptiler.com` domain, so a subdomain nobody has thought of yet is blocked
the day it appears. The named hosts, asserted by name in the tests, are
`api.maptiler.com`, `tiles.maptiler.com`, `service.maptiler.com` and
`cloud.maptiler.com`.

**What a reader sees is unchanged**, because a reader never gets the barrier —
it lives in the synthetic harness, not in the app. A blocked style request gives
a synthetic run the behaviour the app already has for a reader with no basemap:
plain ground, and overlays, markers, popups, district layers and layout all
still rendering, so the visual suite stays testable. Measured on production
2026-09-07 and photographed.

One measured detail, stated because it differs from what a reader would see if
the provider were up: the *Basemap unavailable* notice does **not** appear on a
blocked run. `components/map/map-canvas.tsx` raises that notice only for error
messages matching `/style|sprite|glyphs|tile/`, and an aborted request produces
a different message. That is pre-existing behaviour for any network-level
failure, not something this barrier introduced, and it costs a capture nothing —
but a session comparing a capture against a reader's screen should know the
notice is absent by mechanism rather than by choice. Recorded as FOLLOW-UP.

## 2. The one command that may spend

```bash
WTP_PROVIDER_ACCESS=maptiler pnpm provider:smoke
```

Tiny on purpose: it asks for one style document and one tile the style itself
names, from a fabricated page on its own origin, with its own key, capped at 8
requests. It is not on any schedule. A standing job that spends a third party's
allowance is the shape of the problem, not the fix.

---

## 3. OWNER ACTIONS — the MapTiler account

**None of this has been done, and nothing in this repository may be read as
evidence that it has.** These are changes only an account holder can make, in
MapTiler's own console at <https://cloud.maptiler.com/account/keys/> and
<https://cloud.maptiler.com/account/credentials/>. Until each one is
independently read back, treat it as outstanding.

### 3.1 Four keys, one question each

| Key name (exact) | Allowed origins (exact — never a wildcard) | Installed as | Where |
| --- | --- | --- | --- |
| `meanwhile-prod-browser` | `https://meanwhileusa.com`, `https://www.meanwhileusa.com` | `NEXT_PUBLIC_MAPTILER_KEY` | Netlify, **production context only** |
| `meanwhile-staging-browser` | `https://test.meanwhileusa.com` | `NEXT_PUBLIC_MAPTILER_KEY` | Netlify, **the staging branch deploy only** |
| `meanwhile-synthetic-provider-smoke` | `http://maptiler-smoke.localhost` | `WTP_MAPTILER_SMOKE_KEY` | the runner machine's `.env.local` only — **never Netlify** |
| *(none)* | — | — | local, CI, deploy previews and every other branch deploy carry **no browser key**; the fallback basemap is expected |

Three constraints on that table, each of which is the reason a number was
unreadable before:

- **No `*.meanwhileusa.com`.** A wildcard is convenient and it merges admin,
  staging and every future subdomain into production's number — which is
  precisely the ambiguity that made the first bill impossible to read.
- **No `?` / unknown-origin allowance.** A request that declares no origin
  cannot be attributed to anything.
- **Include `www` only if it genuinely serves the Reader.** If it does not,
  remove it; an allowed origin nothing uses is a hole with paperwork.

`lib/map/key-matrix.ts` is the machine-readable copy of this table, and
`tests/maptiler-key-matrix.test.ts` asserts no two identities are reachable from
one deploy context. The smoke additionally **refuses to run** if the value in
`WTP_MAPTILER_SMOKE_KEY` is the same string as `NEXT_PUBLIC_MAPTILER_KEY`.

### 3.2 A service token, for reading the bill

Create a **service credential** (Credentials page, not the Keys page) and
install it as `MAPTILER_SERVICE_TOKEN` **on the runner only**. It is read
server-side by the standing owner-snapshot publisher.

It must never be a `NEXT_PUBLIC_*` variable, never reach client code, a log, a
committed file, or a screenshot. A browser cannot reach `service.maptiler.com`
at all — `lib/ops/provider-access.ts` blocks that host too — so a page can never
be the thing that holds one.

### 3.3 Confirm the allowance

MapTiler's analytics API does not return the plan ceiling, so the console shows
100,000 marked **assumed** until somebody says otherwise. Set
`MAPTILER_MONTHLY_ALLOWANCE` to the real number.

### 3.4 Find out why the production key returns 403 — and decide about the plan

§0 is the live measurement: the production key is refused from its own
production origin. Only the account can say why. The account's Statistics page
answers it directly, and the service token in §3.2 makes the same answer
visible in Admin after the standing runner's next automatic collection.

What to do about it — a plan change, a new key, waiting for the period to roll —
is not a repository decision and is deliberately not made here. The console
projects an exhaustion date from measured burn; the choice is the owner's.

---

## 4. What the numbers mean — the epistemic boundary

This is the section to read before quoting any figure from the console.

**Production-key usage is public-origin usage plus any bounded production probe
named in this file. It is not proof that a request came from a person.**

- An external browser or crawler that genuinely executes the public site is part
  of public-origin usage, and always was.
- What changed with MAPQ-1 is narrower, and is worth exactly what it is: **our
  own declared robots are no longer mixed into that number.**
- The console never says "humans", "people", "readers" or "organic" about
  provider usage. `tests/maptiler-usage.test.ts` walks every sentence the panel
  can render and fails on those words.

**Bounded production probes: none, on any schedule.** After MAPQ-1 no project
robot touches the production key, and no periodic credential health check was
retained against it. The four one-off measurements in §0 are named there with
their exact counts precisely so they are subtractable rather than invisible. `docs/credential-ledger.md`'s MapTiler row is a one-off,
owner-initiated check, not a schedule. If one is ever added, its exact expected
request count and cadence belong in this section so it can be subtracted from
public-site usage.

**App-side counts are events, not sessions.** The comparison panel counts
`search_log` rows by the actor class the runner already declares. Every session
that reaches the Reader loads the map, so the two move together — but an event
count is not a session count and the panel says so.

---

## 5. Runtime path and read-only diagnostics

The standing runner asks both MapTiler classifiers during its canonical owner-
snapshot publication. A complete reading is published directly to the
production control plane. A failed or partial collection is recorded as the
latest attempt, the prior good measurement remains live as LKG, and Admin says
that it is showing LKG while the runner retries. No usage reading is written to
Git and no manual publish step exists.

```bash
pnpm maptiler:usage
```

This optional terminal command is **read-only and non-authoritative**. It asks
MapTiler by `api_keys` and `services`, prints the result, writes nothing, and
cannot publish or change Admin. With no service credential it prints **NOT
CONNECTED** — never a zero, because a zero on a quota panel reads as headroom.

```bash
WTP_PROVIDER_ACCESS=maptiler pnpm provider:smoke
```

The one bounded, opted-in, capped run that may spend provider quota.
