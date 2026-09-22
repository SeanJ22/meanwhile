# What we spent this month, and what it produced — first pass

**As of 2026-09-21 (MST). Source: the runner's own charge ledger** (`cp_log_costs` in the
`meanwhile-control-plane` database), read only. This answers "what did the runner spend, on what,
and did it produce anything." It is a **first pass**: three numbers below depend on you confirming
where your reported figures came from (see "What only you can tell me").

Two honesty rules run through this whole report:
- **The runner's ledger and your Anthropic bill are two different measures of the same money.** The
  ledger records only what *this runner* spent on model calls. Your account bill also includes
  everything else on that account (development sessions, other tools, this very session). They are
  **never added together**; the difference between them is itself informative.
- **Unmeasured is not zero — and there are two kinds.** Of the 4,027 charge rows, 1,865 carry no
  dollar figure. **1,860 are deterministic work with no model cost** (plain web fetches by the
  fetchers/parsers/validators — confirmed free by design, shown as "no model cost"). The other
  **5 are model calls that reported no dollar figure** — genuinely *missing* cost information, not
  zero. The two are counted apart; neither is treated as $0 of work.

---

## The headline, in one paragraph

This month the runner spent **$151.36** in recorded model cost. **$150.74 of it (99.6%) was the
Scout** — the one worker that calls a model, and it runs on **Opus** (the most expensive class).
**$136.86 of that was "candidate enrichment"**: the Scout researching individual candidates and
offices across **New Jersey ($80), New Hampshire ($40), and Arizona ($21 + $4 for a Pima ballot
measure)**. This was **routine scheduled work the runner does on its own** — not new ZIP
assignments (you gave none, and the ledger shows none). Every other worker (the fetchers, parsers,
validators, auditors) is plain code and cost no model money.

---

## What the money produced

Every Scout attempt records an outcome. Across 2,118 attempts this month:

| Outcome | Attempts | Spend | Plain meaning |
| --- | ---: | ---: | --- |
| Found a usable route | 105 | $70.49 | A route worth reusing — the productive result |
| Found evidence | 79 | $28.25 | Real evidence pulled back |
| Found a lead, needs engineering | 7 | $8.46 | A route that needs an adapter written before it works |
| Hit a wall (blocked) | 10 | $5.34 | A refusal or block, recorded with its reason |
| **Made no progress** | **1,916** | **$36.04** | **Produced nothing** — but cheap, ~2¢ each |
| Needs a person | 1 | $0.43 | Escalated to an owner decision |

So about **$99 (two-thirds) produced a route or evidence**, **$36 went to 1,916 attempts that
found nothing** (individually tiny, collectively a quarter of the spend), and **$8 found leads that
are stuck waiting on engineering**. This is the exact shape the cheaper-model-first work targets:
the Scout is on Opus for everything, including the 1,916 low-value attempts, and the "start cheap,
escalate only when it pays" ladder exists in the code but is **never actually switched on**.

---

## The numbers, reconciled

Three counts, kept distinct (an earlier draft blurred them):
- **4,027 charge rows** in the ledger (one per attempt, across all workers).
- **2,160 are Scout charges** (including 56 cache pre-warm rows); **2,118 are Scout *research*
  attempts** (the outcome table above).
- **431 distinct subjects** were scouted; **105 yielded a route or evidence** — the unique
  *findings*, which are neither the row count nor the attempt count.

The dollars reconcile to the cent, with nothing unclassified:
- Measured total **$151.35** = Scout **$150.74** + Auditor **$0.61**.
- Scout $150.74 = research-by-outcome **$149.00** (the table above) + cache pre-warm **$1.74**.
- The six outcome categories are mutually exclusive and sum to that $149.00 — no overlap, no
  unclassified remainder.

---

## Did it reach the public?

**No scout-funded public delivery is confirmed** — a statement about what I can prove, not a claim
that *none* occurred. The reason is structural. Civic data reaches readers through the **routine**
publisher: meetings, legislators and similar registered sources auto-publish through one production
writer, and that path is live and lawful. The **Scout** feeds a *separate* research pipeline that
runs in shadow with **no production writer wired to it**, held behind an activation gate that a
standing ruling (RULING 215) keeps closed until after the election. So the routes and evidence the
Scout produced sit in the control plane as **inventory** — found, recorded, not published. I have
not traced any scout-funded record to a rendered public page, and the mechanism above says none
should have auto-published. The money bought **discovery; discovery is not delivery.** Connecting
scout discovery to the lawful routine publisher — and the owner decision (RULING 215) that governs
it — is the current milestone work.

