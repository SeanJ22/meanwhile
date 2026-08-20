# Intent — what the next sessions are for, and in what order

**Written 2026-08-20 (Prompt C item 10).**

## Read this first: where this file came from

Item 10 asked for the intent document — "the file prompts get generated from" —
to be rewritten to current rulings, because it carried three things that are no
longer true: the dead three-to-four-item session limit, the NH → AZ → NJ zip
order, and pre-collision ladder assumptions.

**The ladder was walked and that document is not reachable from this repo.**
Recorded rather than asserted, so the next session does not re-walk it:

| Rung | Result |
|---|---|
| Tracked files, whole repo | no file named for intent; `lib/state/district-intent.ts` and `lib/state/status-intent.ts` are unrelated code |
| Untracked files (`git grep --untracked`) | nothing |
| Content sweep for its own markers — "three to four", "items per session", the NH → AZ → NJ order | the item-limit phrase occurs exactly once in the repo, in the `CLAUDE.md` rule adopted TODAY that kills it; the old zip order occurs nowhere |
| The Drive mirror, `G:\My Drive\we-the-people\` | fifteen documents, `transcripts/`, `code/`, plus the author's own extras. None is it |
| The Drive root, by name | nothing matching intent / prompt / wtp / civic |

So it lives where this session cannot reach — the author's own context. **This
file is therefore the repo's authoritative copy going forward**, written to
current rulings from the start rather than corrected from a copy nobody here
can read. Tracker row `R55` asks the author to reconcile or replace his copy
with this one; until he does, a prompt generated from his copy can still carry
the three stale facts, and that is the risk this file exists to end.

---

## The order, and why it is that order

**All future depth work runs: NH `03255` → NJ `07866` → AZ `85641` → AZ
`85701`.**

This **supersedes** the NH → AZ → NJ order carried by older documents. The
reasoning is recorded so it is not re-argued:

- **New Hampshire produces a DRAFT, not a playbook.** Town meeting government,
  selectboards, SB2, school administrative units sitting above districts, and a
  county that does almost nothing a county does elsewhere. Everything learned at
  `03255` is real and almost none of it is general.
- **Rockaway Township is the median American shape**, and running it SECOND is
  what proves the method generalizes rather than proving New Hampshire is
  consistent with itself. A playbook validated on two New England towns is a New
  England playbook that does not know it.
- **Vail then breaks it on the no-municipality edge.** `85641` is
  unincorporated: there is no city, and the governments a reader lives under are
  a county, a school district and a set of special districts. A method that
  assumes a municipality fails here, and it should fail here rather than in
  production.
- **`85701` last**, because downtown Tucson is the densest and best-covered of
  the four and therefore the least informative about what the method cannot do.
- **The New Jersey ballot mailing window is the one external clock the author
  does not control.** Everything else can move.

## The repeatability bar

**The playbook is repeatable when the THIRD zip's mandatory diff adds fewer than
five new rungs, requires no new source-type recipe, and holds its auto-resolved
fraction within ten points of the second.**

Recorded here so it cannot be argued past later. `R13`'s mandatory playbook diff
is the instrument — every depth run ends with its diff or an explicit "nothing
new", stated in the standing report.

The three conditions do different jobs and all three are needed:

1. **Fewer than five new rungs** — the ladder has stopped growing faster than it
   is being used.
2. **No new source-type recipe** — the shapes are known. A new vendor family at
   the third zip means the shape space is still open.
3. **Auto-resolved fraction within ten points of the second** — the method's
   yield is stable rather than tracking how well-covered a particular place
   happens to be. This is the one that catches a playbook that "works" only
   where the data was already good.

`corepack pnpm zip:add` prints the auto-resolved fraction on every run: bodies
populated without human intervention over bodies enumerated. That number
climbing across zips is the only real evidence the process is repeatable.

## How a session is scoped

**The old three-to-four-item limit is dead and is not to be reintroduced by any
document, including this one.**

- A session carries **carryover from the previous session plus deferred-queue
  rows**, and nothing else, until the queue clears.
- A session **drives until the gas light comes on**. It does not stop because
  the work so far feels like a coherent unit, because the next item looks
  large, or because a number of items feels like enough.
- **The instrument for "how much room is left" does not exist inside a
  session.** F22 finished at roughly 30% of its window and F01-continued
  session 1 stopped at 59% with six items untouched. Both were confident and
  both were wrong.
- **A defect found mid-session becomes a tracker row and the session keeps
  going.** Writing the row is the whole response. The two exceptions are a live
  data-loss path and a regression the live walk catches — both are fixed and
  named.
- **The deferral boundary falls between subjects, never inside one.** A subject
  is never left half-hunted or half-built; a session does not stop STARTING
  subjects because it doubts it can finish them all.

## The ladders, post-collision

Two ladders. Only one is numbered. Any prompt that says "rung N" without saying
which ladder is generated from a stale assumption.

- **Retrieval mechanics — `CLAUDE.md`, fourteen rungs, NUMBERED, canonical.**
  How to get bytes past a wall. This numbering is what reaches the database as
  `walledAtRung`.
- **Discovery — `docs/zip-playbook.md` §2, A through M, LETTERED.** Where a
  document lives. Retired out of `docs/source-ladder.md` on 2026-08-20 and
  lettered precisely so it can never collide with the numbers again.
- **`docs/source-ladder.md` is the EVIDENCE** — per-body hunt records. It is not
  the method, and its header used to say it was.

Rung values recorded before F22 (2026-08-20) are provenance-unknown, marked and
never reinterpreted.

## What the coverage numbers mean

Used verbatim, everywhere. A tier is never inferred at read time, and never
raised by a session that did not do the work that raises it.

- **Tier 0 — roster only.** The government appears in the Census or NCES
  universe. Nothing else is known.
- **Tier 1 — territory resolved.** It is confirmed to govern this zip.
- **Tier 2 — bodies enumerated.** The governing bodies inside it are known.
- **Tier 3 — Kelly depth.** Every official and candidate carries photo, phone,
  working contact, a specific verified page, and a campaign site.

**Census counts GOVERNMENTS; this product renders BODIES.** Census and NCES can
establish Tier 0 and Tier 1 and can never establish Tier 2.

**The national position as of 2026-08-20**, which is what any plan has to be
sized against:

- 47,834 of 90,837 Census units resolve to at least one zip (52.66%).
- 39,555 of 39,555 special districts are UNRESOLVED — 43.55% of every
  government in the country, and the ceiling on Tier 1 nationally.
- 33,075 of 33,791 zips sit at Tier 0 (97.88%), 716 at Tier 1, none higher.

## What generating a prompt from this file means

- The item list in a brief IS the scope. A defect discovered that is not on the
  list becomes a tracker row and is reported, not fixed.
- Every ruling a brief hardcodes as fact should be traceable to
  `docs/rulings.md`. If it is not there, it is not a ruling yet — it is a
  sentence in a chat window, and that is the thing `docs/rulings.md` exists to
  end.
- Denominators are always stated, and always come from outside us.
- Two numbers, always, where collection and rendering can diverge.
