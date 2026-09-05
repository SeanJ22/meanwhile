# September 4 Ask proof — ASK-26 and ASK-27

Scope is the frozen V94-F6 / V94-F7 denominator. The source is the unchanged
`feedback/9.4.26/we-the-people-feedback-2026-09-04-tester.xlsx`, Issues and
Decisions tabs, interpreted under the owner's current brief. ASK-24/25 remain
closed; their existing behavior is protected by the regression controls.

## Reader behavior

Named-body resolution now runs a deterministic confirmation gate before any
answer retrieval. Clean whole-question matches retain their canonical identity.
Typos, mechanical acronyms and ties produce one canonical suggestion and an
explicit “Did you mean …?” confirmation, with no answer, meetings, contacts,
alternative list or subject attribution. Confirming repeats the original
question with that ID; the server recomputes the suggestion and refuses another
body's ID or a confirmation reused against another question. Candidate scoring
uses name evidence and known body classification, never reader proximity. An
unresolvable name asks a short neutral clarification. The class lookup includes
held registry bodies outside the reader's coverage, without acquiring anything.

Both map and ballot Ask surfaces use the shared confirmation contract. The map
does not render its older local-context answer or digest beneath a pending or
canonical answer. “No, let me clarify” returns keyboard focus to the question.

The agenda retrieval selectors were already correct and remain in place:
canonical body ID → exact meeting ID → native held document/version. Ask now
retains every selected meeting's held document ID, content hash, source link and
optional source title, alongside unchanged item titles and meeting titles.
The shared publication classifier continues to distinguish portals, unreadable
documents, held agenda items and OURS holding gaps.

The agenda-answer defect also existed in the synthesis instruction: the shared
definition-first rule told agenda questions to lead with what the body means.
Agenda questions now receive a specific agenda-first instruction. Other question
classes retain the 2,347-character definition-first prompt byte-for-byte. Both
reader surfaces visibly lead with the held meeting/agenda records even if prose
is available. Portals stay labelled as portals; missing holdings never imply an
empty agenda or publisher absence.

## Deterministic evidence

Final combined run: **170 tests passed, 0 failed**. Command:

```text
node --import tsx --test tests/tester-9-4-ask.test.ts tests/ask-grounded-route.test.ts tests/ask-exact-body-identity.test.ts tests/ask-answer-contract.test.ts tests/visual-feedback-9-2-ask.test.ts tests/ask-box.test.ts tests/ask-prompt-cache.test.ts tests/ask-entity-binding.test.ts tests/ask-integration.test.ts
```

The new suite exercises the actual grounded POST handler with model and database
credentials removed, plus the actual meeting agenda GET route and shared React
renderers. It proves:

- Vail and its clean canonical name resolve outside the nearby reader coverage.
- `Vial` with and without the body class, and `VUSD`, ask one confirmation and
  bind only after confirmation; forged nearby IDs and reused questions fail.
- A tied name gives one stable suggestion, never a pre-confirmation answer.
- Unknown names ask neutrally; ordinary unnamed questions retain their defaults.
- School and county agenda paths return the same native document/version IDs as
  the meeting surface, retain every extracted item title and the meeting title,
  exclude other bodies, and render agenda records ahead of prose.
- An unavailable agenda remains an OURS gap with no invented docket items or
  publisher-absence claim.
- Existing person/ballot routing, canonical body retrieval, contact provenance,
  model-disabled degradation, prompt caching and ASK-24 measure summaries pass.

One older expected bare `UNRESOLVED` response was updated to the owner-approved
neutral `CLARIFY` response. The integration assertion now recognizes the awaited
confirmation parameter. The prompt-size control still pins the unchanged
non-agenda branch. The separate receipt renewal support is documented in
`tester-9-4-reader-renewal.md`; the Ask implementation did not edit the canonical
receipt.

No civic acquisition, autonomous/model workers, live model calls, production
control-plane reads/writes/scans, production build, or `walk:all` was performed
by this Ask implementation lane. Receipt renewal and final shipping belong to
the integration owner.
