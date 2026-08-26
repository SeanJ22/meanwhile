# Unblocking the scheduled pushers — Sean's click-list

Written 2026-08-26 by the unblock-pushers session. **No repository setting was
changed by that session.** Everything below is read from the live GitHub API and
is for you to apply.

**Verify it afterwards with one command:**

```bash
pnpm protection:verify
```

It exits `0` only when the end state below actually holds. It exits `1` on
drift and `2` when it could not tell — no credential is not a pass.

---

## What is wrong right now

The protection you turned on 2026-08-25 does exactly what you asked. As a side
effect, **all eight scheduled pushers have been unable to commit since that
date.** Every run goes red at the push with, verbatim from run `32955499285`:

```
remote: - Changes must be made through a pull request.
remote: - 3 of 3 required status checks are expected.
 ! [remote rejected] HEAD -> main (protected branch hook declined)
```

Nothing is silently lost. But the data ages, and `clerksboards` has already
crossed its 90-day window.

**Read from the API on 2026-08-26 — the state you are changing:**

| Setting | Current value |
| --- | --- |
| `required_status_checks.strict` | `true` |
| `required_status_checks.contexts` | `build (default)`, `build (standalone)`, `gates (test · lint · tsc)` |
| `required_pull_request_reviews` | present, `required_approving_review_count: 0` |
| `enforce_admins.enabled` | `true` |
| `allow_force_pushes` / `allow_deletions` | `false` / `false` |
| repository rulesets | **none** (`GET /rulesets` returns `[]`) |

---

## Why this needs a ruleset, and not a checkbox

**Classic branch protection has no per-actor bypass list. Only rulesets do.**
There is no setting on the current screen that admits the Actions bot and
nothing else — the only classic lever is `enforce_admins`, and turning that off
grants the bypass to *you and to Claude Code*, which is precisely the hole you
closed on 8/25. That option is rejected, not deferred.

So `main` moves from classic protection to a repository ruleset carrying the
same rules plus one bypass entry.

**One thing could not be settled without changing a setting, so it is flagged
rather than assumed:** whether GitHub offers *GitHub Actions* in a ruleset's
`Add bypass` suggestions. GitHub's docs say GitHub Apps are eligible and the
Actions app is app `#15368` — it is the app that posts this repo's own three
required checks — but community reports disagree about whether it is
selectable. **Step 6 tells you what to do either way, and
`pnpm protection:verify` answers it definitively in one run.**

---

## The click-list

### 1 — Create the ruleset

`Settings` → sidebar `Rules` → `Rulesets` → `New ruleset` → `New branch ruleset`

- **Ruleset Name:** `main`
- **Enforcement status:** `Active`

> `Evaluate` mode reports what *would* have happened and blocks nothing.
> `pnpm protection:verify` treats an evaluate-mode ruleset as no protection at
> all, and will tell you so.

### 2 — Target the branch

Under **Target branches** → `Add target` → `Include default branch`.

### 3 — Turn on the rules that must hold for humans and for Claude Code

Tick, in **Branch rules**:

- [x] **Restrict deletions**
- [x] **Block force pushes**
- [x] **Require a pull request before merging**
  - Required approvals: **0** (matches today — you are the only reviewer)
- [x] **Require status checks to pass**
  - [x] **Require branches to be up to date before merging**
  - `Add checks` → add all three, **spelled exactly**:
    - `build (default)`
    - `build (standalone)`
    - `gates (test · lint · tsc)` ← middots, not commas, not hyphens

> The third name uses `·` (U+00B7) with a space either side. Copy it from this
> file. See the rename hazard below.

### 4 — Add the bypass

**Bypass list** → `Add bypass` → search `GitHub Actions` → select it →
`Add Selected`.

Set its mode to **`Always`**, not *For pull requests only* — the whole point is
a direct push.

**Add nothing else to this list.** No repository role, no team, not yourself.
A human on this list reopens the 8/25 hole, and `pnpm protection:verify` fails
if it finds one.

### 5 — Save

`Create` at the bottom.

### 6 — **Delete the classic protection rule**

`Settings` → `Branches` → the `main` rule → `Delete`.

> **This step is not optional and it is the one that is easy to skip.** Classic
> protection and rulesets are **additive** — the most restrictive wins. Leave
> classic in place and the bot is still refused, the ruleset looks correct, and
> nothing works. `pnpm protection:verify` reports `shape: both` when this has
> happened, so you can tell that state apart from a wrong ruleset.

### 7 — Verify

```bash
pnpm protection:verify
```

Expect `INTACT — 5 of 5 assertions hold (ruleset)` and exit `0`. It names which
machine path holds the bypass.

