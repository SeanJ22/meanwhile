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
