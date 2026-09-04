# Governance consolidation — final conservation record (2026-09-03)

Supersedes the interim `consolidation-handoff-2026-09-03.md` (which closed the
measurement session UNFINISHED). This records the completed migration.

Reader delta: **zero by design.** This changed the governance system future
engineering sessions read, not the reader product.

## The corpus

- Base SHA `61219ad0c68d6601ba1eebb7139611dbd4979f7a`: 283 records, 262 current.
- Final canonical `docs/governance/ledger.jsonl`: **314 records, 45 current
  (32 LAW_DECISION, 13 DECISION, 0 active FACT)** — the recomputed active count
  after the §1B classification fixes, not the candidate's pre-cleanup 51.
- `pnpm governance:check`: 14 checks, 0 structural issues, 0 semantic conflicts,
  5 generated views not stale.

## Compiler cutover (BRANCH B) — the ledger is now the sole canonical input

`scripts/governance-compile.mts` no longer imports the `adoptions.ts` /
`classification.ts` overlays and no longer calls `writeLedger`; it reads the
ledger, generates the views, and asserts the ledger bytes are unchanged at the
end of the run. The overlays' still-operative effects were folded permanently
into the ledger by the one-time `scripts/consolidation-migrate.mts`. Negative
controls in `tests/consolidation-guards.test.ts` prove the compiler imports no
overlay, never calls `writeLedger`, and carries the read-only self-guard — so no
code path can recreate or reactivate a superseded record on compile.

## §1B classification fixes (applied to the ledger)

- R-0123, R-0151 → DECISION (batches of dated calls, not law); `operativePolicy` cleared.
- R-0019 → SUPERSEDED by R-0261 (the deferred committee-sale question is decided).
- R-0234 → HISTORICAL (a one-time model override whose reversibility clause fired, per R-0236).
- R-0235, R-0236, R-0239, R-0246 → HISTORICAL (dated FACT measurements are not current authority).
- R-0007, R-0018, R-0022 → given the recorded incoming supersession edge from R-0026 (they were orphaned SUPERSEDED records).

## `ruleKey` (RULING 247) — one rule, one current holder

Added to the schema and serializer; enforced in the validator (`one-rule-one-holder`:
one current LAW_DECISION per key; a non-current key-holder must link to the current
holder; an active law record with no valid key is refused). All 32 current law
records carry a stable domain-scoped `ruleKey`. Negative controls: a duplicate key,
a missing key, and an orphan-keyed superseded record all fail.

## Conservation — every prior-operative clause dispositioned

The 239 superseded-into-a-rewritten-ruling records (plus the 23 carried/high-overlap)
were read clause by clause under their consolidated successors (11 parallel audits),
then every UNCERTAIN clause was re-adjudicated against the WHOLE current corpus and
the candidate constitution (5 parallel adjudicators).

| Layer | CONSERVED | RETIRED (with reason) | LOST/GAP → repaired |
|---|---|---|---|
| Per-clause audit (≈1099 clauses) | 592 | 353 | 10 LOST |
| Adjudication of the 144 UNCERTAIN | 128 | 12 | 14 GAP |

**Every LOST and GAP was repaired** by restoring the distinct obligation into the
ruling that owns it (never a second copy of a clause carried elsewhere — the
`duplicate-canonical-law` check stays green). Repaired holes include:

- The **fourteen numbered retrieval-mechanics rungs** and their meanings, and
  `walledAtRung` semantics, restored to R-0249 (the delivered candidate carried
  only a pointer to a CLAUDE.md list that no longer existed). Not renumbered.
- R-0055's **photo "one tracker row per session"** clause → R-0255.
- R-0088's **literal-query-text** requirement and **"the invention is the
  deliverable, not the yield"** → R-0253.
- R-0169 **"zero at a tier fails loudly"** → R-0251; R-0198 **"a contract may
  only tighten closure"** → R-0252; R-0193 **"a denominator is not a membership
  proof"** → R-0274.
- R-0145 **social-media images are never a portrait source** → R-0255;
  R-0222 **an undetermined overlapping body stays** → R-0256.
- R-0263 **no advocacy/PAC sources** + **attribution ships with the data**;
  R-0265 **rotation-remediation** + the **six-field credential report gate**.
- Branch-independence-over-dependencies → R-0250; the state-register denominator
  and disagreement-is-a-finding → R-0251; no-reword-author-row → R-0270;
  state.md-inserts-never-replaces → R-0273; absence-never-wears-present-styling → R-0254.
- Named session/discovery principles the candidate dropped and the standing
  guards caught: **"I have run out of ideas"** and **blocked ≠ absent** → R-0250;
  the **eligibility recursion bound** and **"nothing new learned" is measured,
  never inferred** and **no manifest is ever complete** → R-0251/R-0252;
  **resumability is not permission to stop** and **a tracker row is not work
  completion** → R-0273.

**Semantic claims: 65/65 base current claim-keys conserved with unchanged values,
plus the 3 owner keys** (`business.sales_window/exclusivity/buyer_composition`).

## §4/§5 history preservation

**283/283 base record bodies AND variants are byte-identical in the final ledger**
(0 missing, 0 changed). Every migration edit touched a NEW consolidated ruling
(R-0247+) or metadata (status/kind/relations/routingNotes) — never a base body.

## §6 contradictions — all resolved

History-never-overrides (R-0247 reworded); one permission enum
`ALLOWED|DISALLOWED|CANNOT_TELL|NOT_APPLICABLE` (R-0263); one owner-terminal state
`NEEDS_SEAN`, `NEEDS_OWNER` removed (R-0273); pilot/frontier unordered (R-0276 +
`docs/frontier.md`); the retrieval-ladder hole (above); the rendering/suppression
taxonomy scoped to collection-completeness with the identity/safety/neutrality
carve-out (R-0254); walk:all scope and staging-vs-production deploy scope (R-0266);
current-decisions carries only DECISION records; numbering (11 retired, 22 recorded
by description, 88/89 issued-then-superseded); the depth-order scope note (R-0276);
277 adopted everywhere with no "pending" reference.

## Generated views + gates

All governance views regenerated from the canonical ledger; `AGENTS.md` re-synced;
generator digests re-recorded (RULING 102). The standing governance guards were
modernized to cite the successor rulings (§9): `acquisition-doctrine`,
`governance-questions`, `discovery-tree`, `context-pinned-conduct`,
`orchestration`, `stopping-legitimacy`, `hotfix-audit`, `no-suppression`,
`agents-parity`. The full test suite passes except the two build-gated
`deploy-paths` traces, which require a production build and pass under `pnpm gates`.

Per-clause evidence: `docs/governance/consolidation-evidence-2026-09-03/`.

**Owner decisions required from this consolidation: none.** No incompatible
policy pair survived (0 CONFLICT across the entire audit); every gap resolved from
the existing directive.
