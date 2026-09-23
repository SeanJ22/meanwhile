# Runner: evidence held only in the main vault, restored to the runtime vault (2026-09-22)

**Status: EXECUTED** 2026-09-22 19:51:03–19:51:19 MST (02:51:03–02:51:19 UTC), between research cycles (the cycle that started at 02:40:04 UTC finished at 02:50:45 UTC; the next was due at 03:50:45 UTC). The owner authorized copying verified main-only objects once Admin had reviewed the exact dry-run scope. Admin reviewed it independently and approved plan digest `sha256-7bcb89d865723e1ef49e3313af8d9a65910b89fc99ced15c17caabb69ad724dd`, and the execution re-planned live and ran only because it reproduced that digest. Receipt rows: [`runtime-vault-restore-2026-09-22.json`](runtime-vault-restore-2026-09-22.json).

## In plain terms

No reader page changed. Between 2026-09-01 and 2026-09-12 the runner fetched 473 public records and vaulted their bytes. They include candidate enrichment pages, meeting calendars, local-jurisdiction pages and campaign-finance filings. When the runner moved to its own checkout (its records start 2026-09-15), those bytes stayed behind in the main checkout's vault, where the runner never looks. The control plane still said the records were held, and the runner could not read them:

- parser workers aborted `WORKER_ARTIFACT_NOT_IN_VAULT` (17 Attempts so far);
- the 11 candidate-marginalia records the settled-route recovery (#358) will close as INGESTED would have been staged as "still owed".

The restore copies exactly those 473 objects into the runtime vault, byte for byte. Nothing was re-fetched from any publisher, nothing was overwritten, and nothing was deleted.

## Measurement (read-only)

One `READ ONLY` transaction against the production control plane (`cp_log_artifacts`, `cp_work_items`, `cp_occurrences`, `cp_obligations`, `cp_log_dispositions`, `cp_route_tasks`, `cp_log_worker_results`, `cp_log_scout_results`) at 2026-09-22 19:21 MST (02:21 UTC), plus a `list`/`head` of both vaults through `DurableEvidenceStore`. A record counts as **held** in a vault when that vault has a key under `project/<project>/` containing `/<workItemId>/<contentHash>.`, and the key's sidecar records the record's content hash, Attempt, canonical URL and tier. That is the rule `CycleVault.readHeld` resolves by.

| Vault | Objects |
| --- | ---: |
| Runtime (`wtp-production-runtime/data/control-plane/vault`) | 3,043 |
| Main (`we-the-people/data/control-plane/vault`) | 503 |

| Project and record class | Runtime only | **Main only** | Neither | Both |
| --- | ---: | ---: | ---: | ---: |
| freshness, candidate-enrichment | 2,985 | **298** | 38 | 0 |
| freshness, meetings | 0 | **79** | 21 | 0 |
| freshness, local-jurisdiction | 20 | **39** | 0 | 0 |
| freshness, campaign-finance | 5 | **24** | 11 | 0 |
| freshness, autonomous MEETINGS plans | 14 | **20** | 0 | 0 |
| freshness, autonomous BALLOT_AND_CANDIDATES plans | 0 | **8** | 0 | 0 |
| freshness, work item with no plan or occurrence | 0 | **5** | 9 | 0 |
| control-plane-proof (a crash-proof fixture) | 0 | 0 | 1 | 0 |
| **All 3,577 records** | **3,024** | **473** | **80** | **0** |

The 473 main-only records:

- name 473 distinct keys and total 45,574,121 bytes;
- are all tier RAW, and one of them is a partial capture;
- were all vaulted 2026-09-01..09-12.

Every runtime-only record is 2026-09-15 or later, so nothing still writes to the main vault. Every one of the 473 bodies re-verified through `get`: its hash matched its sidecar, and its length and hash matched its record. None of their keys existed in the runtime vault. The main vault's other 30 objects are named by no record, and they were left alone.

### Who reads the 473, and what they saw

The rows below are consumers, not a partition. The same artifact can feed more than one of them.

| Consumer | Reads the main-only bytes? | Before the restore |
| --- | --- | --- |
| Promotion tail, recovered dispositions (`freshness-shadow.mts` → `CycleVault.readHeld`) | The 11 INGESTED candidate-marginalia records on the 62 settled open occurrences | Would stage all 11 as "still owed". They are staged once, when #360's first cycle recovers them. |
| Held-evidence workers (`workerVaultResolver`) | 70 of 72 worker tasks name an artifact id whose first record, the one this resolver reads, is main-only. 5 are still open: 4 PARSER `RECLAIMABLE`, 1 VALIDATOR `PENDING`. | 3 Attempts on those tasks aborted `WORKER_ARTIFACT_NOT_IN_VAULT` (2026-09-15) |
| Detective and engineering specs (`researchVaultResolver`, `readEvidence`) | 5 evidence ids, all main-only | Their tasks already recorded results. A later task for those work items would have failed. |
| Plan repair (`consumePlanRepairs` → `researchVaultResolver`) | None today (1 repair evidence id, runtime-held) | No current consumer |
| Scout history (inherited artifact ids) | 270 ids are cited as history | Cited as ids only. Scouts do not read these bytes through the vault. |

Measured through the runtime's own resolvers against the runtime vault, before the copy, over the 473 records:

- `readHeld`: NOT_FOUND on 473.
- `workerVaultResolver`: `WORKER_ARTIFACT_NOT_IN_VAULT` on 444. The other 29 resolved through an earlier record of the same artifact id.
- `researchVaultResolver`: `RESEARCH_ARTIFACT_VAULT_IDENTITY_MISSING` on 427.

## The fix, and why this one

Two options were on the table:

- a verified copy of the main-only objects into the runtime vault, or
- a read-only second vault root that every resolver consults.

**The copy is smaller and closes the gap.** It changes no runtime code and no resolver. It keeps one vault, the one the runner writes to. It leaves the runtime with no permanent dependency on a development checkout's directory.

A second root would change three resolvers and the promotion tail. It would make "held" mean "held in either of two places" forever, and a later move or cleanup of the main checkout would silently reopen the gap.

- `lib/control-plane/evidence/vault-restore.ts` plans by the exact held-identity rule `readHeld` uses. It copies only objects some record names. It executes one object at a time, and each object must pass these checks:
  1. The source `get` re-hashes the body against its sidecar.
  2. Byte length and hash must equal the sidecar's and every naming record's, and the object class must be `IMMUTABLE_BODY`.
  3. The target key must be absent. An occupied key is a no-op only when it holds the identical object with identical metadata. Anything else is refused and never overwritten, including the same bytes under another Attempt's identity.
  4. `DurableEvidenceStore.put` writes the source sidecar's metadata verbatim. It re-checks the content address and the immutability rule itself, and it writes atomically: body first, sidecar last.
  5. The write is read back through `get`. The bytes, the metadata and the raw sidecar file must equal the source's.
- `scripts/vault-restore.mts` is **dry-run by default**. It reads the control plane in one `READ ONLY` transaction. `--execute` requires `--expect-digest`: the live re-plan must reproduce the digest the reviewer approved, or nothing is written. Both modes finish by reading every planned record back through `CycleVault.readHeld`, `workerVaultResolver` and `researchVaultResolver` against the target.
- `tests/control-plane-vault-restore.test.ts` runs on temp `DurableEvidenceStore`s:
  - the three runtime resolvers fail on a split record before the restore and read it after;
  - the sidecar arrives byte-identical and the source tree is byte-unchanged;
  - an unnamed body and a manifest are never copied;
  - an occupied key is refused, whether it changed between plan and execution or was already occupied at plan time;
  - a bit-flipped source body and a record whose length disagrees are refused and write nothing;
  - an altered plan and a self-restore are refused;
  - a second run finds nothing to copy.

## Execution

`node --env-file=<.env.local> --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/vault-restore.mts --source=<main vault> --target=<runtime vault> --execute --expect-digest=sha256-7bcb89d8…724dd`, at commit `d702ff1f`.

In the live re-plan the control plane had 3 more records than at measurement (3,580), all runtime-held and all from the 02:40Z cycle. The copy set was unchanged, so the digest matched.

| | Count |
| --- | ---: |
| Objects copied | **473 of 473** |
| Already present / refused | 0 / 0 |
| Copied sidecars byte-identical to the source sidecar | 473 of 473 |
| Body bytes copied | 45,574,121 |

Both vaults were snapshotted immediately before and after. Every file was read and hashed, and the tree digest is a sha256 over the path, size and sha256 of each file.

| Vault | Before | After |
| --- | --- | --- |
| Main (source) | 1,006 files, 46,735,844 bytes, `37cf7938…eb60b4` | 1,006 files, 46,735,844 bytes, `37cf7938…eb60b4` (**byte-unchanged**) |
| Runtime (target) | 6,092 files, 411,798,450 bytes | 7,038 files, 457,855,124 bytes |

In the runtime vault:

- exactly **946** files were added, the 473 planned bodies and their 473 sidecars, totalling 46,056,674 bytes;
- every added file is byte-identical to its file in the main vault;
- 0 pre-existing files changed or disappeared;
- 0 unplanned files appeared.

### Read back through the runtime's own resolvers

Same 473 records, same runtime vault, before and after:

| Resolver | Before | After |
| --- | --- | --- |
| `CycleVault.readHeld` (promotion tail) | NOT_FOUND 473 | **found 473**: 469 return text byte-exact to the record; 4 are binary bodies, returned as readHeld's decoded string |
| `researchVaultResolver` (plan repair, detective, engineering) | missing 427, read 46 | **READ 473**: bytes with the recorded hash and length |
| `workerVaultResolver` (held-evidence workers) | `WORKER_ARTIFACT_NOT_IN_VAULT` 444, read 29 | **READ 456**; 4 refused at the parser boundary (`NotVaultIssued`, binary bodies); 13 `WORKER_ARTIFACT_NOT_IN_VAULT` (see below) |

The 11 INGESTED candidate-marginalia records the settled-route recovery stages read in all three resolvers, byte-exact.

The 17 worker-resolver results that are not READ are not vault access:

- **4 binary bodies:** the Atlantic County Clerk PDFs `ar-b9b2baf846b4615a1f239877` and `ar-68ee0fe93cf6cee3c2e8fbd7`, the Apache Junction PDF `ar-5211d06218165b86b96f7294`, and FEC `cn26.zip` `ar-618a28dde10bdfb95ccd4612`. The vault finds and verifies them. `issueParserInput` then refuses them because it hashes a UTF-8 re-encoding of the decoded text. The Atlantic County PDFs failed this way in their 2026-09-04 Attempts too, before the split.
- **13 records over 10 artifact ids:** `workerVaultResolver` binds the **first** `cp_log_artifacts` record that carries an artifact id. For these 10, that first record is one whose bytes were never vaulted in either root: the Marginalia searches of 2026-09-01/02, a Tucson boards page, a Pima campaign-finance page and a `pima.gov/robots.txt`. The restored record with the same bytes is readable, as `readHeld` and `researchVaultResolver` show. No worker task, detective or engineering spec, or plan repair names these 10 ids today, so this is latent. Admin has it recorded as an open item.

### Actual use

The readback above runs the runtime's own resolver functions against the runtime vault, so it is the read each consumer makes. Live use is checked where each consumer runs:

- **Promotion tail.** The first cycle on #360, which carries the settled-occurrence scan, recovers the 62 settled open occurrences at once and stages the 11 INGESTED ones in that same cycle. It stages each only once. The signals, read from the runtime checkout's `.runtime/control-plane/staging/manifest.json` and that cycle's run record:
  - each of the 11 obligations is `STAGED_GAP` with "the record was ACQUIRED and is held" and "NORMALIZER MISSING for route candidate-marginalia-index", and none reads "vaulted bytes were not found in this runner's vault";
  - no runtime condition says "its held bytes could not be read back";
  - the run record's `recovered` array lists 62, with `discharged` true for exactly 11.
- **Held-evidence workers.** Any Attempt that dispatches a worker task naming a restored artifact now reads it. No new `WORKER_ARTIFACT_NOT_IN_VAULT` should appear on a restored artifact. It will still appear on the two Pima Legistar PARSER tasks, whose bytes exist in no vault.

## What the restore does not fix: blockers other than vault access

- **80 records whose bytes neither vault holds.** The restore cannot help them, and they are not guessed at.
  - 17 are `RESTRICTED_RAW`. The durable store refuses those by design without an encrypted, access-controlled provider, so they were never meant to be in either vault.
  - 23 RAW records (2026-09-01, 22 candidate-enrichment and 1 meetings) are held in the vault of a Claude agent worktree, `.claude/worktrees/agent-ab3ed1f64f8753bb0`. That is the same defect class, but it is outside this authorization, which covers main-only objects. `scripts/vault-restore.mts --source=<that vault>` plans them the same way, and they need their own review and yes. No worker task and no open occurrence names them today.
  - 40 RAW records are in no vault root found on this machine (the four `data/control-plane/vault` roots, plus a search of the temp directories): 5 from 2026-09-01, 25 from 09-02, 1 from 09-05 and 9 from 09-19. Two PARSER tasks name two of the 09-19 Pima Legistar event captures: `rt-57fe65fe80e2f0c4a2432d39` and `rt-0659fed6fd09d005dfb89fd8`. They have aborted `WORKER_ARTIFACT_NOT_IN_VAULT` 14 times since 2026-09-19 and will keep doing so. Their bytes exist nowhere to copy from. A new walk of the route is the only way to hold them again.
- **Two held PDFs stop at the parser boundary.** `ar-b9b2baf846b4615a1f239877` and `ar-68ee0fe93cf6cee3c2e8fbd7` are Atlantic County Clerk candidate lists (`application/pdf`). The resolver now finds them, verifies them and hands their text to `issueParserInput`. That check hashes the UTF-8 re-encoding of the decoded text, which never equals a PDF's bytes, so it refuses them with `NotVaultIssued`, exactly as their six Attempts did before the split (2026-09-04). This is a parser-input defect for binary bodies. It is not vault access.
- **The 11 recovered marginalia stage as `STAGED_GAP`.** No normalizer exists for that discovery class. With the bytes held, they read "the record was ACQUIRED and is held, and this project has no reader yet for its shape". That is staging, not publication.
- **A future move of the runtime checkout would split the vault again.** The vault root is still `<checkout>/data/control-plane/vault`. A dry run of `scripts/vault-restore.mts` detects the split. Making the root independent of the checkout is a design change, so it is not made here.
