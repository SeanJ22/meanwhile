# Meanwhile build briefs

These briefs run the build factory after the cleanup release. Each lane's work is the inventory rows it owns. The briefs point to only two sources: Sean's rulebook, `docs/rulings.md` on `main`, and the inventory, `inventory/meanwhile-repo-inventory-2026-10-06.csv` on this branch. They cite rulings by section and never copy them.

## Files

| File | What it is |
|---|---|
| `common.md` | How every run works: what to read, row order, moves, branches, lock and heartbeat, READY commits, paired continuation, shared files. |
| `river.md` | River: folding READY work, releases, live checks, continuation, and River's own rows. |
| `ownership.csv` | Every inventory row with work left: `path,lane,order_bucket,group`. Each row has exactly one lane. |
| `measures.md`, `hunters.md`, `registry.md`, `meetings.md`, `auditors.md`, `people.md` | Claude lanes. |
| `admin.md`, `slide.md`, `ballot.md`, `bank.md`, `frontend.md` | Codex lanes, each continued by a paired Claude lane if its run stops. |

## Rows per lane

| Lane | Rows | 1: stops free acquisition | 2: groups | 3: rest |
|---|---|---|---|---|
| measures | 46 | 0 | 16 (C, N) | 30 |
| hunters | 85 | 24 | 0 | 61 |
| registry | 212 | 53 | 124 (N) | 35 |
| meetings | 89 | 22 | 3 (J, N) | 64 |
| auditors | 29 | 0 | 1 (K) | 28 |
| people | 1,194 | 25 | 1,094 (D, I, M, N) | 75 |
| admin | 76 | 0 | 1 (L) | 75 |
| slide | 66 | 6 | 0 | 60 |
| ballot | 193 | 32 | 4 (F, N) | 157 |
| bank | 69 | 3 | 46 (A, B) | 20 |
| frontend | 93 | 0 | 1 (N) | 92 |
| river | 54 | 0 | 0 | 54 |
| **Total** | **2,206** | **165** | **1,290** | **751** |

All rows in groups E, G and H, and some in F and N, stop free acquisition, so they sit in bucket 1 and keep their group letter in `ownership.csv`.

## Starting the factory

Start River first. River creates `river` and `board/river` if they are missing, confirms one builder can publish, resume and hand off, and then the other lanes start on their hourly schedules. `start-prompts.md` has the prompt for each session. Starting the factory does not start a hunt, raise a budget or change a pause.
