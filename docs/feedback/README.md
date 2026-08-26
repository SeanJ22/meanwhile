# The feedback index

**Every visual-walkthrough batch Sean has recorded, its captures, and its
document — with the ones that never reached the repo named as missing rather
than left as a silence.**

RULING 108: anything a session must read at session start lives in the repo. A
session has a shell and a clone; the Drive mirror is a convenience for Sean and
never a channel to a session. RULING 104: an artifact he places here is an input
the session must reach, and *unreachable* is a defect to report rather than a
permitted outcome.

This file exists because both of those were being satisfied for the CAPTURES and
silently failed for the DOCUMENTS. Every batch below has its images committed.
**Three of five have no document in the repo at all**, and each of the three has
been treated by some session as authoritative — which means three sessions in a
row worked from a description of a file none of them could open.

| Batch | Captures | Content map | Document |
|---|---|---|---|
| 2026-08-22 | `2026-08-22/` — 21 files | — | ❌ **MISSING** (`FB01`) |
| 2026-08-23 | `2026-08-23/` — 5 files | — | n/a — session evidence, not a walkthrough |
| 2026-08-23 photo review | `2026-08-23-photo-review/` — 2 files | — | n/a |
| 2026-08-23 questionnaire | `2026-08-23-questionnaire/` — 5 files | — | n/a |
| 2026-08-24 | `8.24/` — 16 files | — | ❌ **MISSING** (`FB02`) |
| 2026-08-25 morning | `8.25/` — 19 files | [`8.25/capture-map.md`](8.25/capture-map.md) | ❌ **MISSING** (`FB03`) |
| **2026-08-25 Part 2** | `8.25/Part2/` — 25 files | [`8.25/Part2/capture-map.md`](8.25/Part2/capture-map.md) | ✅ [`we-the-people-feedback-2026-08-25-part2.md`](we-the-people-feedback-2026-08-25-part2.md) |

---

## What a batch owes

1. **The captures, committed.** `tests/asset-store.test.ts` names
   `docs/feedback/` as an exemption from the binary-size guard, with its reason,
   so a size sweep cannot push them back out to somewhere a session cannot reach.
2. **The document, committed here**, at
   `we-the-people-feedback-<YYYY-MM-DD>[-partN].md`. Verbatim. Where Sean has
   ruled on the items it lists as open, a `## Resolutions` section records those
   rulings, so the file in the repo does not carry questions he has already
   answered.
3. **A content map** — `capture-map.md` beside the captures — identifying each
   image **by opening it**, never by its timestamp. RULING 137: an annotated
   image is the SPEC and outranks prose, so which image is which has to be a
   fact rather than an inference.
4. **A row for every issue id**, so a class denominator has somewhere to land
   (RULING 136).

## The timestamp trap, recorded twice now

Both content maps in this directory exist because a brief's issue-to-file
mapping, inferred from capture times, was wrong — **2 of 3 spec images on the
8/25 morning batch, and 19 of 25 rows plus 2 of 4 spec images on Part 2.** A
walk photographs in the order it browses and dictates in the order it thinks,
and those two orders diverge the moment a battlecard opens.

**Identify a capture by content. A mapping confirmed only by timestamp is not
confirmed.**
