# Session brief — written by F01 for whoever comes next

**Written 2026-08-19 at the close of F01.** This file is overwritten every
session; what it says is what the last session actually left behind, not a plan.

---

## Where the tree is

`main` at **`5daeb8f`**, which is what production is serving (`/api/build`) and
what the final `walk:all` ran against. **All 52 closed ITEMS shipped in
`a119578` (PR #108)**; `1203d48` (#109) and `5daeb8f` (#110) are close-out
records only and change no reader-facing surface. Three merges where the brief
asked for one — `state.md` cannot carry a deploy SHA or a `walk:all` result
that does not exist yet, and a document cannot name the commit containing it.
Working tree clean, no open PRs, local `main` fast-forwarded.

Gates at the close: **test 1240 pass / 0 fail · lint 0 errors, 11 allowlisted
warnings · `tsc --noEmit` clean · build green in default AND standalone mode ·
`walk:all` 324 passed, 0 regressions, 0 could-not-run.**

---

## What F01 was, and what it left

F01 was a GATE. The author's words: *"We are NOT moving forward until these are
resolved... I won't even open the site again until all these are fixed."*
Fifty-five live items from his own voice walkthrough of 2026-08-18, plus
twenty-nine screenshots.

**52 of 55 closed. 10.1 withdrawn by the author. 2 open, both DATA hunts.**

The two open ones have tracker rows and recorded ladders. **Neither is unbuilt
work** — the render for both shipped, and both render an honest named gap where
the data is missing:

* **`F02` — committee jurisdiction text, 186 rendered rows.** The live
  `congress-legislators` file carries `jurisdiction` on 42 of 49 parent
  committees and **0 of 181 subcommittees**; the field does not exist upstream,
  so no refresh of the current source closes it. Three rungs walked and
  recorded in `docs/source-ladder.md` — **rung 3 broke `jct.gov`'s header
  filter**, which is a reusable finding. Next rungs named per body: 9 (chamber
  committee rules as PDFs, which state subcommittee jurisdictions), then 12
  (`docs.house.gov`, the congress.gov committee API), then 4 and 5 for the seven
  parents still refused.
* **`F03` — appointed executives, 11 of 12 covered bodies.** Superintendents,
  county administrators, town and township managers. **1 of 12 landed**: Tucson
  Unified's Dr. Gabriel Trujillo, rung 2, the district's own page. Vail was
  reached at rung 6 and named only a SURNAME — deliberately not shipped,
  because a surname with no verified given name is a wrong-name risk on a real
  person. Every remaining body's next rung is in `docs/source-ladder.md`, along
  with two findings worth not rediscovering: **Kearsarge's superintendent post
  may be INTERIM**, and **the Rockaway Township BOE's own domain is not in the
  registry at all** (`rocktwp.net` is the township, not the district).

---

## What to know before you touch the map

Three things changed shape in F01 and a session that does not know them will
read them as bugs:

1. **The map canvas is FULL-BLEED and the rail floats over it** (10.3). The
   canvas no longer starts at `sm:left-[364px]`. Framing is preserved by
   handing the rail's width to the camera as PADDING through `map.setPadding`,
   which one call applies to `flyTo`, `jumpTo` and `fitBounds` alike. The
   reader-facing OVERLAYS still carry the offset on purpose — moving the
   who-governs card under the rail to fix a background would be trading a
   cosmetic gap for a covered card. Only the district picker followed the
   canvas, because its coordinates come from a click on it.
2. **The large surface is a STACK, not a slot** (2.4). `openLarge` replaces
   (the one-at-a-time rule, unchanged); `pushLarge` stacks, and closing pops.
   A card opened from inside another card returns to it.
3. **Every meetings list renders GROUPS** (3.1) through
   `groupMeetingsForReading`. Adding a fifth meetings surface means calling it —
   `tests/meeting-list-attribution.test.ts` reads the surfaces and will refuse a
   raw `.map` over an unordered array.

---

## Two things that will look like regressions and are not

* **Kearsarge's meeting floor is 14, not 15.** The snapshot still holds all
  fifteen. The sitting of 2026-05-21 sits exactly on the ninety-day serving
  window's boundary as of 2026-08-19 and has aged out of the WINDOW. **A floor
  counted against a moving back-window drifts by construction** and will do this
  again; the note at the site names the five SCHEDULED rows as the floor to
  count instead if a session wants one that does not drift.
* **The `0814c` ballot device-only checks are GONE from `walk:all`.** The
  author retired that claim in 11.2; the checks were still holding him to it.
  They were replaced under a NEW identity so the suite's own diff reports the
  swap rather than silently redefining what a passing name means.

---

## The standing close-out, unchanged

Every session ends with `pnpm walk:all` against the SHIPPED build, `pnpm
census:runs --target=production`, `pnpm stamp` into `state.md`, tracker rows by
ID with a duplicate check, `docs/session-map.md`, a playbook diff or an explicit
"nothing new", this file overwritten, and `pnpm handoff --ship`.

**The tracker ID shape is `^[A-Z]+\d+$`** and it is load-bearing — F01's first
attempt used `F01-A`/`F01-B` and `tests/tracker-integrity.test.ts` refused
them. The renumber that fixed the M128/M129 collision is only safe while every
ID is mechanically enumerable.
