# Abuse Policy

*Draft. Needs review by counsel before launch. Not legal advice.*

Governs free-text reactions users write about candidates, officeholders, and ballot measures. These fields are never displayed to other users — they are stored, filtered, aggregated, and sold. That changes the calculus: this policy protects real people named in the text and protects the integrity of what gets exported, rather than moderating a public square.

---

## Operating principle

Political speech about people seeking or holding power is harsh by design, and harshness is the signal buyers want. A constituent writing that a council member is a corrupt liar who should be run out of town is exactly the sentiment this product exists to capture. Over-filtering degrades the product to guard against a rare case.

The line is not rudeness, contempt, or wishing someone would lose. The line is a statement a reasonable person would read as an intent to commit violence, or content that identifies a target's private location or routine in a way that facilitates harm.

## Tiers

**T0 — Political speech.** Anger, contempt, insult, accusations of corruption or lying, calls to vote someone out, profanity. Retained. Exported. No action.

**T1 — Abusive but not threatening.** Slurs targeting protected characteristics, sexual harassment, degrading content aimed at a person's identity rather than their politics. Retained with flag. Excluded from export. No report. No user notification beyond the standard confirmation.

**T2 — Concerning, ambiguous.** Violent imagery without clear target or intent, references to weapons, statements that read as menacing but could be rhetoric. Retained with flag. Excluded from export. Held for human review within 24 hours.

**T3 — Apparent true threat or targeting.** Statements of intent to harm a specific person, conditional threats tied to an outcome, or disclosure of a target's home address, daily routine, family members, or children's school. Retained with flag and full metadata. Excluded from export. Escalated to human review immediately, target time under 2 hours during business hours.

## Never auto-report

A classifier hit is never sufficient to contact law enforcement. Every report passes human review first.

The failure mode is concrete: "I'd kill for a bike lane on Speedway" and "someone should make sure he doesn't make it to the next meeting" score similarly on most classifiers. Sending police to the first person's house over a figure of speech is a serious harm, and it is the kind of error that ends a product built on trust.

Review asks three questions. Is there an identifiable target. Would a reasonable person read this as intent to commit violence rather than as hyperbole or venting. Is there anything suggesting capability or proximity — mentions of location, schedule, weapons, or prior contact.

## Legal context

Not all threatening-sounding speech is unlawful. The constitutional standard for true threats requires more than that a listener felt threatened; under *Counterman v. Colorado* (2023) the speaker must have had some subjective awareness of the threatening nature of the statement, with recklessness sufficient. Threats against certain federal officials carry their own statutes.

Two practical consequences. First, this is why review is human and why the threshold is deliberately high. Second, we are not the adjudicator — the decision to report is a decision to hand the question to people whose job it is, not a finding that a crime occurred.

Counsel should confirm whether any reporting obligation attaches to us, and should review the escalation contacts below.

## Escalation contacts

Local or county law enforcement where the target is located, for municipal and county officials.

State-level: the agency with protective jurisdiction over state officials, which varies by state and needs to be enumerated per state as coverage expands.

Members of Congress: U.S. Capitol Police Threat Assessment Section, which handles threats to members regardless of where the member is located.

Federal executive officials: the relevant FBI field office.

Maintain the contact list in `docs/escalation-contacts.md` and verify it quarterly. A stale phone number during an incident is a failure.

## Preservation

Flagged content is never deleted. Deletion destroys evidence and forecloses options.

Preserved records retain the text, timestamp, account identifier, IP and user agent at submission, the target entity, the tier assigned, the reviewer, the decision, and the reasoning. Retention is indefinite for T3, seven years for T2, and two years for T1.

Do not edit a preserved record. Corrections are appended, never overwritten.

Preservation applies even if the user deletes their account. The account deletion flow must not cascade to flagged records, and the privacy policy must disclose this exception plainly.

## Account action

T1: content excluded, no account action on first instance. Repeated T1 from one account triggers review for suspension.

T2: no automatic action pending review.

T3: account suspended immediately pending review, before the report decision is made.

Do not notify a user that their content has been escalated to law enforcement. Do not confirm or deny escalation if asked. This is standard practice and protects both the investigation and the reporting party.

## Export integrity

Anything above T0 is excluded from every export, aggregate, and derived metric. Excluded volume is reported to buyers as a count with no content, so aggregates remain auditable without leaking the material.

If exclusions ever exceed a meaningful share of reactions in one race, that fact is itself disclosed to the buyer. A district where a fifth of responses were filtered is a different environment from one where none were, and hiding that misrepresents the data.

## Disclosure to users

Adjacent to every free-text field, plain and short:

> Your words go to the aggregate we sell to campaigns and organizations. Threats of violence are removed and may be reported to law enforcement.

"May," not "will." A stated commitment that isn't honored on every instance is worse than a reserved right.

Keep it small and inline. A modal or a prominent warning suppresses exactly the sentiment the product exists to capture.

## Audit and review

Every review decision is logged with reviewer, timestamp, tier, and reasoning. The log is immutable.

Review the tier definitions and a sample of decisions quarterly, and after every general election. Miscalibration in either direction — filtering ordinary political anger, or letting genuine targeting through — shows up in the sample before it shows up anywhere else.

