/**
 * **COMPILING THE OWNER'S ANSWER KEY INTO SOMETHING A MACHINE CAN CHECK.**
 * (Session B resume, W4, 2026-08-31.)
 *
 * ## What this replaces, and the argument that was wrong
 *
 * `scripts/owner-corpus.mts` wrote every kept question as a template with
 * `applicability: { kind: "PER_ZIP" }` and NO expectation, under a comment
 * arguing that compiling the owner's "What the RIGHT answer looks like" column
 * "would be this loader writing its own answer key."
 *
 * That argument is right about a real danger and wrong about this case. The
 * danger is a machine INVENTING the standard it is then graded against. What
 * is happening here is a machine TRANSCRIBING a standard the owner wrote, into
 * a form a runner can evaluate, with a citation back to the row it came from.
 * The owner's prose remains the authority; the compiled form cites it and never
 * replaces it. Where the prose does not determine a checkable proposition, this
 * module says so FOR THAT ROW and compiles nothing — which is the distinction
 * the old comment collapsed.
 *
 * The cost of collapsing it was 36 instances, 36 NOT_EVALUABLE, and a reader
 * contract that measured nothing while reporting a corpus of nine.
 *
 * ## The two other defects fixed here
 *
 * **Applicability.** Every question got `PER_ZIP`, meaning "one instance per
 * pilot ZIP, no body subject" — so a question that names 85641 in its own text
 * was also asked of 85701, 07866 and 03255, and a question about the Pima
 * County Board of Supervisors was asked of a New Hampshire town. Nine questions
 * became thirty-six instances, of which twenty-seven were about the wrong
 * place. Applicability is now inferred per question from the ZIPs and subjects
 * the question itself names, and an ambiguous row is REPORTED rather than
 * instantiated four times.
 *
 * **Unresolved tokens.** Q1 reads *"at its [F3-date] study session"* and
 * declared `placeholders: []`. The template vocabulary is `[BODY]` and `[ZIP]`;
 * `[F3-date]` is neither, so nothing rendered it and the question went to the
 * Ask box with a literal bracket in it. Anything bracket-shaped that is not in
 * the closed vocabulary is now refused by name.
 */

import type { ReaderExpectation } from "./ask-evaluation.ts";
import type { ApplicabilityRule } from "./reader-question.ts";
import { assertCitableAsEvidence } from "./owner-corpus.ts";
import type { KeptQuestion } from "./owner-corpus.ts";
import type { ControlFact } from "./control-fact.ts";

/** The pilot ZIPs, and the only ZIPs an instance may be built for. */
export const PILOT_ZIPS: readonly string[] = ["85701", "85641", "07866", "03255"];

/** The closed template vocabulary. Anything else in brackets is unresolved. */
export const KNOWN_PLACEHOLDERS: readonly string[] = ["BODY", "ZIP"];

/**
 * Every bracketed token in a string that is NOT part of the closed vocabulary.
 *
 * Deliberately broad: it matches `[F3-date]` and `[date]` and anything else
 * shaped like a token, because the failure being prevented is a template
 * reaching a reader-facing Ask box with a bracket in it, and a narrow matcher
 * tuned to the one token we have seen would not have caught the next one.
 */
export function unresolvedTokens(text: string): readonly string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const token = match[1].trim();
    if (KNOWN_PLACEHOLDERS.includes(token)) continue;
    found.add(match[0]);
  }
  return [...found].sort();
}

/* --------------------------------------------------------- applicability -- */

/**
 * A named subject the questions refer to, and where it governs.
 *
 * Stated as DATA with a `basis` on every row, because this is the one place
 * this module makes a determination the owner did not write down in a column,
 * and a determination nobody can audit is a determination nobody should trust.
 * A question matching none of these and naming no ZIP is reported as ambiguous
 * rather than guessed at.
 */
export interface SubjectHint {
  readonly pattern: RegExp;
  readonly zips: readonly string[];
  /** How the subject should be named in an expectation. */
  readonly subject: string;
  readonly basis: string;
}

