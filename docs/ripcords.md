# Ripcords — the pull procedures

One page, written to be followed at 2am. Every named kill switch in
`lib/ripcords.ts`, what pulling it does, and the exact steps. Nothing here
requires a code change, a PR, or a working development environment — only
the Netlify dashboard (and optionally a terminal for verification).

## The one you are probably here for: close reaction intake during an attack

**Flag:** `ripcord.reactionIntake` · **Env var:** `WTP_RIPCORD_REACTION_INTAKE`

Pulling it makes the server refuse **every** write to the reaction store
and the search/ask log with a 503. The app keeps rendering normally; a
reader who taps a reaction sees the honest line — "Couldn't reach the
totals — your answer is saved on this device and wasn't counted." Nothing
silently records, nothing breaks, reads are untouched.

### Pull it

1. Log in to Netlify → site **sparkwtp** → **Site configuration** →
   **Environment variables**.
2. Add (or edit) the variable: key `WTP_RIPCORD_REACTION_INTAKE`, value
   `pulled`. Scope: all scopes / production is fine.
3. Deploys → **Trigger deploy** → *Deploy site*. This is a configuration
   redeploy of the same commit — no code changes, about two minutes.
   (Netlify injects env vars at deploy time, so the flip needs this step;
   that is the honest meaning of "config change, not code change" here.)
4. Verify the intake is actually closed — never trust the green deploy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST https://sparkwtp.netlify.app/api/reactions -H "content-type: application/json" -d "{}"
   ```

   **503** means closed. Anything else means the deploy has not finished
   or the variable is misspelled — check both, in that order.
5. Optionally, open the site on a phone, tap a reaction: the app should
   render normally and show the not-counted line.

### Restore it

Same steps; set the value to `live` (or delete the variable — the
committed default is live), trigger a deploy, and verify a human tap
lands again (a real tap → the choice renders solid, no not-counted line).

## Turn the rate limits off (a protection is refusing real readers)

**Flag:** `ripcord.rateLimits` · **Env var:** `WTP_RIPCORD_RATE_LIMITS`

Pulling it switches off the whole tunable-protection family on both
intake routes: per-device burst windows, the daily ceiling, velocity
quarantine, per-IP windows, and same-origin enforcement. Validity checks
(real targets, closed enums, length caps) stay on — they cannot misfire.
Same procedure as above with value `pulled`; restore with `live`.

**Prefer tuning over pulling.** Every threshold has its own variable, so
if one number is wrong you can raise that number and keep the rest of the
armor on (same env-var + trigger-deploy procedure):

| Variable | Default | Meaning |
|---|---|---|
| `WTP_LIMIT_REACTIONS_PER_MINUTE` | 40 | per-device hard refusal, per minute |
| `WTP_LIMIT_REACTIONS_SOFT_PER_MINUTE` | 20 | per-device quarantine threshold, per minute |
| `WTP_LIMIT_REACTIONS_PER_DAY` | 400 | per-device daily ceiling (quiet refusal) |
| `WTP_LIMIT_REACTIONS_IP_PER_MINUTE` | 120 | per-IP reactions window |
| `WTP_LIMIT_LOG_IP_PER_MINUTE` | 240 | per-IP search-log window |
| `WTP_LIMIT_LOG_DETAIL_MAX_CHARS` | 500 | server cap on any log detail string |

## Turn off comments on reactions (moderation cannot keep up)

**Flag:** `ripcord.reactionFreeText` · **Env var:** `WTP_RIPCORD_REACTION_FREE_TEXT`

Added 2026-08-18 (P03/T05), on the author's order in the same instruction
that unblocked free text for the testing window. Ships **live**.

Pulling it stops the optional comment box being captured. Same procedure as
above with value `pulled`; restore with `live`.

**What a pull does, exactly:**

* The **button answer still counts.** Free text is the part with the open
  question; reaction capture is the revenue path. Taking the second down to
  close the first would cost more than it saves, so it does not.
* The comment is **dropped, not stored and hidden.** Nothing lands in
  `reactions.free_text` while the flag is out.
* The reader is **told**, in the same response: the route sets
  `x-wtp-free-text: closed` and the control renders "Your answer was
  counted. Comments are turned off right now, so what you typed wasn't
  saved." A pull that silently swallowed somebody's words would be a lie
  wearing a success state.
* **Rows already stored are untouched.** A capture switch never rewrites
  history.

**What a pull is NOT for.** Nothing downstream needs it: the aggregation
input type has no field for free text, so a verbatim cannot reach a total or
an export whatever position this flag is in. This flag governs capture only.
If the worry is what is already stored, that is moderation
(`docs/abuse-policy.md`), not this switch.

**Prefer nothing over pulling** — there is no threshold to tune here. It is
on or off.

## Turn off the grounded Ask answer (a generated sentence is wrong)

**Flag:** `ripcord.askGrounded` · **Env var:** `WTP_RIPCORD_ASK_GROUNDED`

Added 2026-08-27 (ASK01/ASK02). Ships **live**. Same procedure as above with
value `pulled`; restore with `live`.

This is a DIFFERENT flag from `ripcord.askClassifier`, and the difference is
the whole reason it exists. The classifier picks one topic id out of a fixed
list and writes none of the answer. This rung **writes the sentence a reader
reads**, from records the app retrieved and handed it.

**What a pull does, exactly:**

* Both model rungs stop — the interpretation call and the synthesis call.
  `/api/ask/grounded` returns `{ mode: "OFF" }` and answers nothing itself.
* **The reader still gets an answer.** The map panel falls back to the
  deterministic keyword-and-corpus product it already was, and the ballot
  surface renders the structured records and named gaps it was already given.
  Degradation runs grounded → structured → honest gap, and never grounded →
  plausible.
* **Nothing stored changes**, because this rung stores nothing at all.

**Pull it if** a generated sentence is found to state something the records do
not support. `lib/ask/validate.ts` is meant to make that impossible — it
rejects an invented source URL, a substituted subject, voting advice, a verdict
on ourselves, internal vocabulary, and an answer whose records all sit on the
wrong side of the tense that was asked for — and a rejected answer is DISCARDED
rather than repaired. This flag is what to reach for when that turns out not to
have been enough.

## The FEC contributor ripcord

Documented for completeness; the procedure is identical (env var, value
`pulled` or `live`, trigger deploy).

- `ripcord.fecContributorDisplay` / `WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY`
  — kills the contributor-level display and its reaction control. Ships
  live. **Counsel closes the underlying question (D23), nobody else.** This
  one is unchanged: § 30111(a)(4) restricts commercial use of FEC
  contributor DATA, and that question is still open.

Funding reactions in aggregates count like every other reaction. FEC
contributor records themselves are never sold.

## After any pull

Record what was pulled, when (UTC), and why in `docs/defects.md` — one
loose entry is enough; the next session turns it into tracker bookkeeping.
The committed defaults in `lib/ripcords.ts` are the state of record: if a
pull is to become permanent, a session should change the committed default
and remove the env var.
