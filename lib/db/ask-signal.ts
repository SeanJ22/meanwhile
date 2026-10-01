import { createHash } from "node:crypto";

import {
  contactShapesIn,
  scrubContactShapes,
  scrubFreeText,
  SCRUB_MARK,
} from "../log/scrub.ts";
import {
  coverageTierForOcdIds,
  encodeTierDistribution,
  tierDistributionForOcdIds,
} from "../coverage/zip-tier.ts";
import { redactSelfDisclosure, type SelfDisclosureFlag } from "../speak/self-disclosure.ts";
import type { AnswerMode } from "../ask/trace.ts";
import type { EvidenceProvenance } from "../ask/evidence.ts";
import type { LocationConfidence, ResidencyRelation } from "../ask/residency.ts";

/**
 * **THE ASK INTERACTION WRITE PATH.** (ASK03, 2026-08-27.)
 *
 * Capture is on (Sean, 2026-10-01): every Ask is saved once the reader's device
 * carries the anonymous continuity key, which the Ask surfaces mint. The
 * former Ask-capture switch is removed; the one disclosure lives on
 * "What this site collects".
 *
 * `app/api/ask/grounded/route.ts` calls it after the delivered answer, mode and
 * evidence are known, so the row describes what the reader actually received.
 *
 * ## The continuity key has its own digest space, and that is the boundary
 *
 * Four stores now hash a browser-minted key. If they all digested the raw
 * value they would produce the SAME hash for the same browser — equality
 * joinable across stores the constitution says share no key, on a value nobody
 * would have to look up. The prefix is the whole boundary.
 *
 *   reactions       sha256(rawKey)                       (its own, unprefixed)
 *   speak your mind sha256("speak-your-mind:" + key)
 *   intake limiter  sha256("intake-limiter:" + key)
 *   ask             sha256("ask-interaction:" + key)     <- this file
 */

const ASK_KEY_PREFIX = "ask-interaction:";
const ASK_RUN_PREFIX = "ask-run:";

/** The continuity digest. Counts DISTINCT READERS; never a buyer-visible id. */
export function askKeyHash(key: string): string {
  return createHash("sha256").update(`${ASK_KEY_PREFIX}${key}`).digest("hex");
}

/** Namespaced like every other run id, for the same reason. */
export function askRunHash(runId: string): string {
  return createHash("sha256").update(`${ASK_RUN_PREFIX}${runId}`).digest("hex");
}

export interface AskInteractionInput {
  /** RAW reader text. Scrubbed here, at the single write path, never before. */
  question: string;
  intent: string;
  temporalKind: string;
  subjectIds: string[];
  resolutionState: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
  answerMode: AnswerMode;
  /** RAW delivered answer. Scrubbed here too — see `prepareAskInteraction`. */
  answerText: string | null;
  answerModel: string | null;
  validationPassed: boolean | null;
  evidenceRecordCount: number;
  evidenceSourceCount: number;
  namedGapCount: number;
  /**
   * WHICH records and WHICH sources, not just how many. The counts alone could
   * never answer "what evidence supported the answer readers saw?", which is
   * the only question this store exists to be audited against.
   */
  evidenceProvenance: EvidenceProvenance;
  surface: "MAP" | "BALLOT" | "UNKNOWN";
  /**
   * COARSE ORIENTATION ONLY. Normalized on the way in — see
   * `normalizeApproximateLocation`, and the reason it is not a passthrough.
   */
  approximateLocation: string | null;
  ocdIds: string[];
  divisionVintage: string;
  residencyRelation: ResidencyRelation;
  locationConfidence: LocationConfidence;
  coverageTier: "TIER_0" | "TIER_1" | "TIER_2" | "TIER_3" | "UNKNOWN";
  coverageTierDistribution: string;
  /** The browser-minted continuity value, RAW. Digested here, never stored raw. */
  continuityKey: string;
  runClass?: "ORGANIC" | "SYNTHETIC" | "UNKNOWN" | "AUTHOR";
  runId?: string | null;
  occurredAt: string;
}

