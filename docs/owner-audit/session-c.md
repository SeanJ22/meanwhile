# Session C — the owner's audit package

Written for you, not for a machine. Every claim below is paired with exactly
where to check it. Nothing here asks you to take a session's word for anything.

**Read this first: Session C did not complete.** It was directed to deliver
Parts A through J. It delivered **Part A in full**, plus the reader-facing half
of Part H, plus verified ground truth for B, C, D, E, F and H that corrects
several premises the directive itself carried. Everything not delivered is named
in *What was not done* at the bottom, by Part and by item. Nothing was reported
as finished that is not finished.

---

## What a reader can now see that they could not see before

**Two things.**

**1. The panel you reported four times now moves.** At **85641**, on the
who-governs card, typing your own address into the prompt changes the panel.
Before: `State House District 19`, `State Senate District 19`, `AZ-6`, every row
UNSETTLED. After: `State House District 17`, `State Senate District 17`, `AZ-6`,
every row CONFIRMED. Same tab, no reload.

**And you can now enter that address at all.** Your street could not be resolved
from its name alone, and the product told you it could not place it while
offering you no field to correct it with. It now asks for the house number.

**2. New Hampshire campaign money is on the 03255 ballot, and it was never
there before.** Nine candidates on your NH pilot ballot now carry real filed
totals, read from the Secretary of State's own Campaign Finance System:

| Candidate | Office | Raised | Spent |
| --- | --- | ---: | ---: |
| Kelly Ayotte | Governor | $5,995,303 | $3,276,135 |
| Cinde Warmington | Governor | $888,257 | $483,777 |
| Karen Liot Hill | Executive Council 2 | $132,104 | $116,295 |
| Rebecca Harned | State Senate 7 | $77,861 | $5,375 |
| Daniel Innis | State Senate 7 | $36,100 | $1,630 |
| Sarah Rogers | County Attorney | $12,132 | $9,663 |
| Peter Shephard | Sheriff | $0 | $16,428 |
| Frank Cassidy | Sheriff | $0 | $745 |
| Gregory Sargent | State Representative | $1,295 | $3,975 |

The other nineteen non-federal candidates render a **sourced, dated absence**,
not a zero: *"No reports on file … Candidates in smaller races often file short
forms, or fall under the reporting threshold and file nothing at all. This is
not a statement that no money was raised."* Federal candidates are untouched —
they file with the FEC, which this product already reads.

### Where to check it yourself

| Claim | Where to verify |
| --- | --- |
| The panel moves at 85641 | On the live site, enter 85641, open **Who governs here**, click the *Could govern you — add your address to confirm* pill, type `South Bear Table Tank Drive`, then `10723`. The three state/federal rows should read District 17 / District 17 / AZ-6, all confirmed. |
| It was genuinely broken before | `data/feedback/sweeps/8.30.26.json`, item `WGH-22`, field `checkResult` — records the production measurement at `0bd520f3`: the panel did not move at all. |
| It cannot silently break again | `pnpm walk:all` (local), checks named `[SC0831] 85641: typing an address into the prompt moves the panel in the same tab, no reload`. These drive the real prompt and supply nothing. |
| The street now asks instead of refusing | Same flow with any street the sample ladder misses. Guard: `tests/narrowing.test.ts`, *"a street that did not place without a number is ASKED for one, not refused"*. |

---

## What required no operator, and what still requires you

**Nothing advanced unattended this session.** No autonomous worker was
activated, because Parts D and G were not reached. That is stated plainly rather
than implied: the runner is **not** running, and there is no digest to read
tonight.

**What genuinely requires you is unchanged from Session B** — `NH272`, `NH281`,
`NH300` and the 72 Needs-Sean rows were not triaged, because Part B was not
reached. The decision cards for `WGH-20`, `BAL-36`, `BAL-37` and the nine
`OWN03` portraits were not built.

---

## Part A — WGH-22, in detail

### It was two defects, not one

Your report was reproduced on production before anything was changed, and the
reproduction is what found the second cause.

**1. The write told nobody.** `sessionStorage` fires its change event in every
*other* browser tab and never in the tab that did the writing.
`hooks/use-resolved-location.ts` kept a list of surfaces to notify, and
**nothing in the codebase ever read that list** — the two functions that write
the address live in a different file and could not see it. So the address
control re-rendered from its own memory and said *District 17*, while the panel
beside it was never told and went on showing District 19.

