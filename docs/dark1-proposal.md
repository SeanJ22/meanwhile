# DARK-1 — the dark map, three options and a recommendation

**PROPOSAL ONLY. No map colour change ships from this session.**

*Written 2026-08-26 by the all-open-board session, from captures rather than
from an opinion formed before them (the read-as-an-image rule).*

Sean, on his 8/25 walk, capture `17-33-54`:

> Map lines and yellow are overwhelming in dark view; the same rendering reads
> fine in light.

He explicitly did not specify a fix and does not want a rework. So this is the
whole deliverable: three concrete options, captured side by side in both
themes, and a recommendation he can accept, reject or replace with a sentence.

## The captures

`pnpm dark1` writes them to `docs/proposals/dark1-2026-08-26/`. Five images, and
each is the LIVE map at 07866 at 1440×900 with the district layer on:

| File | What it is |
|---|---|
| `light-00-today.png` | **The control.** Light mode, untouched — the render Sean says reads fine. |
| `dark-00-today.png` | Dark mode, untouched — the render he photographed. |
| `dark-A-quieter.png` | **Option A** — line opacity 0.7 → 0.35, stroke thinned to 0.8. Nothing about the palette moves. |
| `dark-B-yellow-only.png` | **Option B** — only the local (yellow) tier dimmed, to 0.28. State and federal untouched. |
| `dark-C-fewer-lines.png` | **Option C** — nothing dimmed; the two school-district layers stop drawing at this zoom. |

Each option changes exactly ONE thing, because his complaint has two separable
parts — *lines* and *yellow* — and a proposal that changed everything at once
would tell him only whether he likes the bundle.

## What the captures show

**Option A is the recommendation.**

Read as images at full size: at 0.35 opacity the boundaries stop competing with
the basemap and start behaving like what they are — a reference layer under the
place names, the meeting pins and the roads. Every boundary is still visible and
still traceable; what changes is that the eye now lands on Rockaway Township and
the pink school-meeting pins first, rather than on a lattice of dashes. The
legend is still true, because no colour moved: local is still yellow, state
still teal, federal still lavender, and the three are still told apart at a
glance.

**Option B under-delivers.** Dimming only the yellow leaves the teal state
boundaries at full strength, and at this zoom those are the longest unbroken
lines on screen — so the map still reads as busy, and now it reads as
inconsistently busy, which is worse than uniform. It also makes the LOCAL tier
the quietest thing on a local-government map.

**Option C fixes the wrong problem and costs something real.** It is genuinely
calmer, but it is calmer because two governments stopped being drawn. This
product names the twig as readily as the trunk (RULING 57), and a school
district a reader can see a meeting pin for but cannot see the boundary of is a
worse answer than a slightly busy map. If density is the real complaint, the
honest lever is the Filters panel's existing DISTRICT TYPES control, which is a
reader's choice rather than ours.

## Why the fix belongs in the dark theme only

Light mode is untouched in all three options, and that is deliberate rather than
cautious. On a pale ground a coloured line is a mark ON something; on a dark
ground it is a glow, and the same opacity reads perhaps twice as loud. That is
the same asymmetry DARK-2 was ruled over the same morning — the Speak Your Mind
pill needed the opposite treatment in each theme — and it is the reason a single
value used in both themes is one value doing two jobs.

## What shipping A would actually be

Two numbers in `lib/map/districts.ts`, under a `prefers-color-scheme` branch or
a theme-aware token: the `line-opacity` case's non-selected stop, and the
`line-width` interpolate's base. **The SELECTED state stays at opacity 1** — a
reader who clicked a district must still see the thing they clicked, and MAP-2
now centres it for them.

**It is not built and it will not be until Sean says so.** This row is Needs
Sean.
