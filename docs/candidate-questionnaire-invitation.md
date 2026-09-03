# The candidate invitation — the message, and it has not been sent

*Written 2026-08-23 (the questionnaire-and-corpora brief, item 1). Nothing in
this file has been sent to anybody. It is a reviewable artifact, and the send is
a separate act by a person.*

The generated list is `data/questionnaire/invitations-nj-morris-2026.json` —
**272 rows, one per candidacy, every row carrying `invitedOn: null` and
`remindedOn: []`** because nothing has gone out.

---

## What the message has to do, and the constraints it is written under

- **Plainly non-partisan.** Nothing that could read as endorsement, as
  solicitation, or as a position of our own. We are not asking them to agree
  with anything and we are not offering them anything.
- **Says what happens to the answer before they write it.** It publishes
  verbatim. Nobody edits it. Nobody summarises it. There is no rating attached
  to it.
- **Says that every opponent got the identical thing on the identical date.**
  That is the whole claim the instrument makes and it is the reason a candidate
  should trust it enough to answer.
- **Gives a way to reach a human**, not a no-reply address.
- **Never implies an obligation.** A candidate owes us nothing, and a message
  that hinted otherwise would make the non-response state prejudicial before the
  first card ever rendered.
- **Register: level.** This is a claim surface — it makes factual statements
  about what we will do with something a real person writes. No jokes, no
  warmth-for-its-own-sake, nothing cute.

---

## The subject line

```
The same five questions we sent everyone running for {OFFICE}
```

---

## The message

> Hello {GIVEN_NAME} {FAMILY_NAME},
>
> We're Meanwhile. We're building a free, non-partisan site that shows
> people what's on their ballot and who is running, using public records —
> filings, meeting records, votes and campaign finance reports.
>
> We're writing to every candidate in this contest on the same day with the same
> five questions. We got your email from the Morris County Clerk's certified
> list of filed candidates for the November 3, 2026 general election.
>
> **What we're asking.** Five questions. Three are the same for everyone running
> for anything; two are about this kind of office. Each answer has a limit of
> 200 words — the same limit for every question and every candidate.
>
> **What happens to your answers.** They publish on your page on our site
> exactly as you write them. We don't edit them, shorten them, summarise them,
> rewrite them, fact-check inside them, rate them or add our own notes to them.
> If you go over the word limit we'll tell you before you send, and you decide
> what to cut — we won't cut it for you.
>
> **You can change or remove them at any time.** Reply to this email and we'll
> send you a new link. If you take your answers down, your page goes back to
> looking exactly like it did before you answered — it will not say that you
> answered and then withdrew.
>
> **If you don't answer.** Your page will say we sent you these questions on
> {PLANNED_INVITED_ON}, that we followed up, and that we haven't had an answer
> yet. It will not say you refused, declined, avoided or ignored anything,
> because none of those would be true — you don't owe us an answer.
>
> **Every other candidate in this contest got this identical email today**, with
> the same questions, the same word limit and the same deadline. That is the
> whole point of doing it this way: what a candidate has published about
> themselves depends a lot on how long they have been in office and how much
> money their campaign has, and this is the one thing on our site where that
> makes no difference at all.
>
> **The deadline is {DEADLINE}.** We'll send two reminders, on
> {PLANNED_REMINDER_1} and {PLANNED_REMINDER_2}, to everyone who hasn't answered
> — the same two reminders to everyone.
>
> Your link: {QUESTIONNAIRE_URL}
>
> It works once. If it stops working or you want to change something, reply to
> this email and we'll send a new one.
>
> If you have a question, or you'd rather not be contacted about this again,
> reply to this email. A person reads it.
>
> — Meanwhile
> {CONTACT_EMAIL}
> {SITE_URL}

---

## The closing note — SEPARATE from the questionnaire

*Added 2026-08-25 with instrument version `v2`. The text is Sean's, verbatim.*

