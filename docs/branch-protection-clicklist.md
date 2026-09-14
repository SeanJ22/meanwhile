# Permanent `main` protection — software CI only

This is the terminal protection state for the Permanent Civic Data Plane
Cutover. Routine civic-data and operational activity has no Git writer, so it
needs no ruleset bypass and no write-enabled deploy key. Historical setup and
incident detail remains in Git history; this file describes only the current
lawful state.

Run the live, fail-closed verifier after every protection or credential change:

```bash
pnpm protection:verify
```

It exits `0` only on exact agreement, `1` on drift, and `2` when a required API
reading was unavailable. An unread privilege inventory is not a pass.

## Exact terminal state

Repository ruleset `main` targets the default branch and is `Active`.

- Restrict deletions.
- Block force pushes.
- Require a pull request before merging, with the repository's existing review
  settings unchanged.
- Require branches to be up to date before merging.
- Require exactly these workflow-derived contexts:
  - `build (default)`
  - `build (standalone)`
  - `gates (test · lint · tsc)`
- Bypass list: empty.
- Classic branch-protection rule: absent; the active ruleset is the single
  protection mechanism.
- Write-enabled deploy keys: zero. Read-only deploy keys may exist only for a
  separately justified read use and do not create a route into `main`.

The names are literal. `tests/required-checks.test.ts` binds them to the
workflow, and `tests/protection-state.test.ts` proves the live-state judgement,
including missing, renamed, duplicated, and unexpected contexts.

## PDC cutover of the former direct-write route

After the permanent data plane and the software-release observer are proven:

1. Re-read ruleset `21572280`, the repository deploy-key inventory, and the
   Actions-secret inventory.
2. Update only that ruleset's `bypass_actors` to `[]`; preserve its target,
   enforcement, PR rule, strict required contexts, deletion rule, and
   non-fast-forward rule exactly.
3. Read the ruleset back and verify the bypass list is empty before touching a
   credential.
4. Delete the write-enabled `wtp-scheduled-pushers` deploy key.
5. Delete the `PUSH_DEPLOY_KEY` Actions secret.
6. Run `pnpm protection:verify` and require every assertion to pass.

Do not create a replacement key, app bypass, role bypass, path allowlist, or
direct-push helper. A real software change uses the protected pull-request
route. A routine runtime event stays in the production data/control plane and
cannot initiate a Git transaction.

## What remains in GitHub Actions

Only `build-check.yml` and `post-deploy-integrity.yml` survive the PDC cutover.
The first certifies software. The second observes the deployment produced by a
software push and appends its exact outcome to the canonical control-plane
software-release log. Both have `contents: read`; neither invokes Git mutation.

Draft pull-request activity receives the named deterministic structural tier.
`ready_for_review`, ready openings, and ready synchronizations receive full
normal certification. Push/main/release, exact-head, required-check, and
release-freeze semantics remain fail closed.
