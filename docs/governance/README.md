# The governance system

**Adopted 2026-08-26, the governance remediation.**

This directory replaces a pair of hand-maintained authorities with one canonical
store and a set of generated views. What follows is what a person needs to
operate it. The rules it implements are RULINGS 172 through 186; the reasoning
is in each of those records.

---

## What was wrong

`CLAUDE.md` and `docs/rulings.md` had grown to **538,255 bytes** between them,
mixing current law, superseded law, decisions, rationale, measurements,
approvals, interpretations and implementation history in one stream. A session
answering *what is true now?* had to reason through chronology and supersession.

And both files were hand-written, in the same session, with nothing checking
that they agreed. The visible symptom was `CLAUDE.md` carrying RULING 169 and
RULING 170 while `docs/rulings.md` stopped at 168 — resolved before this work
began. **The measured cost was far larger than that symptom.** Of the 90 rulings
written into both files:

| | |
| --- | --- |
| rulings held in both files | 90 |
| rulings whose two copies had **diverged** | **87** |
| substantial sentences existing only in `CLAUDE.md` | 697 |
| substantial sentences existing only in `docs/rulings.md` | 699 |

**Neither file was ever a complete record of any of them.** That is the defect;
the 169/170 mismatch was one visible instance of it.

---

## The pieces

```
CLAUDE.md                              ROOT CONSTITUTION — current cross-cutting law only
docs/governance/ledger.jsonl           CANONICAL. One typed record per line; new records append.
docs/governance/policies/*.md          GENERATED. Current law, per domain.
docs/governance/current-decisions.md   GENERATED. Active non-law decisions, by domain.
docs/governance/history.md             GENERATED. The full narrative. Not startup context.
docs/governance/index.json             GENERATED. Ids, aliases, relations, pointers, snapshot.
docs/rulings.md                        GENERATED. Compatibility view so `RULING n` resolves.
docs/governance/legacy/*.md            PINNED pre-remediation snapshots, byte-verified.
docs/governance/migration-manifest.json  The preservation receipt.
docs/governance/session-efficiency.md  OWNER DIRECTIVE, committed VERBATIM (RULING 237). Hand-authored law text;
                                       not generated, not a compiler input; changes only by a later ruling.
```

**Only `ledger.jsonl` is an input to the governance compiler.** The former
adoption/classification overlays were folded into it at the 2026-09-03
consolidation and are not compiler inputs. `CLAUDE.md`, the pinned legacy
sources, the preservation receipt and the verbatim owner directive have the
separate roles named above; the generated views are output and are never
hand-edited (RULING 92). Editing a generated view fails
`pnpm governance:check`, and there is a test that proves it by doing exactly
that.

---

## The commands

| Command | What it does |
| --- | --- |
| `pnpm governance:open --task <domain>` | Session open. Current authority for one domain, plus work state. **Never the history.** |
| `pnpm governance:check` | The validator. 11 structural checks plus byte-for-byte regeneration of every view. No skip flag. |
| `pnpm governance:compile` | Regenerates every view from the ledger. Idempotent. |
| `pnpm governance:import` | The one-time mechanical import, from the pinned legacy snapshots. Re-runnable. |
| `pnpm workstream:status` / `:close` | Canonical work state, and the GENERATED handoff. |
| `pnpm workstream:migrate` | Imports the descent artifacts into canonical work state. |
| `pnpm method:ingest` / `:check` / `:prove` | Cumulative route knowledge, its validator, and the compounding proof. |

---

## Changing the law

**A governance change is ATOMIC** (RULING 176). All of this lands together or
the change has not happened:

1. The canonical event — a later-dated record appended to `ledger.jsonl`. When
   it supersedes a current record, that predecessor's lifecycle `status` changes
   in the same transaction; its id, aliases, provenance, adopted text and date do not.
2. `pnpm governance:compile`.
3. `pnpm governance:check` passing.
4. The regenerated views committed.

**An adopted id and its adopted text are immutable** (RULING 99, RULING 176).
They are never reused, renumbered or rewritten. Lifecycle status may move only
as part of the atomic adoption of the later record that names what it
supersedes. A PARTIAL amendment must name **what
changed and what survives**, because a boolean `superseded` destroys exactly the
information the next reader needs.

### Adding a decision

Append to `NEW_DECISIONS` in `lib/governance/adoptions.ts` with the next free
number, `author_explicit` or `author_confirmed` provenance, and a domain. Then
compile and check.

**A session may not legislate.** `session_interpretation` provenance cannot
create binding law, and the validator refuses it — because a session writing a
rule it invented reads exactly like a session recording one it was given.

---

## The three id namespaces

They are kept apart so a collision is impossible:

- **`R-0026`** — adopted rulings, and only adopted rulings. Immutable.
- **`R-X-<slug>`** — the un-numbered entries of `docs/rulings.md`: acceptances,
  recorded measurements, the reserved-and-unassigned entries.
- **`R-C-<slug>`** — the constitution's own un-numbered law: the transparency
  mandate, the fourteen-rung ladder, the four photo doors, the Kelly standard,
  the n-stores rule. Among the most load-bearing rules in the product, and not
  one of them ever had a number.

Legacy strings (`RULING 26`, `R26`, `R-26`) all resolve. There is a test that
walks every id the constitution cites and fails on a dangling one.

---

## Semantic rule slots

The instrument that catches a contradiction a text search cannot.

> *"Every session ends by running `pnpm walk:all` against production."*
> *"Every walk runs against a local production build. `walk:all` loses its
> production mode entirely."*

Both were law. Both were bolded and stamped. They share almost no words, and no
grep finds the contradiction. A **claim key** is a named slot that may hold
exactly one active value, so two ACTIVE records disagreeing about
`verification.target` is a failing build rather than something a reader has to
notice.

Ten keys are declared in `lib/governance/claims.ts`. The list grows; a
contradiction in an undeclared slot is still a contradiction, and that is stated
rather than hidden.

---

## Where the variants come from

87 records carry a `variants` array holding the OTHER hand-written copy of that
rule, verbatim. The fuller copy is the body. **Neither is discarded**, because
the divergence ran both ways and merging prose automatically would be
composition — an importer writing sentences neither author wrote.

They render in `history.md`, `docs/rulings.md` and the policies, inside a
collapsed block.

---

## What is deliberately NOT here

- **A hand-maintained summary of current rulings.** That is what
  `docs/rulings.md` was, and rebuilding one would recreate the defect inside its
  own fix.
- **A size cap on the history.** RULING 106: history grows forever. What got
  smaller is the always-read root, from 254,943 bytes to about 16,000.
- **A skip flag on the validator.** An escape hatch on a gate is how the gate
  stops meaning anything.
