# The deploy key that pushes `main` — setup, verification, and rotation

Written 2026-08-26 by the deploy-key cutover session. **The eight scheduled
pushers no longer use the default `GITHUB_TOKEN`.** They push as a deploy key
over SSH, because the ruleset's bypass is granted to the **Deploy keys**
category — GitHub Actions is not offered as a selectable bypass actor, confirmed
against the live UI.

---

## STATE AS OF 2026-08-26 — steps 1 to 3 are ALREADY DONE

Read back from the API this session. Nothing below needs doing today; it is
here because **rotation is the same six steps**, and because a setup nobody
wrote down is a setup that gets re-derived under pressure the next time.

| What | Read from | Value |
| --- | --- | --- |
| Deploy key | `repos/SeanJ22/We-The-People/keys` | `wtp-scheduled-pushers`, **write-enabled**, created `2026-08-26T15:32:24Z`, `last_used: null` |
| Write-enabled keys on the repo | same | **1** — which is the intended end state |
| Actions secret | `repos/SeanJ22/We-The-People/actions/secrets` | `PUSH_DEPLOY_KEY`, created `2026-08-26T15:34:39Z` |
| Ruleset bypass | `repos/SeanJ22/We-The-People/rulesets/21572280` | `DeployKey`, mode `exempt` |

`pnpm protection:verify` reports **INTACT — 9 of 9**.

**The one thing still outstanding is a single dispatch to prove the key
actually authenticates.** `last_used: null` means it has never been used. Step 5
below is that proof.

---

## Step 1 — Generate the keypair, locally

Run this on your own machine. **Not in a session, not in CI, not in a shared
shell.**

```bash
ssh-keygen -t ed25519 -N "" -C "wtp-scheduled-pushers" -f "$HOME/.ssh/wtp_push_deploy"
```

- `-N ""` is **no passphrase**, and it is not laziness. A workflow cannot type a
  passphrase; there is no non-interactive way to supply one. A passphrase here
  would simply stop every scheduled push.
- `-t ed25519` — short, modern, and what GitHub's own published host keys use.
- `-f` names the file explicitly so it cannot land on top of your personal
  `id_ed25519`.

You now have two files:

| File | Half | Where it goes |
| --- | --- | --- |
| `wtp_push_deploy.pub` | **public** | GitHub → Deploy keys (Step 2) |
| `wtp_push_deploy` | **private** | GitHub → Actions secrets (Step 3) |

**The `.pub` is the one with the extension.** If you are ever unsure which you
are holding, the public half is a single line beginning `ssh-ed25519 AAAA…`. The
private half is many lines beginning `-----BEGIN OPENSSH PRIVATE KEY-----`.

---

## Step 2 — The PUBLIC half goes to Deploy keys

1. Go to **Settings → Deploy keys** on `SeanJ22/We-The-People`.
2. Click **Add deploy key**.
3. **Title:** `wtp-scheduled-pushers`
4. **Key:** paste the entire contents of `wtp_push_deploy.pub` — one line.
5. **Tick `Allow write access`.** Without it the key can read and cannot push,
   and the failure arrives at 3 AM as a permission error on a scheduled run.
6. Click **Add key**.

> **The bypass is granted to the CATEGORY, not to this key.** There is no way to
> name a single key in a ruleset — `bypass_actors` reports `DeployKey` with
> `actor_id: null`. So **every write-enabled deploy key on this repository holds
> the bypass**, and each one is a separate route past every rule in the ruleset.
> The intended state is exactly one. `pnpm protection:verify` counts them and
> goes red at two.

---

## Step 3 — The PRIVATE half goes to Actions secrets

1. Go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. **Name:** `PUSH_DEPLOY_KEY` — exactly that, no prefix, no variation. Eight
   workflows reference it by name.
4. **Secret:** paste the entire contents of `wtp_push_deploy`, **including**:
   - the `-----BEGIN OPENSSH PRIVATE KEY-----` line,
   - every line of the body,
   - the `-----END OPENSSH PRIVATE KEY-----` line,
   - **and the trailing newline after it.**
5. Click **Add secret**.

> **The trailing newline is not a detail.** `ssh` refuses a private key whose
> final line has no newline with `invalid format`, which reads like a corrupt
> key rather than one absent character — and web forms eat it routinely. The
> pusher now repairs this itself (`normaliseKeyMaterial`), so a lost newline no
> longer costs you an evening. Paste it anyway.

### DO NOT, under any circumstances

- **Do not paste the private key into a chat with Claude, or into any session
  transcript.** On 2026-08-25 a `curl` reporting flag printed nine credential
  values into a transcript that syncs to Drive, and all nine required rotation.
  A private key going the same way is worse.
- **Do not put it in a file inside the repository**, even temporarily, even
  gitignored. One `git add .` is all it takes.
- **Do not put it in Google Drive, OneDrive, Dropbox, or any synced folder.** A
  value written to a synced folder must be assumed read.
- **Do not email it to yourself.**

Once it is in the Actions secret, GitHub will never show it to you again, and
that is correct. You do not need to read it back.

---

## Step 4 — Delete your local copy of the private half (optional, recommended)

