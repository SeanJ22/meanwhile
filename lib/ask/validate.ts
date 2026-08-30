import { packSourceUrls, type EvidencePack } from "./evidence.ts";
import { normalizeName } from "../routing/exact-name.ts";

/**
 * **STRUCTURAL VALIDATION — the checks that can actually be made, made
 * (2026-08-27).**
 *
 * ## What this is honest about NOT doing
 *
 * This module does not prove a generated sentence is true. No mechanism here
 * reads meaning, and claiming otherwise would be the same overreach the
 * coverage instrument had to be corrected for: an instrument that reports more
 * confidence than it earned is worse than no instrument, because the number it
 * prints gets believed.
 *
 * What it does is enforce every boundary that IS mechanically decidable, and
 * each of these has a real defect behind it:
 *
 * - **A URL in the answer that is not in the pack.** The single highest-value
 *   check available. A fabricated source link is the most damaging thing this
 *   rung could emit — it survives a skim, it looks like diligence, and it
 *   points a reader at a page that does not say what we said it says.
 * - **A subject the answer names that is not the resolved subject.** The
 *   substitution class, checked at the last possible moment. If the pack is
 *   about Vail and the prose names Sunnyside, that is caught here even if
 *   every earlier rung passed. Checked as a FOREIGN-naming rule over the
 *   known-body universe the caller supplies, never as a demand that the prose
 *   repeat the subject's name — see `subject-not-substituted` below for why
 *   the demand form was itself a defect (NH288).
 * - **Voting advice.** A ranking, a recommendation, a "you should support".
 *   Struck outright rather than trusted to the prompt.
 * - **A verdict on ourselves.** "Unfortunately we failed to find" is struck by
 *   the constitution's own rule that the product never announces its failure.
 *
 * A `FAILED` verdict does not degrade the answer. It DISCARDS it and the
 * caller renders the structured evidence instead — the whole degradation
 * ladder is grounded → structured → honest gap, and never grounded →
 * plausible.
 */

export type ValidationVerdict =
  | { kind: "PASSED"; checked: string[] }
  | { kind: "FAILED"; failed: string[]; checked: string[] };

/** Phrases that constitute telling a reader how to vote. */
const VOTING_ADVICE = [
  /\byou should (?:vote|support|back|choose|pick)\b/i,
  /\bwe recommend\b/i,
  /\bthe best candidate\b/i,
  /\bvote (?:for|against)\b/i,
  /\bbest choice for you\b/i,
];

/** The product never announces its own failure. */
const SELF_VERDICT = [
  /\bunfortunately\b/i,
  /\bwe (?:were unable|failed|could not manage)\b/i,
  /\bi'?m sorry\b/i,
  /\bapolog(?:ies|ise|ize)\b/i,
];

/** Internal vocabulary that must never reach a reader surface. */
const INTERNAL_VOCABULARY = [
  /\bocd-division\b/i,
  /\bNO_SOURCE_FOUND\b/,
  /\b(?:UPCOMING_AGENDA|PAST_MEETING|MEETING_TIME|PERSON_RECORD|TOPIC_OWNER)\b/,
  /\bAGENDA_[A-Z_]+\b/,
  /\bbodyId\b/i,
];

/** Every URL that appears in a body of text. */
export function urlsIn(text: string): string[] {
  return text.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
}

/**
 * A subject the product can resolve, as the foreign-naming check needs it: the
 * canonical id (to know it is not the pack's own subject) and the name a reader
 * would see. The grounded route passes its body inventory; a caller with no
 * universe passes nothing and the check honestly checks nothing.
 */
export interface KnownSubjectName {
  id: string;
  name: string;
}