**If step 4 could not find `GitHub Actions`:** use a **deploy key** instead —
`Settings` → `Deploy keys` → `Add deploy key`, tick **Allow write access** —
and add `Deploy keys` to the ruleset bypass list. The verifier accepts that path
too and will say `granted via a deploy key`. It needs one further change in the
repo (the workflows must push over SSH), so open a row and a session will do it
— do not hand-edit the workflows.

### 8 — Re-run the refresh

See `docs/refresh-unblock-runbook.md`. One dispatch, and it tells you whether
the whole chain works.

---

## Rollback, in one action

**`Settings` → `Rules` → `Rulesets` → `main` → set Enforcement status to
`Disabled`.**

That suspends the entire ruleset — bypass included — in one click, without
deleting it. The branch is then unprotected, so this is a *stop the bleeding*
move rather than a resting state: follow it by re-creating the classic rule
under `Settings` → `Branches` with the table at the top of this file, which is
the exact state you had on 2026-08-25.

If you would rather revoke only the bot and keep the protection: open the
ruleset, delete the single entry in **Bypass list**, save. The pushers go back
to failing at the push — the situation this document exists to fix — and
nothing else changes.

---

## The rename hazard, and what now guards it

**GitHub matches a required status check against the check-run name a workflow
reports, as a literal string.** Rename the job and the required context never
arrives — and that is not a blocked merge, because GitHub has nothing to wait
for. **The merge button turns green.** Protection disarms itself with nothing
anywhere going red. That is RULING 156.

Two of the three names are matrix legs (`build (${{ matrix.mode }})`) and the
third carries middots a tidying edit would remove without a second thought.

Moving to a ruleset **re-registers all three names by hand**, which is exactly
the moment a typo enters and nothing notices.

- `tests/required-checks.test.ts` (RULING 156) already anchors the required
  names against `.github/workflows/build-check.yml` and fails in both
  directions. It is unchanged by this and still holds.
- **What it does not know about is the ruleset**, because no ruleset existed
  when it was written. `pnpm protection:verify` closes that: it reads the names
  registered on the branch — from classic protection *or* from a ruleset,
  whichever is in force — and compares them against the same
  `REQUIRED_CONTEXTS` list. A context spelled `gates (test, lint, tsc)` after
  the move reads as **MISSING**, not as agreement, and the command exits
  non-zero. `tests/protection-state.test.ts` pins that case.

So the answer to *is a required check still actually required* is a command, in
either shape, before and after this change.

---

## What the bot is granted, and nothing more

The bypass lets the Actions app push directly to `main`. **On its own that
would be a bypass that could carry code, which is the 8/25 hole reopened.** It
is safe only because of the second half, which is already merged:

**`lib/ops/push-allowlist.ts`** — a hard, **per-workflow** path allowlist inside
`scripts/push-main.mjs`, the one script all eight pushers already go through. A
push is refused unless every changed path is on that workflow's own list.

| Workflow | May write, and nothing else |
| --- | --- |
| `refresh-daily` | `data/`, `docs/refresh-run.md` |
| `refresh-meetings-snapshot` | `data/meetings-snapshot.json` |
| `refresh-fec-snapshot` | `data/fec/fec-2026.json` |
| `refresh-legiscan-snapshot` | `data/votes/state-votes-snapshot.json` |
| `refresh-dotgov-snapshot` | `data/dotgov/snapshot.json` |
| `refresh-nj-filing` | `data/ballot/` |
| `intake-tripwire` | `docs/intake-report.md` |
| `job-watch` | `docs/tracker-working.csv` ← **one grant outside `data/`; see below** |

It **fails closed** in four directions: an unknown workflow id, an unreadable
diff, an **empty** diff, or any path outside the list. A second independent
list, `NEVER_PUSHABLE`, bars `.github/`, `scripts/`, `lib/`, `app/`,
`components/`, `tests/`, `CLAUDE.md`, `docs/rulings.md`,
`docs/tracker-resolved.csv`, `package.json`, `pnpm-lock.yaml`, `netlify.toml`,
`next.config.ts` and `drizzle.config.ts` outright — so even a profile widened by
mistake cannot admit code.

**The one grant outside `data/` is a decision, and it is yours to overrule.**
The brief said the allowlist never includes the tracker stores. Read strictly
that ends `job-watch`, whose whole function under RULING 56 is to commit the
Needs Sean row it raises — the only channel in this repo that reaches a person
when a scheduled job fails twice running. Killing that alarm to satisfy a path
rule would be the guard removing the thing it was built to protect. So the grant
is made, to one workflow, for one file, and rowed for you. **`NH204`.**
