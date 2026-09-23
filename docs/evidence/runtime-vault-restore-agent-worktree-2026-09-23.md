# Runner: 23 evidence bodies held only in an agent worktree's vault, restored to the runtime vault (2026-09-23)

**Status: EXECUTED** 2026-09-23T16:12:17Z–16:15:49Z. Admin reviewed the exact dry-run scope independently (technical review PASS), and the owner approved executing plan digest `sha256-bc85d8441c7677c9fb01dbebbbe13006afe8bd122f6fb0628707059d99baf314`. The execution re-planned live and ran only because it reproduced that digest. Receipt rows: [`runtime-vault-restore-agent-worktree-2026-09-23.json`](runtime-vault-restore-agent-worktree-2026-09-23.json).

**The runner around the copy:**

- **16:12:17Z, safe-point check:** no runner or research process was alive. The previous runner had exited at 16:04:12Z on a failed release check (`DEPLOYED_SHA_UNRESOLVED`); that was not a handoff. The last research cycle had finished at 15:45:13Z on `756f3317`.
- **16:14:25.254Z–16:14:29.938Z:** all 46 restored files were written, going by their own write times.
- **16:15:06Z:** the Scheduled Task's own trigger relaunched the runner (PID 23124). That was inside the tool's run, but 36 s after the last write. Only the tool's read-only resolver readback and the after-snapshot ran after it.
- **After the relaunch:** the after-snapshot shows no file added or changed beyond the 46 planned. The relaunched runner's first research cycle ran 16:18:00Z–16:27:51Z (ok, on `756f3317`). As of 16:30:13Z, no worker Attempt or result since the relaunch has named any of the 23 artifacts, and no Attempt has aborted on a vault miss. So nothing could have looked one up before it landed.

This finishes the item that [`runtime-vault-restore-2026-09-22.md`](runtime-vault-restore-2026-09-22.md) left for its own review and yes.

## In plain terms

No reader page changed. On 2026-09-01, 23 public records were recorded in the production control plane while their bytes were vaulted only under a Claude agent worktree, `.claude/worktrees/agent-ab3ed1f64f8753bb0`, rather than in the runtime's vault. The records are 22 candidate-enrichment search results and 1 meetings page. The control plane recorded them as held, but the runner could not read them. The restore copies exactly those 23 objects into the runtime vault, byte for byte. Nothing was re-fetched from any publisher, nothing was overwritten, and nothing was deleted.

## Dry run and review

The tool was `scripts/vault-restore.mts` from #362, unchanged on `main`, run read-only from `--source` = the agent worktree's vault to `--target` = the runtime vault. It read the control plane in one `READ ONLY` transaction.

| | Count |
| --- | ---: |
| `cp_log_artifacts` records | 3,681 |
| Held in the runtime vault | 3,601 |
| **Held only in the agent worktree's vault** | **23** (23 objects, 126,097 bytes) |
| Held in neither | 57 |
| Target keys already present / conflicts | 0 / 0 |
| Sidecars `put` reproduces byte for byte | 23 of 23 |
| Source objects no record names | 0 (every object in that vault is record-named) |

The 23 records are:

- 22 candidate-enrichment and 1 meetings capture;
- all tier RAW;
- all vaulted 2026-09-01.

A separate script re-derived the set from the 2026-09-22 measurement's "neither" records by held identity against the agent vault. It found exactly these 23 at the same keys, with none missing and none extra.

The plan file's sha256 was `D86500D8…98429`. Admin checked, reading only:

- each source file's sha256 and length, and that each key embeds its hash;
- that the source and target paths match each key;
- that no target path exists and there are no duplicate keys;
- that every copy has a naming record.

At review time, no worker task and no plan-repair candidate named these artifacts. The 37 INGESTED dispositions that cite their 20 artifact ids are all on closed occurrences, so the restore unblocked nothing live. It makes the evidence readable to any later worker, audit or replay.

## Execution

The run used the deployed tool from the runtime checkout at `756f3317`, so its readback went through the resolvers production runs. In the live re-plan the control plane had 3,685 records, 4 more than at review and all runtime-held. The copy set was unchanged and the digest matched.

| | Count |
| --- | ---: |
| Objects copied | **23 of 23** |
| Already present / refused | 0 / 0 |
| Copied sidecars byte-identical to the source sidecar | 23 of 23 |

Both vaults were snapshotted immediately before and after. Every file was read and hashed; the tree digest is a sha256 over each file's path, size and sha256.

| Vault | Before | After |
| --- | --- | --- |
| Agent worktree (source) | 46 files, 150,843 bytes, `0fa436da…4e395` | 46 files, 150,843 bytes, `0fa436da…4e395` (**byte-unchanged**, still intact) |
| Runtime (target) | 7,250 files, 459,732,827 bytes | 7,296 files, 459,883,670 bytes |

In the runtime vault:

- exactly **46** files were added, the 23 bodies and their 23 sidecars, totalling 150,843 bytes;
- every added file is byte-identical to its source file;
- 0 pre-existing files changed or disappeared;
- 0 unplanned files appeared.

The runtime checkout's `git status` was clean afterwards.

### Read back through the runtime's own resolvers

Same 23 records, same runtime vault, deployed code at `756f3317`:

| Resolver | Before | After |
| --- | --- | --- |
| `CycleVault.readHeld` (promotion tail) | NOT_FOUND 23 | **READ 23**, byte-exact text |
| `workerVaultResolver` (held-evidence workers) | `WORKER_ARTIFACT_NOT_IN_VAULT` 15, read 8 | **READ 23** |
| `researchVaultResolver` (plan repair, detective, engineering) | missing 14, read 9 | **READ 23**, bytes with the recorded hash and length |

## What still has no held bytes

57 records are held in no vault:

- 17 are `RESTRICTED_RAW`, which the durable store refuses by design without an encrypted, access-controlled provider;
- 40 are RAW records whose bytes are in no vault root found on this machine. Only a new walk of their routes can hold them again. They include the two Pima Legistar PARSER tasks, `rt-57fe65fe80e2f0c4a2432d39` and `rt-0659fed6fd09d005dfb89fd8`, which still abort `WORKER_ARTIFACT_NOT_IN_VAULT` for that reason.

The worker-resolver limitation named in the 2026-09-22 record is fixed separately by #367. It bound the first record of an artifact id, even when a later record's identical bytes were held.