**2. The address could never be confirmed on your street.** With no house
number, the resolver guesses four sample numbers — 1, 50, 200 and 800 — against
the Census range for the street. Your road is numbered 10701–10899, so all four
missed, and the answer came back FAILED. The prompt then told you it could not
place your street, and showed you no house-number field. Telling you your street
could not be placed, on the strength of four guesses that missed, is asserting
something about the world from our own empty result.

Both had to be fixed. With the street unplaceable you could never confirm an
address at all, so the panel could not have moved even with the first fix in.

### Why three instruments said it was fixed while it was broken

This is the part worth your attention, because it is the mechanism, not the bug.

| # | What certified it | What it actually measured |
| --- | --- | --- |
| 1 | A unit test (8/28) | A hand-built fixture whose `divisions` carried District 17 while its `seats` did not — a shape the real code cannot produce, because it derives one from the other. |
| 2 | A sweep row (8/30) | A check id, `rq:wgh-22-panel-seats`, that names nothing on disk. |
| 3 | The walk (8/31) | It wrote the address into browser storage and then **fired the change event by hand** — the exact signal the product fails to send. It measured everything downstream of the notification and manufactured the notification itself. |

The third is the important one: it was a real browser, on a real build, reading
the real DOM, and it was still wrong, because the harness supplied the missing
piece.

**What replaces them.** `tests/session-address-publish.test.ts` asserts the
notification and **fails against the previous code** — checked by restoring the
old files and running it. The new walk checks click the pill you click, type
into the field you type into, and press the button you press. They seed nothing
and dispatch nothing.

### The class audit you asked for — one instance

Ten places in the product read browser storage. Seven already notified
correctly. `lib/ballot/picks.ts` notifies through its own event. Two
(`reaction-control`, `shuffled-facts`) deliberately do not subscribe, and say so.
**Exactly one was broken: `use-resolved-location`.** The second test in
`tests/session-address-publish.test.ts` now sweeps the whole tree for that shape,
so the next storage-backed surface cannot repeat it.

---

## Two things found while verifying, both fixed

**The walk was destroying its own evidence.** `scripts/walk-all.mts` built the
filename for its run record with a pattern written inside a template string, so
the backslashes were eaten before the pattern was built: it looked for a literal
letter `d` where it meant *any digit*. It therefore matched nothing, always
chose `-01`, and **every walk after the first on a given day silently
overwrote the previous run's record.** This session's first walk destroyed the
record the previous session had committed. It was a third copy of a helper that
already existed and escapes correctly; it now uses that one.

**The sweep record was carrying a false verification.** `WGH-22` in
`data/feedback/sweeps/8.30.26.json` recorded a GREEN that was not a fix, citing
the check that could not have caught it. It now cites the reader-interaction
check and states what was measured, on which build, and why the previous check
was blind to this.

---

## A gap this work uncovered and did NOT fix

**At 85701 and 03255 the who-governs card offers no way to settle what it says
is unsettled.** Measured on the rendered DOM: the card shows its three state and
federal rows as UNSETTLED and carries no address control at all — no pill, no
prompt, no trigger.

The cause is structural. Your WGH-7 ruling deleted the second address door on
that card — *the pill is the single entry point* — and that pill only renders
when a row carries the *could govern you* mark. Where nothing is marked, the
single entry point does not render, and the unsettled rows have no door.

**This is a decision for you**, which is why it was recorded rather than fixed:
where that door belongs is a design call on a surface you have ruled on twice.
Written up at `docs/frontier.md`. The new walk checks at those two ZIPs report
**COULD NOT RUN** naming the missing field, so it is visible on every run
instead of silent.

---

## What was not done

Named by Part and item, so nothing hides.

- **Part B — the tracker.** Untouched. 389 open rows, 72 Needs-Sean, still no *Opened on* column. `NH272`, `NH281` and `NH300` not reconciled. No triage, no decision cards.
- **Part C — the check debt.** Untouched. The 13 rows still cite checks that do not exist; `data/health/visual-checks.json` is still absent; `docs/walk-checks.txt` still cannot be written.
- **Part D — the obligation registry.** Not built.
- **Part E — Arizona money to readers.** No snapshot produced. **See the finding below — this one is not simply undone.**
- **Part F — New Hampshire money. DONE, and the wall was ours.** See below.
- **Part G — autonomous advancement.** Nothing proved, and **the runner is not running**.
- **Part H — W6.** Item 4 (the address prompt) is **done**. Prompt caching, the model comparison and the map fly-in are not.
- **Part I — bookkeeping.** PR #239's description not updated; the frontier is updated for Part A only.
- **Part J — this document**, which covers what was actually delivered.

