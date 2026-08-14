# Defects — the production scratchpad

Dump what you notice in production the moment you see it. No tracker
discipline required here — date, surface, what happened, what you expected,
freeform beyond that. The next session reads this file first, turns anything
new into tracker rows, and marks each line with the row ID it became.
**Author types observations; the session does the bookkeeping.**

Format per entry (loose):

```
## YYYY-MM-DD — surface
What happened:
What I expected:
```

A triaged entry gets `→ tracker <ID>` appended by the session that filed it.
Entries are never deleted — a defect that recurs needs its history.

---

## 2026-08-14 — sidebar

What happened: "Reset all" in the sidebar does not work.
What I expected: clicking it returns every control to the default view.

→ tracker **M24** (triaged 2026-08-14; fixed the same day — the handler only
reset `filters` while five control groups had grown around it, and the badge
counted the *default* district-type view as active, so the button also
appeared dead on a fresh page. Reset now runs a registry of resettable
controls; a test fails when a control is added without registering.)

## 2026-08-14 — sidebar, district types

What happened: no way to turn all district types on at once.
What I expected: a "Select all" next to the group.

→ tracker **M25** (triaged 2026-08-14; shipped the same day — "select all"
and "clear" links in the group header, in the existing clear-link style. The
default view stays three types; Reset all returns to it.)

## 2026-08-14 — map, district overlay (reported in the session brief)

What happened: the district overlay checkboxes do nothing — no lines change
when selections are made.
What I expected: checking a district type draws its boundaries.

→ tracker **M27** (triaged 2026-08-14; diagnosed before fixing: the
state→render path measured *working* at production's exact commit — check,
uncheck, select all, clear, both themes, all four zips. What reproduced was
the master "Show districts" toggle being off: the checkbox group stayed
fully interactive and every click was a silent no-op. Fixed the same day —
touching the group now turns the overlay on (except "clear"), the rule is
pure and tested, and the group says "The overlay is off — checking a type
turns it on" while it is off.)

## 2026-08-15 — the session brief (author's notes arrived as the brief, not this file)

The author's production pass for this session was delivered as the session
brief rather than entries here. Triaged and built on branch
`claude/reactions-and-plain-language-0815`; the brief is committed at
`docs/session-brief.md` for the record. Row pointers:

- Reaction capture live → **P03** (In progress: votes wired; provisions/
  free text open), **T03**/**T05** (demo-grade pass, in place), **T08**
  (new: the launch gate — full hardening before the password comes down).
- Viewport-settle failure + honest failure rendering → fixed with 2a
  (guard family extended; production cause instrumented, logs unreachable
  without the author's Netlify login).
- Prop 142 match-then-deny → fixed across all 11 measures (analyses render
  verbatim; see **P01** for what remains).
- Popup architecture → **M05** (Done).
- Plain-language layer → CLAUDE.md non-negotiable + 4a/4b/4c/4d shipped.
- Officials → body rosters ×5, mayor, no-mayor-as-fact (see **M05**/state.md
  §13; NJ rosters still open).
- Canvass lineup → **D33** updated.
- 5d (sidebar counts as doors) — the brief's sanctioned first cut, taken;
  open as future work, no row yet.