export function validateAnswer(
  answer: string,
  citedUrls: readonly string[],
  pack: EvidencePack,
  knownSubjects: readonly KnownSubjectName[] = [],
): ValidationVerdict {
  const checked: string[] = [];
  const failed: string[] = [];
  const allowed = packSourceUrls(pack);

  /*
   * URLs are compared after trimming trailing punctuation, because prose ends
   * sentences: "see https://example.gov/agenda." carries a trailing period
   * that is not part of the URL, and failing an answer over a full stop would
   * discard a correct answer — which is its own kind of wrong.
   */
  const normalize = (u: string) => u.replace(/[.,;:)\]}>'"]+$/, "");

  checked.push("no-invented-source-url");
  for (const url of [...urlsIn(answer), ...citedUrls]) {
    if (!allowed.has(normalize(url))) {
      failed.push(`invented-source-url:${normalize(url).slice(0, 120)}`);
      break;
    }
  }

  /*
   * **THE SUBSTITUTION CHECK NAMES THE FOREIGN GOVERNMENT, AND NEVER DEMANDS
   * THE PROSE REPEAT THE SUBJECT.** (NH288, 2026-08-30.)
   *
   * The prior form required the answer to CONTAIN a distinctive token of the
   * subject's name. That was a proxy for "is the answer about someone else",
   * and the proxy failed in the honest direction the day the subject got its
   * real name: the deterministic reader framing already names the body, so
   * generated prose naturally continues "The Board voted 5-0..." — correct,
   * natural anaphora about exactly the resolved subject — and the token rule
   * rejected it. `REJECTED_FELL_BACK`, prose discarded, over sentences that
   * were right. With "Pima" as the subject name the rule had degenerated to
   * "does the prose contain 'pima'", and with the sourced name ("Pima County
   * Board of Supervisors" → pima, supervisors) it still rejects "the Board".
   *
   * What the check exists to catch is the answer being ABOUT a different
   * government, and the mechanically decidable form of that is the prose
   * writing ANOTHER known body's name. So it now scans the caller's known
   * subject universe for a foreign body named in full:
   *
   * - the whole normalized name, as a word sequence — "central arizona water
   *   conservation district" in the prose fails a Pima pack; the word
   *   "arizona" alone never does;
   * - only names of two or more words. A one-word body name is a division
   *   label standing in for a body nothing has named yet ("Mesa"), and prose
   *   mentioning a geography word is not naming a government;
   * - never a name the subject's own name contains — writing the subject
   *   cannot be writing someone else.
   *
   * Structured identity is validated independently of prose either way:
   * `record-belongs-to-resolved-body` below holds the pack's records to the
   * resolved body at the ID level, which is the check the Pima defect actually
   * needed. This rule is the second, narrower wall: explicitly naming a
   * foreign government is refused even when every record is the right body's.
   */
  checked.push("subject-not-substituted");
  if (pack.subject) {
    const subjectName = ` ${normalizeName(pack.subject.name)} `;
    const prose = ` ${normalizeName(answer)} `;
    for (const known of knownSubjects) {
      if (known.id === pack.subject.id) continue;
      const foreign = normalizeName(known.name);
      if (!foreign || !foreign.includes(" ")) continue;
      if (subjectName.includes(` ${foreign} `)) continue;
      if (prose.includes(` ${foreign} `)) {
        failed.push(`answer-names-foreign-subject:${foreign.slice(0, 80)}`);
        break;
      }
    }
  }

  /*
   * **EXACT BODY IDENTITY — the check the substitution class actually needed.**
   * (2026-08-29.)
   *
   * `subject-not-substituted` above compares PROSE against the subject's name,
   * and that is why it could not catch the Pima defect: the pack's subject WAS
   * "Pima", the answer DID say "Pima", and the meeting inside it belonged to
   * the Central Arizona Water Conservation District. Every name in the sentence
   * was the right name. The RECORD was the wrong government's.
   *
   * This is an id comparison and nothing else. Where the subject is a body and
   * a record states which body it belongs to, they must be the same body. No
   * NLP, no heading heuristics, no title matching — the canonical ids exist
   * precisely so this question does not require reading.
   *
   * A record with no `bodyId` is NOT failed. Ballot measures, statewide
   * officeholders and deliberately wider topic sweeps legitimately belong to no
   * single body, and failing them would discard correct answers — which is its
   * own kind of wrong. The check binds exactly where identity is stated.
   */
  checked.push("record-belongs-to-resolved-body");
  if (pack.subject?.kind === "BODY") {
    const foreign = pack.records.find(
      (r) => typeof r.bodyId === "string" && r.bodyId.length > 0 && r.bodyId !== pack.subject!.id,
    );
    if (foreign) {
      failed.push(`record-from-another-body:${foreign.kind}:${foreign.id.slice(0, 80)}`);
    }
  }

  checked.push("no-voting-advice");
  if (VOTING_ADVICE.some((p) => p.test(answer))) failed.push("voting-advice");

  checked.push("no-self-verdict");
  if (SELF_VERDICT.some((p) => p.test(answer))) failed.push("self-verdict");

  checked.push("no-internal-vocabulary");
  if (INTERNAL_VOCABULARY.some((p) => p.test(answer))) failed.push("internal-vocabulary");

  /*
   * A temporal cross-check, available only where the pack actually carries
   * dated records. An answer to a LAST question whose records are all in the
   * future is the defect this pipeline was opened on, caught once more at the
   * end — because the earlier fix is in one function and this is a property of
   * the answer regardless of which path produced it.
   */
  checked.push("temporal-consistency");
  const dated = pack.records.filter((r) => r.occurredAt).map((r) => Date.parse(r.occurredAt!));
  const now = Date.parse(pack.today);
  if (dated.length > 0 && Number.isFinite(now)) {
    if (pack.temporal.kind === "LAST" && dated.every((d) => d > now)) {
      failed.push("past-question-answered-with-future-records");
    }
    if (pack.temporal.kind === "NEXT" && dated.every((d) => d < now)) {
      failed.push("future-question-answered-with-past-records");
    }
  }

  return failed.length > 0 ? { kind: "FAILED", failed, checked } : { kind: "PASSED", checked };
}