export interface AskInteractionRow {
  occurredAt: string;
  questionScrubbed: string;
  /** The SCRUBBED delivered answer. Never the reader-visible copy. */
  answerText: string | null;
  /** Flags from the question AND the answer, merged. `exportsVerbatim` reads it. */
  selfDisclosure: string[];
  intent: string;
  temporalKind: string;
  subjectIds: string[];
  resolutionState: AskInteractionInput["resolutionState"];
  answerMode: AnswerMode;
  answerModel: string | null;
  validationPassed: boolean | null;
  evidenceRecordCount: number;
  evidenceSourceCount: number;
  namedGapCount: number;
  evidenceRecordRefs: string[];
  evidenceSourceUrls: string[];
  evidenceSourceOrgs: string[];
  evidenceRetrievedFrom: string | null;
  evidenceRetrievedTo: string | null;
  surface: AskInteractionInput["surface"];
  approximateLocation: string | null;
  ocdIds: string[];
  divisionVintage: string;
  residencyRelation: ResidencyRelation;
  locationConfidence: LocationConfidence;
  coverageTier: AskInteractionInput["coverageTier"];
  coverageTierDistribution: string;
  askKeyHash: string;
  runClass: "ORGANIC" | "SYNTHETIC" | "UNKNOWN" | "AUTHOR";
  runId: string | null;
}

/** How long a stored question may be. The roadmap needs it, never a novel. */
export const ASK_QUESTION_MAX_CHARS = 400;
/** And the answer. Long enough to be the answer, short enough to be a row. */
export const ASK_ANSWER_MAX_CHARS = 4000;

/**
 * **WHAT `approximateLocation` IS ALLOWED TO MEAN.**
 *
 * The field is documented as coarse orientation and the request body is the
 * reader's browser, which means without this the column's contents are whatever
 * a client chose to send. A surface that one day passes a full street address
 * into a field an export path reads as "a ZIP, roughly" would not fail — it
 * would silently upgrade the precision of a column whose whole documented
 * value is that it is imprecise, and every aggregate built on it afterwards
 * would be wrong about what it was aggregating.
 *
 * So the meaning is ENFORCED rather than documented: a five-digit ZIP, or a
 * short place label with no digits in it. Anything else — an address, a
 * lat/long pair, a ZIP+4, a sentence — is refused and stored as null, which is
 * an honest "we did not record one" rather than a precise thing wearing a
 * coarse label.
 */
export function normalizeApproximateLocation(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{5}$/.test(value)) return value;
  /* A place label: letters, spaces and the ordinary punctuation of a place
     name. No digits at all, because every precision risk here arrives as a
     number — a house number, a ZIP+4, a coordinate. */
  if (value.length <= 60 && /^[A-Za-z][A-Za-z\s.,'’-]*$/.test(value)) return value;
  return null;
}

/**
 * **THE STORED ANSWER IS SCRUBBED, NOT JUST TRUNCATED.**
 * (The defect this closes, 2026-08-28.)
 *
 * The first version scrubbed the question and merely `slice()`d the answer.
 * That is a redaction with a hole in it: a reader writes *"My name is Alma
 * Hernandez and my number is 520-555-0134, when does the board meet?"*, the
 * question column correctly keeps neither — and a synthesis model replying
 * *"Alma, the next meeting is …"* puts the name straight back into the row one
 * column over.
 *
 * Two passes, because there are two ways a value gets there:
 *
 * 1. **Shape.** Email-shaped tokens and long digit runs, anywhere in the
 *    answer, including ones the reader never typed.
 * 2. **Echo.** The exact values the question's own pass removed, struck by
 *    value, case-insensitively. This is the only thing that catches a NAME,
 *    because a name has no shape — and it is why `redactSelfDisclosure`
 *    returns what it took.
 *
 * ## Why this is not `scrubFreeText`
 *
 * Because the third shape that pass carries — *a number followed by
 * capitalised words* — is also the shape of every spelled-out date this
 * product deliberately prints. Run over an Ask answer, it turns *"the board
 * meets on 8 September 2026"* into *"the board meets on [#]"* and flags the row
 * as containing a street address. That is a redaction that destroys the field's
 * entire analytic value and files a false fact about the row while doing it,
 * and it was caught by `tests/ask-signal.test.ts` asserting that a clean
 * question discloses nothing.
 *
 * An address the READER typed is still removed — by the echo pass, which
 * matches the exact value rather than the shape. What survives is an address
 * that appears in an answer because a public record contains it, which is where
 * a public meeting is held and is not anybody's private information.
 *
 * The reader's answer on screen is untouched. This is the stored copy, and
 * quietly rewriting what a person read in order to make analytics tidy would be
 * a different and worse defect.
 */
/**
 * One literal string, as a regex that matches exactly itself.
 *
 * A reader's self-introduced value is arbitrary text and can legitimately
 * contain regex metacharacters — a name with a dot in it, an address with
 * brackets. Interpolating it unescaped would either throw or, worse, match
 * something it should not, so the strike would silently miss the value it
 * exists to remove.
 */
function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
}