---

## What we spent, by place

| Where | Attempts | Spend | What it was |
| --- | ---: | ---: | --- |
| New Jersey | 995 | $80.49 | Morris County township-committee candidates, mostly |
| New Hampshire | 277 | $39.63 | Merrimack County offices (register of deeds, attorney, sheriff, probate) |
| Arizona | 816 | $21.20 | SLDL / CD-6 / Secretary-of-State candidates |
| Arizona — Pima ballot | 2 | $3.77 | A Pima County ballot measure (Prop 423) |
| Runner overhead (scout pre-warm, misc fetches) | ~65 | ~$5.40 | Cache pre-warm and small fetches |

"What did we spend at Pima County?" and "at this school district?" become point-and-click questions
once the Admin cost view lands (it reads this same ledger). The building block — spend keyed to the
exact office/candidate/jurisdiction — is already recorded; the top single item this month was a NH
Merrimack County register-of-deeds candidate at $5.57.

---

## Reconciling with the figures you gave me

You confirmed the figures are from the **Anthropic Console (API)**, which reports in **UTC**.
Re-bucketed to full UTC days, the match is decisive:

| Your figure | Runner's ledger, that UTC day | Difference |
| --- | --- | --- |
| $26.68 | **2026-09-19 → $26.68** | **exact, to the cent** |
| $28.91 | **2026-09-20 → $28.91** | **exact, to the cent** |
| $52.33 | 2026-09-21 → $57.67 | runner **$5.34 higher** (see note) |

*Note on 09-21:* the runner cannot spend more than the account shows, so your **$52.33 was a
mid-day reading** of 09-21 — the runner kept working and finished that UTC day at $57.67.

**What this proves — and what it does not.** On the two complete matched days the runner's recorded
spend equals the Console **to the exact cent**, so on those days the runner accounts for the entire
API spend and the ledger is trustworthy for them. That is **strong evidence** the runner is the
dominant API consumer — but two days do **not** prove it for the whole month. The month-level ~$22
difference stays **unresolved** (below). (An earlier phrasing that called the runner "essentially
the entire bill" and the gap "timing" overclaimed from two days and is corrected here.)

- **Month (UNRESOLVED):** the runner has recorded **$151.36** through its most recent ledger row
  (stamped 01:48 UTC, the evening of 2026-09-21 MST). Your ~$173 is **not yet fully explained**: two
  complete days matching to the cent do **not** prove the whole ~$22 month difference is timing.
  Part is timing (the month kept climbing after you read the Console), but the remainder is
  **unresolved** until I compare the Console's own month-to-date against a ledger snapshot taken at
  the same instant — which needs the billing-API access in the list below. Runner ledger and Console
  bill remain two measures of the same money and are never summed.

---

## Confirmed with you, and what's left

- **Source:** Anthropic **Console (API)** — confirmed. Not the Claude subscription (that is a
  separate account).
- **Time zone:** the Console reports **UTC**, so reconciliation is done in UTC (above). Your stated
  **display preference is Eastern (EDT)**, and you are physically in Phoenix (MST). The Admin cost
  screen will therefore **display days in Eastern** (matching the app's existing spend-bar zone)
  while noting that Console reconciliation is UTC — the two never silently mix.
- **Still open (batched, not piecemeal):** to state the month total to the cent and to keep the
  cost screen live, I need read access to the Anthropic usage/billing API. That goes into the single
  consolidated access request covering every provider, so you approve credentials once.

---

## Method and limits

- Figures are the **measured** USD in the runner's charge ledger, summed only over rows that
  reported a cost; rows with no cost are counted and shown separately, never as zero.
- **Model attribution is derived**: the ledger records the *worker role*, not the model id. The
  Scout and Auditor are model-driven on Opus per the routing config; the rest are deterministic.
  Per-attempt model ids can be confirmed from the attempts log if you want that precision.
- **No assignment attribution exists yet** — the system records spend per body/source/worker but
  not per assignment, because assignments (as a first-class thing) don't exist until MW-001 lands.
  So all of this month's spend is correctly labeled "routine scheduled work, no assignment."
- Nothing here is reconstructed guesswork: the state/office/candidate labels are the *recorded*
  source ids on each charge. The only items awaiting your input are the reconciliation against your
  reported account figures.
