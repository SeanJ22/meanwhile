# Session brief — the locks go on (executed)

Fourth session of wall-clock 2026-08-14. Committed for the record, per the
standing rule; executed on branch `claude/t08-intake-locks-0814`.

On completion, overwrite `docs/session-brief.md`. ✓ (this file)
This session runs unattended. Nobody is available to answer.

- Reversible: cheaper-to-undo, recorded with the rejected alternative,
  keep going. Irreversible: skip, tracker row, continue.
- Hunts never stop — more rungs, `attemptedAt` on every rung. The long
  way is a way.
- Browser-heavy steps LAST, inline, no background agents.
- Live on every push; nothing half-finished to `main`. End with
  `pnpm handoff --ship`, verify on `main`, verify the deploy, standing
  report ending with "Needs your hands" — this header REPLACES "Before
  you send the link" permanently.

Session-open: read `docs/defects.md` and triage. ✓ (all entries already
carried tracker pointers; nothing new to triage)

## Context

Production is public — the password is down deliberately so the tester
can work without friction, and it stays down. T08's hardening was scoped
to precede public reachability; the order inverted by accident. This
session restores it. This session is DELIBERATELY SCOPED SMALL: T08 and
nothing else. A dedicated photo session follows separately. NOTHING built
here may add friction for a legitimate reader — no password, no login, no
captcha, no visible change for a human tapping at human speed. Locks on
the pipes, not the door.

Correct first. Fast second. Nothing third.

## 1 — T08: the store defends itself ✓ (all of 1a–1g built and gated)

- 1a Per-device rate limit — flag `ripcord.rateLimits`, thresholds
  configurable. ✓
- 1b Per-device daily ceiling, quiet refusal past it. ✓
- 1c Server-side validity against the registry; ask/search log length
  cap, rate limit, same-origin enforcement. ✓
- 1d THE LIMITER NEVER TOUCHES THE STORE — own space, unjoinable digest,
  own expiry; stated in CLAUDE.md beside the store rules. ✓
- 1e Quarantine, not deletion — `suspect_reason`, no identifier, excluded
  from every aggregate; the author decides. ✓
- 1f The tripwire — daily workflow, identifier-free committed report,
  flagged never auto-acted-on. ✓
- 1g Master ripcord `ripcord.reactionIntake`; pull procedure in
  `docs/ripcords.md`. ✓
- Tests: burst refused, ceiling refused, invalid refused, human pace
  accepted, quarantine, master ripcord closed — the mechanism asserted,
  never absence. ✓ (tests/intake.test.ts, 21 new)
- Gate: protections live in production; a human-paced tap lands in Neon
  end to end; a scripted burst against production is refused. ✓ (evidence
  in state.md §20 and the tracker row)
- Honest limit recorded in state.md: slow distributed fakery by a
  determined attacker rotating devices remains possible without accounts;
  the standard met is expensive-to-fake plus visible-when-attempted.

## 2 — Final pass and handoff ✓

Walk at 390×844 as a stranger; documents; tracker; transparency page;
ship; verify deploy; standing report ending with "Needs your hands."

## Order, and cuts if short

1 → 2. Nothing was cut.