```bash
rm "$HOME/.ssh/wtp_push_deploy"
```

Keep the `.pub` if you like. The private half exists in exactly one place that
matters — the Actions secret — and every additional copy is a place it can leak
from. If it is ever needed again, the answer is Step 6, not a backup.

---

## Step 5 — Verify it worked, WITHOUT printing it

**One dispatch. You are looking at four lines of log, not at a key.**

```bash
gh workflow run refresh-daily.yml --repo SeanJ22/We-The-People --field all_sources=true
```

Then watch it:

```bash
gh run list --repo SeanJ22/We-The-People --workflow=refresh-daily.yml --limit 1
```

### What proves the key works

In the **Commit** step's log, all four:

1. `push-main: pushing to git@github.com:SeanJ22/We-The-People.git as a deploy key`
   — it chose SSH rather than HTTPS.
2. `push-main: path guard PASSED for refresh-daily` — the allowlist ran.
3. `push-main: pushed on attempt 1 of 5` — **the push landed.** This is the
   line that did not exist before today.
4. A commit on `main` authored `github-actions[bot]`.

### What a failure looks like, and which half it names

| Log line | What it means | Fix |
| --- | --- | --- |
| `PUSH_DEPLOY_KEY is not set in this job's environment` | The secret is missing, or a workflow does not pass it | Step 3; the test named below catches the second case |
| `PUSH_DEPLOY_KEY is set but EMPTY` | The secret does not exist under that exact name — an unset secret interpolates to `""` | Step 3, check the spelling |
| `does not look like an OpenSSH private key … pasting the PUBLIC half` | The two halves went to the wrong places | Steps 2 and 3, swapped |
| `Permission denied (publickey)` | The public half is not on the repo, or **Allow write access** is unticked | Step 2, item 5 |
| `Host key verification failed` | GitHub rotated its SSH host keys | Update `GITHUB_HOST_KEYS` in `lib/ops/deploy-key-ssh.ts`. **Do not disable strict checking to get past this.** |
| `protected branch hook declined` | The ruleset bypass is not in force | `pnpm protection:verify` |

**Afterwards, `last_used` on the deploy key stops being `null`:**

```bash
gh api repos/SeanJ22/We-The-People/keys --jq '.[] | "\(.title) write=\(.read_only == false) last_used=\(.last_used)"'
```

That field is the only external anchor there is for "this key has authenticated
at least once", and it is worth reading rather than inferring from a green run.

---

## Step 6 — Rotation, if it is ever exposed

**A scrub is cleanup. Rotation is the fix.** If the private half reaches a
transcript, a synced folder, a log, a screenshot, or anywhere you did not put it
on purpose, assume it has been read and rotate. It costs ten minutes.

The order matters — **add the new one before removing the old one**, so there is
never a window in which no key can push.

1. **Generate a new keypair** (Step 1), with a different filename:
   `wtp_push_deploy_2`.
2. **Add the new PUBLIC half** as a second deploy key (Step 2), titled
   `wtp-scheduled-pushers-2`, **with write access**.
3. **Update the `PUSH_DEPLOY_KEY` secret** with the new private half (Step 3).
   Updating replaces the value; you do not delete and recreate the secret.
4. **Dispatch once and confirm the push lands** (Step 5).
5. **Delete the OLD deploy key** — Settings → Deploy keys → the old row →
   **Delete**. Until you do this, two write-enabled keys exist and **both hold
   the category-wide bypass**.
6. **Confirm you are back to one:**
   ```bash
   pnpm protection:verify
   ```
   It must read `1 of 1 deploy key(s) can write` and `INTACT`. It goes red at
   two, which is what stops step 5 being the one you forget.

> **If the exposure was in a session transcript that mirrors to Drive**, the
> mirror is also swept — `pnpm secrets:sweep` reads the repo and the mirrored
> artifacts by VALUE, not by pattern. Run it after rotating, so the old value is
> not sitting in a file waiting to be found.

---

## What the repo enforces, so you do not have to remember it

| Rule | Where |
| --- | --- |
| The key never lands in the repo or a synced folder | `refuseUnsafeKeyRoot`, `lib/ops/deploy-key-ssh.ts` |
| The key file is removed on **every** exit path, the failure path included | `pushMain`'s `finally`, proved in `tests/push-main.test.ts` |
| Host verification is pinned and cannot be disabled | `GITHUB_HOST_KEYS`, proved in `tests/deploy-key-ssh.test.ts` |
| A missing secret fails the run loudly and never reads as "nothing to push" | `judgeKeyShape`, proved in both test files |
| Every pusher passes the secret — a ninth added without it fails the build | `tests/deploy-key-ssh.test.ts` |
| Exactly one write-enabled deploy key exists | `pnpm protection:verify` |
| No scheduled push can carry code, whatever the bypass allows | `lib/ops/push-allowlist.ts` |

That last row is the one that matters most. **The bypass mode is `exempt`, which
skips the ruleset outright rather than evaluating it and waving the key
through** — so there is nothing left on GitHub's side between a scheduled job
and `main`. The per-workflow path allowlist is the whole of it.