It sits BELOW the signature, under its own rule, in its own section — visually
and structurally outside the message about the questions, so it cannot read as
a sixth question or as a condition on the five. It is a business offer and it
is presented as one.

> One more thing, separate from the questionnaire: Meanwhile offers campaigns
> and organizations anonymized, aggregate insight into what constituents in a
> race care about — available to everyone, at the same published rates. If
> you'd like to hear when insights for your race are available, sign up here.

**There is NO TIMING PROMISE here and none may be added anywhere downstream** —
not in the copy, not in the confirmation, not in the ledger, not in a reply. *If
you'd like to hear when insights for your race are available* is conditional on
availability; a date we then miss would be worse than no date, and this is a
message to somebody standing in a live election.

**The list is stored BUSINESS-SIDE.** It is not reader data. It does not reach
the search log or the reactions store and it shares no joinable column with
either (RULING 132). The copy is held in `lib/questionnaire/instrument.ts` as
`CLOSING_NOTE`, which `questionsFor()` cannot return and `allQuestions()` does
not contain — asserted in `tests/questionnaire.test.ts`, because *structurally
distinct* is a claim and a claim is something a test can hold.

---

## The reminder message

> Hello {GIVEN_NAME} {FAMILY_NAME},
>
> On {PLANNED_INVITED_ON} we sent you five questions for our free, non-partisan
> ballot site. We haven't had an answer, so this is a reminder — we're sending it
> to everyone in this contest who hasn't answered, on the same day.
>
> The deadline is {DEADLINE}. Your link: {QUESTIONNAIRE_URL}
>
> If you'd rather not answer, that's completely fine and you don't need to reply.
> Your page won't say you refused — it will say we asked and haven't heard back.
>
> If you'd rather we stopped emailing you about this, reply and we'll stop.
>
> — Meanwhile
> {CONTACT_EMAIL}

---

## The placeholders, and where each comes from

| Placeholder | Source |
| --- | --- |
| `{GIVEN_NAME}` / `{FAMILY_NAME}` | the candidacy row in `data/states/nj/ballot/nj-morris-2026.json` |
| `{OFFICE}` | the contest title in the same file |
| `{PLANNED_INVITED_ON}` | `plannedInvitedOn` on the invitation row |
| `{PLANNED_REMINDER_1}` / `{PLANNED_REMINDER_2}` | `plannedRemindersOn` on the invitation row |
| `{DEADLINE}` | `deadline` on the invitation row |
| `{QUESTIONNAIRE_URL}` | minted at send time by `lib/questionnaire/auth.ts` — **the token exists only in the sent email and in the candidate's inbox; we store only its SHA-256 digest** |
| `{CONTACT_EMAIL}` | a monitored human address. **Not yet decided — a Needs Sean row.** |
| `{SITE_URL}` | the public site. **Not yet decided — the name is `B01`.** |

---

## What has to be true before this is sent, and none of it is true today

1. **A monitored reply address exists** and a person actually reads it. The
   message promises this three times.
2. **The site is publicly reachable.** This read `sparkwtp.netlify.app` and
   recorded that it was password-walled, so a candidate following the link would
   hit a password prompt. Two things changed on 2026-09-01 (ITEM F): the public
   origin is now `https://meanwhileusa.com`, and `GET https://meanwhileusa.com/`
   answers **200 without a password**, measured on that date. The link in this
   message must therefore be rewritten to the new origin before it is sent. The
   password wall is no longer the blocker; **item 1, item 3 and item 4 still
   are**, and this row does not close on the host change alone.
3. **The questionnaire page exists as a reader-facing surface.** The instrument,
   the schema, the auth and the invitation list are built; the page a candidate
   types into is not.
4. **A sending path exists** that stamps `invitedOn` as it sends, per RULING 107
   — not before, and not from a plan.
5. **Sean has read this message and approved it.** Contacting 272 real
   candidates under this product's name is his call, not a session's.