export const SUBJECT_HINTS: readonly SubjectHint[] = [
  {
    pattern: /pima county board of supervisors|each supervisor/i,
    zips: ["85701"],
    subject: "Pima County Board of Supervisors",
    basis:
      "the Control facts tab files every Pima County Board of Supervisors row (F1, F2, F3, F5) " +
      "under ZIP 85701",
  },
  {
    pattern: /vail (school-board|candidate|usd)/i,
    zips: ["85641"],
    subject: "Vail school-board candidate committee",
    basis: "the Control facts tab files every Vail row (F6, F7, F8, F9) under ZIP 85641",
  },
  {
    pattern: /newbury/i,
    zips: ["03255"],
    subject: "Newbury, New Hampshire",
    basis: "the Control facts tab files every Newbury row (F10, F11, F12, F19) under ZIP 03255",
  },
  {
    pattern: /morris hills/i,
    zips: ["07866"],
    subject: "the Morris Hills body",
    basis:
      "Morris Hills Regional District serves Rockaway, New Jersey, which is the pilot ZIP 07866 " +
      "the workbook's own Victoria tab covers",
  },
];

/** What applicability the compiler determined, and why — or that it could not. */
export type ApplicabilityVerdict =
  | {
      readonly kind: "RESOLVED";
      readonly rule: ApplicabilityRule;
      readonly basis: string;
    }
  | {
      readonly kind: "AMBIGUOUS";
      /** Named so the owner can answer it in one column. */
      readonly needs: string;
    };

/**
 * Decide where a hand-authored question applies.
 *
 * ```
 *   an explicit 5-digit pilot ZIP in the text   ->  SPECIFIC_ZIPS
 *   a named subject in SUBJECT_HINTS            ->  SPECIFIC_BODY in its ZIPs
 *   neither                                     ->  AMBIGUOUS, reported
 * ```
 *
 * **PER_ZIP is never inferred.** It means "every pilot ZIP, no body subject",
 * which is a strong claim about a question's scope, and it was exactly the
 * wrong default: a bespoke adversarial question written about one government is
 * the least likely question in the corpus to be universally applicable. A
 * genuinely global question is one the owner says is global.
 */
export function inferApplicability(question: KeptQuestion): ApplicabilityVerdict {
  const text = `${question.questionText} ${question.rightAnswer}`;

  const zips = [...new Set([...text.matchAll(/\b(\d{5})\b/g)].map((m) => m[1]))].filter((z) =>
    PILOT_ZIPS.includes(z),
  );
  if (zips.length > 0) {
    return {
      kind: "RESOLVED",
      rule: { kind: "SPECIFIC_ZIPS", zips },
      basis: `the question names ${zips.join(", ")} in its own text`,
    };
  }

  const hint = SUBJECT_HINTS.find((h) => h.pattern.test(text));
  if (hint) {
    return {
      kind: "RESOLVED",
      rule: { kind: "SPECIFIC_BODY", zips: hint.zips, subject: hint.subject },
      basis: `the question names ${hint.subject}; ${hint.basis}`,
    };
  }

  return {
    kind: "AMBIGUOUS",
    needs:
      `${question.id} names no pilot ZIP and no subject this compiler can place. It needs ONE ` +
      "of: the ZIP(s) it applies to, the governing body it is about, or a statement that it is " +
      "genuinely global. It is NOT instantiated meanwhile — asking it of all four pilot ZIPs " +
      "would be the defect this replaces.",
  };
}

/* ----------------------------------------------------------- expectations -- */

/** A compiled expectation, and the workbook text it was compiled FROM. */
export interface CompiledExpectation {
  readonly expectation: ReaderExpectation;
  /** The owner's own words. The authority; the compiled form only cites it. */
  readonly sourceText: string;
  /** Which workbook row(s) the compilation drew on. Always at least this one. */
  readonly sourceRows: readonly string[];
  readonly basis: string;
}