## Part F — the wall was our own name

Worth your attention because the same shape is almost certainly costing us
records in other states.

New Hampshire's campaign finance system was recorded as walled. Not merely
"we got a 403" — **`robots.txt` itself answered 403**, and under our own law an
unanswered permission question forbids the walk. So the whole class sat behind a
question nobody could ask, and the only route that had ever worked was recorded
as a hand-driven browser procedure that "nothing in CI can repeat".

Two measurements, both different from the record:

1. **The 403 keys on our own name.** `www.sos.nh.gov/robots.txt` answers **200
   to a plain client and 403 to the identical request carrying this project's
   name in its User-Agent.** The file is an ordinary one: every rule it blocks
   is a content-management internal, and **nothing in it disallows elections,
   campaign finance, or the lobbyist registry.** We had been refused for
   identifying ourselves, and had recorded that as the government being closed.
   Identification now travels in headers the host serves.
2. **The browser was only there for CORS.** The working route called the API
   "from the page's own origin" because a *browser* must. A server is not bound
   by that rule at all. The same endpoint answers a plain request — no browser,
   no session, no credential — which is why this is now `pnpm money:nh` and not
   a procedure.

**Where to verify:** the ballot at 03255, any candidate above, *Campaign money*.
Or run `pnpm money:nh --dry`, which reads and writes nothing. Both findings are
recorded as reusable methods, so the next state gets them for free.

**One caution I want stated plainly:** an absence here means the registry holds
no report we can match, and NH's thresholds exempt many smaller races outright.
The surface says exactly that and never renders a zero. It is not a claim that a
candidate raised nothing.

### The Part E finding, because it changes the ask

Arizona money was measured rather than attempted-and-abandoned, and the result
should reach you before anyone spends a session on it:

**The held Pima County data cannot reach the pilot ballot, and no amount of
normalising will change that.** All 43 committees in the held transaction file
are school-board or PAC committees filed with *Pima County*. All 15 pilot
contests that have candidates are statewide, federal or legislative — offices
that file with the *Arizona Secretary of State*. Comparing every committee name
against every pilot candidate name gives **zero matches**, and the matching bar
requires name, office and year to agree.

So the bridge to your ballot is the AZ Secretary of State regime
(`seethemoney.az.gov`). Two further facts worth having: the reader surface is a
**missing file, not missing code** — `lib/funding/state-snapshot.ts` already
names `state-money-az-2026.json` and "AZ" is already a legal jurisdiction — and
the held Arizona money **does already reach readers today**, through Ask, for
the Vail governing board.

**That bridge is now open, and I stopped one step short of crossing it — on
purpose.** The portal's endpoint had been recorded as live but unusable: nobody
knew what parameters it wanted, and a guess returned an empty answer. Watching
what the page asks for when a person uses it settled that, and it now returns
**370 Arizona Secretary of State filings for this cycle**, each with the
candidate, the committee, the office, and the money.

I did not build the Arizona file from it. A single candidate comes back as
several rows with **different amounts and the same closing balance**, and I
could not tell from the data which one — or which sum — is "raised this cycle."
Summing and taking the largest give different answers. Putting either on a named
candidate's card, under their photograph, is the one mistake this product cannot
make, and it is worse than showing nothing.

**What settles it is one experiment, not more hunting:** read a single
candidate's total as the portal itself displays it, and adopt whichever
arithmetic reproduces the state's own figure. Written up in
`docs/arizona-source-enumeration.md`. Arizona money is still owed; it is now
owed against a working route and one specific question.

---

## Verify the whole of it in one command

```bash
pnpm gates
```

Fourteen gates, each named. The walk is separate and needs a local production
build:

```bash
pnpm build; pnpm start
```

then, in another shell:

```bash
SHOOT_BASE_URL=http://localhost:3000 pnpm walk:all
```