Publish an annual transparency report with counts by tier, reports made, and account actions taken. This is a trust product; the numbers are an asset, not a liability.

## Typed questions in the ask box

*Added 2026-08-14 (session brief 4). PENDING COUNSEL like the rest of this
document.*

The "Who do I talk to about…?" box stores unanswered questions' text
(capped at 200 characters, scrubbed of phone-, email-, and
street-address-shaped tokens before storage — `lib/log/scrub.ts`) in the
identifier-free search log, to improve routing. Free text about local
government will eventually contain a threat.

Conservative handling, drafted before the first instance rather than
after:

- **Preserve, never render.** A question containing an apparent threat is
  preserved exactly as stored (scrubbed form — the scrub is mechanical
  and runs before anything reads the text), with its row metadata. It is
  never rendered on any surface, never enters routing-improvement work,
  and never appears in any export or aggregate. Deletion destroys
  evidence; rendering spreads harm. Neither happens.
- **Flag for the author.** Review of the refusal log is a human task; a
  threat found there is set aside for the author's judgment under the
  same tiers as reaction free-text (T2/T3 above). The same three review
  questions apply, with one honest caveat: the row is identifier-free by
  design, so "identifiable target" can only ever mean the person named
  IN the text, and there is structurally no way to identify the writer.
- **Never auto-report.** Unchanged from the rest of this policy: a
  classifier or keyword hit is never sufficient; every report passes
  human review first. The identifier-free design means a report could
  only ever hand law enforcement the text and its approximate area,
  never a writer — counsel should weigh whether that changes the
  reporting calculus in either direction.
- **No new disclosure surface yet.** The ask box stores questions only on
  refusal, and the transparency page states the capture, the cap, and
  the scrub. The threat-notice sentence that sits beside reaction
  free-text fields is not yet on the ask box because the ask box is not
  a free-text-about-a-person surface; if the refusal log's contents
  prove otherwise, the notice extends to it.

## The feedback form

*Added 2026-08-17 (R40). PENDING COUNSEL like the rest of this document.*

The in-app feedback form (`/feedback`) is the third free-text intake, after
reaction free-text and the ask box. Its store holds the message, the time,
and which entry point it came through — no name, no address, no zip, no
device key, and nothing joinable to any other store. The message is scrubbed
of phone-, email-, and street-address-shaped tokens before storage
(`lib/log/scrub.ts`, T09), at the single write path.

**Handling is the ask box's, for the same reason.** A form inviting "what is
wrong" will eventually receive a threat about a named official.

- **Preserve, never render.** There is no surface anywhere that displays
  feedback back to a reader, so this is structural rather than a discipline:
  the only read path is `scripts/read-feedback.mts`, run by the author.
  Deletion destroys evidence; nothing auto-deletes, including rows the rate
  limiter quarantined.
- **Flag for the author.** The same T1/T2/T3 tiers and the same three review
  questions, with the same honest caveat the ask box carries: the store is
  identifier-free by design, so "identifiable target" can only ever mean the
  person named IN the text, and there is structurally no way to identify the
  writer.
- **Never auto-report.** Unchanged. Every report passes human review first.

**Rate limiting, and why it is not the reaction limiter's numbers.** The
adversary model driving the reaction protections — a funded campaign faking
district signal — does not reach this surface: feedback enters no aggregate
and no export, so faking it buys nothing except the author's reading time.
The protections are therefore proportionate rather than maximal: same-origin,
an in-memory per-key and per-IP window, a 2,000-character cap, and one
authoritative cross-instance counter. That counter lives in the intake
limiter's own table under a SEPARATE digest space (`feedback-limiter:` rather
than `intake-limiter:`), so a reader who has been answering questions all
afternoon can still report a wrong number, and someone pumping this form is
not spending a budget that also gates reactions. Past the soft threshold a
message still lands, quarantined and excluded from nothing that matters
(there is nothing to exclude it from) but flagged for the author — a
genuinely angry person is never silently dropped.

**No threat notice on the field, and the reason.** The notice that sits beside
reaction free-text names a specific consequence of a specific bargain: those
words go into an aggregate that is sold. Feedback is sold to nobody and shown
to nobody, so the sentence would be describing something that does not
happen. The page states what IS true — stored, read by one person, never
aggregated, and unable to be replied to. If the contents prove this reasoning
wrong, the notice extends here on the same terms it would extend to the ask
box.

**The open question the build left open, for the author.** The form collects
no way to reach the writer, and the scrub would eat one typed into the
message. That is the strictest reading of "identifier-free beyond what the
reader types," and it costs something real: a person asking a question gets no
answer, and a person asking for their photograph to be removed gets no
confirmation. Whether an OPTIONAL, deliberately-supplied reply address should
be stored — unscrubbed, in its own nullable column, with its own disclosure —
is a user-data-field decision and therefore the author's, not the builder's.
Tracker row R41.

## Open items for counsel

Whether any affirmative reporting duty attaches, and in which states.

Whether the preservation-through-account-deletion exception survives state privacy statutes, particularly in California.

Whether acting as a delivery channel for user messages to elected officials changes our exposure, and what that requires in the terms of service.

What the terms of service must say for suspension and preservation to be enforceable.