/**
 * **THE VALUE, AND ITS PARTS — because an echo is rarely verbatim.**
 * (Found by the plant, 2026-08-28.)
 *
 * The question's pass captures *"Alma Hernandez"*. A model replying politely
 * writes *"Alma, the board meets on …"*. Striking only the whole captured
 * string leaves the given name in the stored answer, which is the exact defect
 * the echo pass exists to close — closed for the full name and open for the
 * form a person is actually called by.
 *
 * So each multi-word value contributes its words as well. Three characters is
 * the floor, for the reason `MIN_MENTION_CHARS` exists elsewhere in this
 * repository: shorter tokens are punctuation debris and ordinary words, and
 * striking those would redact the answer rather than the disclosure.
 *
 * Longest first, so *"Alma Hernandez"* is replaced as one mark rather than as
 * two adjacent ones.
 */
function echoTargets(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 1) out.add(trimmed);
    if (/\s/.test(trimmed)) {
      for (const word of trimmed.split(/\s+/)) {
        if (word.length >= 3) out.add(word);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function scrubStoredAnswer(
  answer: string,
  redactedValues: readonly string[] = [],
): { text: string; flags: SelfDisclosureFlag[] } {
  const flags = new Set<SelfDisclosureFlag>();
  const shapes = contactShapesIn(answer);
  if (shapes.email) flags.add("EMAIL");
  if (shapes.digits) flags.add("PHONE_OR_NUMBER");

  let text = scrubContactShapes(answer);

  for (const value of echoTargets(redactedValues)) {
    if (!value) continue;
    /* Word-bounded, so striking "Alma" cannot cut "Almanac" in half and leave
       a stored answer that reads as though we mangled our own prose. */
    const pattern = new RegExp(`\\b${escapeLiteral(value)}\\b`, "gi");
    if (pattern.test(text)) {
      text = text.replace(pattern, SCRUB_MARK);
      /* An echoed self-introduced value is a self-disclosure ON THIS ROW,
         whichever column it reached. The export gate reads the merged set. */
      flags.add("SELF_NAMED");
    }
  }

  return { text: text.trim(), flags: [...flags] };
}

/**
 * **THE COVERAGE STAMP IS TAKEN HERE, at the write path, and not in a route.**
 *
 * The per-government tier DISTRIBUTION is a stored field and
 * `tests/coverage-tier.test.ts` bans it from `app/` and `components/`
 * outright — the floor tier is the only tier a reader is ever told, and a
 * second coverage number on a reader surface is a number the reader has to
 * reconcile against the first. Deriving it inside the API route put it in the
 * reader's tree, and the guard caught that the moment it was written.
 *
 * The store owning its own stamp is also simply the better shape: the route
 * hands over the divisions it resolved, and what is made of them is this
 * module's business.
 */
export function askCoverageStamp(ocdIds: readonly string[]): {
  coverageTier: AskInteractionInput["coverageTier"];
  coverageTierDistribution: string;
} {
  return {
    coverageTier: coverageTierForOcdIds([...ocdIds]),
    coverageTierDistribution: encodeTierDistribution(tierDistributionForOcdIds([...ocdIds])),
  };
}

/**
 * Build the row. **Pure**, so the shape is testable without a database and
 * without the capability being live.
 *
 * The scrub happens HERE and only here, for BOTH free-text fields. There is no
 * second path that writes a question or an answer, so there is no way for raw
 * text to reach the store — which is the difference between a store that is
 * born safe and one that is promised to be.
 */
export function prepareAskInteraction(input: AskInteractionInput): AskInteractionRow {
  const raw = input.question.slice(0, ASK_QUESTION_MAX_CHARS);
  /*
   * **ORDER IS LOAD-BEARING AND IT IS NOT MINE TO CHOOSE.**
   *
   * `redactSelfDisclosure` runs FIRST because, as its own header says, the
   * scrub replaces the very tokens that would have to be detected — asking
   * afterwards reports nothing on every row, which is a pass that always
   * passes. It also strips self-naming, which the scrub knows nothing about.
   * Then the scrub blanks the email, phone and address shapes.
   *
   * This is the store's whole PII posture and it reuses the pass Speak Your
   * Mind already proved rather than a second one written here.
   */
  const disclosure = redactSelfDisclosure(raw);
  const answer = input.answerText
    ? scrubStoredAnswer(
        input.answerText.slice(0, ASK_ANSWER_MAX_CHARS),
        disclosure.redactedValues,
      )
    : null;

  const flags = [...new Set([...disclosure.flags, ...(answer?.flags ?? [])])];

  return {
    occurredAt: input.occurredAt,
    questionScrubbed: scrubFreeText(disclosure.text),
    answerText: answer ? answer.text : null,
    /* The KINDS of thing the reader disclosed about themselves — never the
       values. "they typed an email address" is a fact worth holding; the
       address is the thing this store must never contain. */
    selfDisclosure: flags,
    intent: input.intent,
    temporalKind: input.temporalKind,
    subjectIds: input.subjectIds,
    resolutionState: input.resolutionState,
    answerMode: input.answerMode,
    answerModel: input.answerModel,
    validationPassed: input.validationPassed,
    evidenceRecordCount: input.evidenceRecordCount,
    evidenceSourceCount: input.evidenceSourceCount,
    namedGapCount: input.namedGapCount,
    evidenceRecordRefs: input.evidenceProvenance.recordRefs,
    evidenceSourceUrls: input.evidenceProvenance.sourceUrls,
    evidenceSourceOrgs: input.evidenceProvenance.sourceOrgs,
    evidenceRetrievedFrom: input.evidenceProvenance.retrievedFrom,
    evidenceRetrievedTo: input.evidenceProvenance.retrievedTo,
    surface: input.surface,
    approximateLocation: normalizeApproximateLocation(input.approximateLocation),
    ocdIds: input.ocdIds,
    divisionVintage: input.divisionVintage,
    residencyRelation: input.residencyRelation,
    locationConfidence: input.locationConfidence,
    coverageTier: input.coverageTier,
    coverageTierDistribution: input.coverageTierDistribution,
    askKeyHash: askKeyHash(input.continuityKey),
    runClass: input.runClass ?? "UNKNOWN",
    runId: input.runId ? askRunHash(input.runId) : null,
  };
}

/**
 * What a CALLER supplies. The coverage stamp is derived here rather than passed
 * in, so no route has to name a field the reader's tree is forbidden to hold —
 * a caller may still supply one, and an explicit value wins.
 */
export type AskCaptureInput = Omit<
  AskInteractionInput,
  "coverageTier" | "coverageTierDistribution"
> &
  Partial<Pick<AskInteractionInput, "coverageTier" | "coverageTierDistribution">>;

export type AskCaptureOutcome =
  | { kind: "WROTE" }
  | { kind: "FAILED"; why: string };

/**
 * Write one interaction. A missing continuity key or write path is a normal
 * FAILED return, not an error: the reader's answer is unaffected either way.
 */
export async function captureAskInteraction(
  input: AskCaptureInput,
  write?: (row: AskInteractionRow) => Promise<void>,
): Promise<AskCaptureOutcome> {
  /*
   * **NO CONTINUITY KEY, NO ROW — and this refusal is the point.**
   * (PR #212 follow-up, 2026-08-28.)
   *
   * The Ask surfaces READ their continuity key and never mint one, because
   * minting a new identifier onto a reader's device for a capability that is
   * switched off is storage nobody asked for. So while the flag is down, no
   * browser has one.
   *
   * The failure mode this closes is the quiet one. `askKeyHash("")` is a
   * perfectly good sha256 — of the empty string — and it is the SAME hash for
   * every reader. Enabling capture without also enabling minting would produce
   * a full store of rows that all agree there has only ever been one reader,
   * and the aggregate *"100 interactions from 61 distinct readers"* would read
   * *"from 1"* with nothing anywhere reporting an error.
   *
   * Refusing makes the coupling structural: activation is the disclosure AND
   * the minting AND the flag, and doing two of the three writes nothing.
   */
  if (!input.continuityKey) {
    return { kind: "FAILED", why: "no continuity key — minting is part of activation" };
  }
  const row = prepareAskInteraction({
    ...askCoverageStamp(input.ocdIds),
    ...input,
  });
  if (!write) return { kind: "FAILED", why: "no write path supplied" };
  try {
    await write(row);
    return { kind: "WROTE" };
  } catch (error) {
    return { kind: "FAILED", why: error instanceof Error ? error.message : "unknown" };
  }
}
