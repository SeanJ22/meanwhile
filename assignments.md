# Lane assignments

The authoritative assignment table. River writes it. Workers read it every run.

| Lane | Assigned worker | Provider | Released to build | Continuation owner |
|---|---|---|---|---|
| measures | measures | Claude | yes | — |
| hunters | hunters | Claude | yes | — |
| registry | registry | Claude | yes | — |
| meetings | meetings | Claude | yes | — |
| auditors | auditors | Claude | yes | — |
| people | people | Claude | yes | — |
| admin | codex-admin | Codex | yes | measures (only after a recorded handoff below) |
| slide | codex-slide | Codex | yes | hunters (only after a recorded handoff below) |
| ballot | codex-ballot | Codex | yes | meetings (only after a recorded handoff below) |
| bank | codex-bank | Codex | yes | registry (only after a recorded handoff below) |
| frontend | codex-frontend | Codex | yes | auditors (only after a recorded handoff below) |

## Handoffs

None yet. When River hands a Codex lane to its paired Claude worker, it records a line here with a UTC time, the reason, the last Codex heartbeat it saw, and the stream tip at handoff. A Claude worker takes a Codex lane only when this section names it.

## Priorities

1. Returned failures in `returns/<lane>.md` come first.
2. Then take your lane's steps in the order your brief lists them, longest chains first. Registry starts DB-09 → DB-10 → DB-12 → DB-13 → DB-14 → DB-15 → DB-20.
3. Shared-file hooks go through River: put them under `needs_hook` in your status.

## Streams

Each lane works on `stream/<lane>`, which River seeds from `river` with an unlocked `.factory/<lane>.md`. An existing stream is resumed, never overwritten. Ready work is integrated through its exact `READY` commit only.

## Overflow

None started. Up to two are authorized if a lane falls behind (measured from hour 8).

## Environment notes for every worker (River, 2026-10-04 06:40Z)

- **Run tests the way CI does.** These cloud sessions set `DATABASE_URL` and `WTP_ASSET_STORE`, and CI doesn't. With them set, store-reading tests (registry, Ask, officials, meetings routes) fail with `STORE_UNREACHABLE` / 503, which looks like a code failure. Run checks as `env -u DATABASE_URL -u WTP_ASSET_STORE <command>`, e.g. `env -u DATABASE_URL -u WTP_ASSET_STORE CI_TEST_FILES="$FILES" corepack pnpm test`. Never point tests at a real database.
- **Fetch full history before running tests.** A shallow clone fails the frozen-base tests that `git show` old commits (`fatal: path ... does not exist in <sha>`). Run `git fetch --unshallow origin` once per environment.
- `route-refusals` "/api/meetings still answers a well-formed request" fails with 503 for the same `DATABASE_URL` reason. It isn't your change.
- A READY commit's subject starts with `READY: <step ids>`, and its SHA goes in `ready:`. River folds exactly that SHA.

## Fold notes (River, 2026-10-04 07:55Z)

- **`OFFICIAL_PAGE_EVENTS_VERSION`** (`lib/hunt/meetings-site-discovery.ts`) is a hash of the official-page parser's code closure. Any change inside that closure re-keys it, so streams collide on that one line. At each fold, River sets it to the value `tests/meetings-official-page.test.ts` computes on the combined tree. When you catch up with `river`, take river's value and re-run that test.
- **Checklist census removal (people SC-15) and the measures SC-03 group-names move** met in `v6-checklist-section.ts`, `owner-surface.ts` and `publish-owner-snapshot.mts`. River kept both intents: the census, index publisher and section functions are gone, and `lib/coverage/group-names.ts` and the per-place history stay. Measures and people: catch up before your next edit there.
- Delete a stale `.next` before running `tsc`. Its generated types still name routes that SC-15 removed.
