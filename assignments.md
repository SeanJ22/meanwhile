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