export type ExpectationVerdict =
  | { readonly kind: "COMPILED"; readonly compiled: CompiledExpectation }
  | { readonly kind: "NEEDS_OWNER"; readonly needs: string };

/** A confirmed control fact WITH its workbook Notes, looked up by row id. */
export type FactLookup = (
  id: string,
) => { readonly value: ControlFact; readonly notes: string; readonly status?: string } | null;

/**
 * Compile one question's right-answer prose into a typed expectation.
 *
 * The shapes recognised are stated as a table rather than inferred loosely,
 * and every branch either produces a citation or names what is missing. There
 * is no branch that produces a plausible expectation from an underdetermined
 * description — that is the whole difference between transcription and
 * invention.
 */
export function compileExpectation(
  question: KeptQuestion,
  facts: FactLookup,
  applicability: ApplicabilityVerdict,
): ExpectationVerdict {
  const right = question.rightAnswer.trim();
  if (right.length === 0) {
    return {
      kind: "NEEDS_OWNER",
      needs: `${question.id} has an empty "What the RIGHT answer looks like" column.`,
    };
  }

  const tokens = unresolvedTokens(right);
  if (tokens.length > 0) {
    return {
      kind: "NEEDS_OWNER",
      needs:
        `${question.id}'s right-answer text still contains ${tokens.join(", ")}. An expectation ` +
        "compiled around an unresolved token would assert a period or a subject nobody has " +
        "supplied.",
    };
  }

  const subject =
    applicability.kind === "RESOLVED" && applicability.rule.kind === "SPECIFIC_BODY"
      ? applicability.rule.subject
      : question.id;

  /* ---- a sourced ABSENCE ---- */
  if (/\bsourced absence\b|^none\b|\bnone on file\b|\bno records\b/i.test(right)) {
    const authority = /pima county elections/i.test(right)
      ? "Pima County Elections"
      : /minutes/i.test(right)
        ? "Pima County Board of Supervisors minutes on Legistar"
        : null;
    if (authority === null) {
      return {
        kind: "NEEDS_OWNER",
        needs:
          `${question.id} describes a sourced absence but names no AUTHORITY whose records ` +
          "establish it. A VERIFIED_ABSENCE without an authority is the shape the constitution " +
          "forbids: an absence asserted from our own empty record.",
      };
    }
    return {
      kind: "NEEDS_OWNER",
      needs:
        `${question.id} describes a sourced absence with authority "${authority}", and the ` +
        "PERIOD it covers is not stated in a form this can cite. A VERIFIED_ABSENCE carries " +
        "'through what date', and a compiled one that guessed the date would misdate the " +
        "verification. The workbook's matching Control facts row needs its date filled.",
    };
  }

  /* ---- a concrete VALUE the owner wrote down ---- */
  const money = /\$([\d,]+(?:\.\d{2})?)/.exec(right);
  if (money) {
    return {
      kind: "COMPILED",
      compiled: {
        expectation: {
          kind: "VALUE",
          subject,
          subjectId: null,
          value: `$${money[1]}`,
          acceptedForms: [money[1], `$${money[1]}`, money[1].replace(/,/g, "")],
        },
        sourceText: right,
        sourceRows: [question.id],
        basis:
          `the owner's right-answer column states the figure ${money[0]} explicitly, so the ` +
          "compiled VALUE quotes it rather than deriving one",
      },
    };
  }

  /* ---- a LIST whose members the owner enumerated in a CONFIRMED fact ---- */
  if (/\bper-member\b|\broll-call\b/i.test(right)) {
    const roster = facts("F5");
    /*
     * THE SECOND GUARD. `loadControlFacts` already filters to CONFIRMED, and
     * this checks anyway — because the failure being prevented is a future
     * widening of the loader silently making an unverified row citable, and a
     * filter upstream is not a check at the point of use.
     */
    if (roster) assertCitableAsEvidence("F5", roster.status ?? "");
    const names = roster ? rosterNames(roster.value, roster.notes) : [];
    if (names.length === 0) {
      return {
        kind: "NEEDS_OWNER",
        needs:
          `${question.id} expects per-member rows and no CONFIRMED roster row enumerates the ` +
          "members. Control facts F5 is the roster row; its Notes must list the names for a " +
          "LIST expectation to cite them rather than invent them.",
      };
    }
    return {
      kind: "COMPILED",
      compiled: {
        expectation: {
          kind: "LIST",
          subject,
          subjectId: null,
          members: names,
          /*
           * NOT exhaustive. The owner asked for per-member rows; whether a
           * given meeting's roll call includes every member is a fact about
           * that meeting, and forbidding extras would fail an answer that
           * correctly named a member who joined since.
           */
          exhaustive: false,
        },
        sourceText: right,
        sourceRows: [question.id, "F5"],
        basis:
          "the owner's right-answer column asks for per-member rows, and Control facts F5 — " +
          "which the owner marked CONFIRMED — enumerates the members by name. The compiled " +
          "LIST cites that roster; it does not derive one from our own registry.",
      },
    };
  }

  /* ---- an honest GAP: real, and not expressible in the four typed kinds ---- */
  if (/\bhonest gap\b|not yet ingested|never a fabricated/i.test(right)) {
    return {
      kind: "NEEDS_OWNER",
      needs:
        `${question.id} expects an honest NAMED GAP ("source exists, not yet ingested") rather ` +
        "than a fact. The typed expectation kinds are ENTITY, VALUE, LIST and VERIFIED_ABSENCE, " +
        "and none of them expresses 'the answer must be a gap attributed to US'. This is a gap " +
        "in the EXPECTATION VOCABULARY, not in the owner's row: the row is clear and the " +
        "corpus cannot yet say it. A NAMED_GAP kind would close it.",
    };
  }

  /* ---- a specific location the owner did not name ---- */
  if (/\bspecific location\b|\bpolling\b|where .*vote/i.test(right)) {
    return {
      kind: "NEEDS_OWNER",
      needs:
        `${question.id} expects a specific location or instruction sourced to the county ` +
        "elections authority, and does not say WHICH location. Compiling one would mean " +
        "reading our own voting-sites data and grading the answer against it, which is the " +
        "product checking itself.",
    };
  }

  /* ---- a list the owner described but did not enumerate ---- */
  if (/\blist\b/i.test(right)) {
    return {
      kind: "NEEDS_OWNER",
      needs:
        `${question.id} expects a list and does not enumerate its members. The members are ` +
        "derivable from our own registry, and deriving them there would grade the product " +
        "against itself over exactly the universe it might be missing — which is the coverage " +
        "attack this corpus exists to defeat.",
    };
  }

  return {
    kind: "NEEDS_OWNER",
    needs:
      `${question.id}'s right-answer text does not determine a checkable proposition in the ` +
      `typed vocabulary. The owner wrote: ${JSON.stringify(right.slice(0, 120))}`,
  };
}

/**
 * Names out of a roster fact's free-text notes.
 *
 * The owner types the roster as lines like *"Supervisor Rex Scott District 1"*,
 * and the first line also carries the workbook's own instruction to them:
 * *"List names if quick; Supervisor Rex Scott District 1"*.
 *
 * So the match ANCHORS ON THE TITLE rather than on the start of a line. A
 * line-anchored version captured the instruction as part of the name and put
 * "List names if quick; Supervisor Rex Scott" into the answer key — an
 * expectation the correct answer could never satisfy, which is a RED that says
 * nothing about the product.
 */
export function rosterNames(fact: ControlFact, notesColumn = ""): readonly string[] {
  const text = `${fact.statement}\n${notesColumn}`;
  const names: string[] = [];
  const pattern =
    /(?:Supervisor|Councilmember|Councilman|Councilwoman|Member|Chair|Trustee)\s+(?:Dr\.?\s+)?([^,;\n]+?)\s+District\s+\d+/gi;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].trim();
    if (name.length > 0 && !names.includes(name)) names.push(name);
  }
  return names;
}
