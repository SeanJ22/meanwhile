# Session brief — the depth session (2026-08-15, fourth of the day)

The author's brief for this session, committed for the record per the
standing convention. Branch `claude/nh-nj-depth-0815`; the narrative is
`docs/state.md` §27.

## The author's directive, verbatim intent

> "In the next session or two, we need to go really big on New Hampshire and
> New Jersey... it is light and sparse... there's only probably one, maybe two
> opportunities for someone to look through it — if they feel like this
> doesn't have a lot of data, they're never going to interact with it again."

The author did not believe one meeting in sixty days across forty in-view
districts at 03255, and he was right not to: those bodies exist and meet.

## The author's rulings, now law

1. **The photo rule rewritten whole into four doors**, with the composition
   and identity standards lifted out of the doors entirely. Doors: (1) an
   explicit recorded licence; (2) an official government-published portrait;
   (3) NEW — the campaign's own self-published portrait from its own site,
   labelled "campaign-provided"; (4) NEW, last resort — any portrait on the
   candidate's own site or any `.gov` site. Press, wire, photographer-credited
   and social-media images stay prohibited at every door.
2. **The street input asks instead of only refusing.** When sampled house
   numbers along a street disagree on jurisdiction, the input prompts — "This
   street crosses district lines — what's the house number?" — and resolves on
   the answer. The number is used for the geocode and never logged or stored.
3. **More states will demand more rungs**, into the playbook's preamble: the
   rungs written so far are the rungs discovered so far, every new state is
   presumed to teach new ones, and discovering-and-recording them is the work.

## The items, and what happened to each

| # | Item | Outcome |
|---|---|---|
| 1 | State folders, notes, and the playbook born | **Done** — R20 |
| 2 | Meetings depth at 03255 and 07866 | **Done** — M76, M77, M78; M79 In progress (two NH hosts refuse this pipeline; the browser rung is named) |
| 2 stretch | The in-view neighbour towns at 03255 | **Cut**, per the brief's own cut order |
| 3 | LegiScan — state votes for AZ/NJ/NH | **Done** — D49, all three states |
| 3b | D50 under doors 3 and 4 | **Done** — round 5, 590 → 592; 9 misses recorded per candidate, 65 named as needing a site hunt |
| 4 | The jurisdiction badge | **Deferred whole** — M81, nothing half-built |
| 5 | Walk, documents, handoff | **Done** — `tester-walk-0815c`, §27, this file |

## What the session found that was not in the brief

**M80 — the Census geocoder cannot be called from a browser at all.** It
answers 200 to a server and sends no `Access-Control-Allow-Origin` header, so
D53's device-side street geocode — shipped as working last session, with
passing tests, because the tests run in Node — has never fired in a page.
Ruling 2 above rides on the same call. This is a transport problem with a
doctrine answer (the only route that works retracts "never sent to us"), so
nothing was fixed and M80 holds the three options for the author.

## The cut order, as the brief set it

1 → 2 → 3 → 3b → 4 → 5, cutting 2's stretch neighbours first, then deferring
4 whole. Both cuts were taken in that order and nothing else was cut.
