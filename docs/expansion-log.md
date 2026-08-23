# The expansion log

**Created 2026-08-22 (Discovery Conduct session, item 7). APPEND-ONLY.**

One entry per hunt session. It records the routes that **did not exist at
session start** — RULING 88 — and for each: how it was conceived, the literal
query or URL, what it returned including zero, and whether it generalises.

## Read this before writing an entry

**A route that returned NOTHING belongs here exactly as much as one that
returned four hundred rows.** The invention is the deliverable; the yield is
not. Every other figure in this project rewards rows found, which is why this
sentence is at the top of the file rather than in a rule somewhere.

**An empty expansion section fails the item.** A session that cannot name a
route it invented has found the limit of its imagination, which is a fact about
the session — not about the world.

**Expansion is a new route to a field ALREADY OWED on the item list** (RULING
89). A new capability, a new surface, new infrastructure, or work on a zip that
is not the current zip is a **side quest**: it is forbidden, it becomes a
tracker row, and a session that built one while citing RULING 88 reports the
scope breach.

## The format

Each session appends a `## <session-id> · <date>` heading and, beneath it, one
block per route:

```
### <short name of the route>
- **Conceived:** what question or observation led to it
- **Query:** the literal text typed, or the literal URL fetched
- **Returned:** rows, including zero
- **Generalises:** yes/no, and to what class of entities
```

`tests/expansion-log.test.ts` fails the build when the newest session in
`docs/log.md` has no entry here. **Non-hunt sessions are exempt via an explicit
marker in the session id** — the suffix `-nonhunt`. The test checks for the
marker rather than inferring exemption from what the session did, because
inference is how an exemption becomes a habit.

---

## discovery-conduct-0823-nonhunt · 2026-08-23

**This session is marked `-nonhunt` and hunted nothing.** It has no expansion
routes, and that is the honest entry rather than a blank one. Its two network
calls were build inputs, both inside named items and both stated in the brief as
exceptions: `pnpm credentials` called every credential in `.env.local` because
calling them is the proof (item 2), and the Census ZCTA-to-congressional-district
relationship file was fetched as an input to JUR-3 (item 12).

The entry exists so the file starts with a record of why it exists rather than
with a heading and nothing under it.
