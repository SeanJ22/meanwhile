import type {
  BallotAbsence,
  BallotSet,
  Candidacy,
  Contest,
  Measure,
} from "../ballot/types.ts";
import type { BindableEntity } from "../routing/named-entity.ts";
import { COMMON_QUESTION_NOUNS } from "../routing/named-entity.ts";
import { formatDateLong } from "../text/format-date.ts";

import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/**
 * **THE BALLOT'S OWN ENTITIES, AS THINGS ASK CAN RESOLVE AND RETRIEVE FROM.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * ## What was actually shipped, and why it looked like it worked
 *
 * `BallotAsk` sent the page's contest titles and candidate names as
 * `activeSubjects`. They reached the interpretation rung as prose and went no
 * further: the canonical inventory the binder resolves against was **meeting
 * bodies plus statewide executives derived from the reader's divisions**, and
 * nothing else. So the ballot contributed context to a model and zero entities
 * to the product.
 *
 * Katie Hobbs answered correctly on that surface, which is what made the gap
 * hard to see. She answered because she is a sitting statewide executive in
 * `lib/officials/statewide-executives.ts` — not because she is on the reader's
 * ballot. Ask the same surface about **Andy Biggs**, who is on the same
 * governor line, and the product held no such entity. Every challenger, every
 * non-statewide candidate, every contest and every one of the fifteen
 * propositions was unresolvable on the page that renders them.
 *
 * ## The rule this module follows
 *
 * **Ballot truth is not duplicated here.** Every id, name, party, question text
 * and absence below is READ from the committed ballot set the page itself
 * renders from — the same `BallotSet`, through the same source registry. This
 * module turns those records into two things Ask needs and the ballot store
 * does not provide:
 *
 * 1. `BindableEntity` rows, so the binder can resolve a name the reader typed.
 * 2. `EvidenceRecord` rows scoped to ONE canonical id, so retrieval selects
 *    exactly the records belonging to the subject that bound.
 *
 * ## Aliases exist because readers do not type filing titles
 *
 * The clerk files *"Proposition 141: Prohibit tax; monitoring; vehicle
 * mileage"*. A reader types *"Prop 141"*. The binder requires EVERY
 * distinctive token of a name to appear in the question, which is the
 * conservative property that keeps it from inventing matches — and it means
 * the filing title can never be bound by a person.
 *
 * So a measure contributes three entity rows sharing ONE canonical id: the
 * filing title, `Proposition 141`, and `Prop 141`. Sharing the id is what
 * makes this safe: `bindNamedEntity` treats a tie as ambiguous only across
 * DISTINCT ids, so three rows for one measure resolve to one measure rather
 * than to a clarification.
 */

/** What a resolved ballot entity actually is, kept beside the binder row. */
export interface BallotSubjectRecord {
  kind: "CONTEST" | "PERSON" | "MEASURE";
  /** The canonical id: `contest.id`, or the candidate's target key. */
  id: string;
  /** The reader-facing name. */
  name: string;
  contestId: string;
  contestTitle: string;
  ocdId: string;
  /**
   * The FILING row behind a general-election nominee, where one exists.
   *
   * The two stores key the same human differently — the filing calls them
   * `ballot-az-pima:governor:biggs-andy` and the general lineup keys them
   * `ballot-az-pima:governor|Andy Biggs` — and `app/ballot/page.tsx` renders
   * the LINEUP key wherever a lineup exists. Carrying both on one subject is
   * what stops one person becoming two entities and a question about them
   * becoming a clarification the reader cannot possibly answer.
   */
  candidacyId?: string | null;
}

export interface BallotAskInventory {
  entities: BindableEntity[];
  /** Canonical id -> what it is. The retrieval side of the same answer. */
  subjects: Map<string, BallotSubjectRecord>;
}

/**
 * A candidate's target key — the SAME key the ballot page uses for positions,
 * funding and incumbency.
 *
 * Filed candidacies carry their own id. General-lineup nominees, who have no
 * filing row, are keyed `<contestId>|<name>` — `app/ballot/page.tsx` builds
 * exactly that string in four places, and re-deriving it differently here
 * would produce an id that resolves to a person and retrieves nothing.
 */
export function candidateTargetKey(contestId: string, name: string): string {
  return `${contestId}|${name}`;
}

/** As filed: given name then family name, the way the cards render it. */
export function candidacyDisplayName(candidacy: Candidacy): string {
  return [candidacy.givenName, candidacy.familyName].filter(Boolean).join(" ");
}

/**
 * A surname worth offering as an alias.
 *
 * Short surnames and surnames that are ordinary question vocabulary are
 * skipped, for the reason `COMMON_QUESTION_NOUNS` exists: a one-token entity
 * whose token is a word people use to ASK captures questions it has nothing to
 * do with. This is the conservative direction — a skipped alias costs a reader
 * who typed only a surname one clarification, and a wrong alias costs them an
 * answer about the wrong person.
 */
function usableSurname(familyName: string): boolean {
  const token = familyName.trim().toLowerCase();
  return (
    token.length >= 4 &&
    !token.includes(" ") &&
    !COMMON_QUESTION_NOUNS.has(token)
  );
}

/** `Proposition 141` and `Prop 141` from `Proposition 141: ...`, or nothing. */
export function measureDesignations(title: string): string[] {
  const match = /^(proposition|prop|question|measure)\s+([0-9]+[a-z]?)/i.exec(title.trim());
  if (!match) return [];
  const number = match[2];
  return [`Proposition ${number}`, `Prop ${number}`];
}

/**
 * Build the canonical Ask inventory for one reader's ballot.
 *
 * `contests` is the MATCHED subset — the contests this reader's divisions
 * actually reach — rather than the whole set, so a reader cannot resolve a
 * measure from a county they do not live in and then be handed its records as
 * though they were on their ballot.
 */
export function ballotAskInventory(
  set: BallotSet | null,
  contests: readonly Contest[],
  nomineesFor: (contestId: string) => readonly { name: string; partyLabel?: string | null }[] = () => [],
): BallotAskInventory {
  const entities: BindableEntity[] = [];
  const subjects = new Map<string, BallotSubjectRecord>();
  if (!set) return { entities, subjects };

  const add = (
    id: string,
    name: string,
    nameClass: BindableEntity["nameClass"],
    divisionType: string,
    subject: BallotSubjectRecord,
  ) => {
    entities.push({ id, name, nameClass, divisionType });
    if (!subjects.has(id)) subjects.set(id, subject);
  };

  for (const contest of contests) {
    const isMeasure = contest.type === "MEASURE";
    const record: BallotSubjectRecord = {
      kind: isMeasure ? "MEASURE" : "CONTEST",
      id: contest.id,
      name: contest.title,
      contestId: contest.id,
      contestTitle: contest.title,
      ocdId: contest.ocdId,
    };

    add(
      contest.id,
      contest.title,
      "body",
      isMeasure ? "measure" : "contest",
      record,
    );
    if (isMeasure) {
      for (const designation of measureDesignations(contest.title)) {
        add(contest.id, designation, "body", "measure", record);
      }
    }

    if (isMeasure) continue;

    const filed = set.candidacies.filter((c) => c.contestId === contest.id);
    const nominees = nomineesFor(contest.id);

    /*
     * **ONE PERSON, ONE ENTITY — and the general lineup decides which key.**
     * (Found by the route-level red control, 2026-08-28.)
     *
     * Where a source publishes a general-election lineup, `app/ballot/page.tsx`
     * renders THOSE people and keys them `<contestId>|<name>`. The filing list
     * carries the same humans under `<contestId>:<surname>-<given>`. Adding
     * both produced two entities for Andy Biggs with two distinct ids, so the
     * binder — correctly, by its own rule — called a question about him
     * AMBIGUOUS and the reader was asked which Andy Biggs they meant.
     *
     * A false clarification is worse than a missing one: it is the product
     * telling a reader their question is unclear when it was not, about a
     * distinction that exists only in our storage.
     *
     * So the lineup is canonical where it exists, the filing row rides along as
     * `candidacyId` so retrieval still reaches it, and a filed candidate the
     * lineup does not carry is not on this reader's general-election ballot and
     * is not offered as a subject for it.
     */
    if (nominees.length > 0) {
      for (const nominee of nominees) {
        if (!nominee.name) continue;
        const id = candidateTargetKey(contest.id, nominee.name);
        if (subjects.has(id)) continue;
        const wanted = nominee.name.trim().toLowerCase();
        const match = filed.find(
          (c) => candidacyDisplayName(c).trim().toLowerCase() === wanted,
        );
        const surname = match?.familyName ?? nominee.name.trim().split(/\s+/).pop() ?? "";
        const personRecord: BallotSubjectRecord = {
          kind: "PERSON",
          id,
          name: nominee.name,
          contestId: contest.id,
          contestTitle: contest.title,
          ocdId: contest.ocdId,
          candidacyId: match?.id ?? null,
        };
        add(id, nominee.name, "person", "person", personRecord);
        if (usableSurname(surname)) {
          add(id, surname, "person", "person", personRecord);
        }
      }
      continue;
    }

    /* No lineup: the authority's own filing list IS the ballot. */
    for (const candidacy of filed) {
      const name = candidacyDisplayName(candidacy);
      if (!name) continue;
      const personRecord: BallotSubjectRecord = {
        kind: "PERSON",
        id: candidacy.id,
        name,
        contestId: contest.id,
        contestTitle: contest.title,
        ocdId: contest.ocdId,
        candidacyId: candidacy.id,
      };
      add(candidacy.id, name, "person", "person", personRecord);
      if (usableSurname(candidacy.familyName)) {
        add(candidacy.id, candidacy.familyName, "person", "person", personRecord);
      }
    }
  }

  return { entities, subjects };
}

/** The evidence subject for a resolved ballot entity. */
export function ballotSubject(record: BallotSubjectRecord): EvidenceSubject {
  return {
    kind: record.kind === "PERSON" ? "PERSON" : record.kind,
    id: record.id,
    name: record.name,
    office: record.kind === "PERSON" ? record.contestTitle : null,
  };
}

export interface BallotRetrievalDeps {
  set: BallotSet;
  contests: readonly Contest[];
  absences: readonly BallotAbsence[];
  /** Sourced positions for a candidate target key. Empty is a real answer. */
  positions?: (targetKey: string) => readonly {
    issueLabel: string;
    quote: string;
    documentUrl: string;
    retrievedAt: string;
  }[];
  /** The plain-language measure summary and the analysis it cites. */
  measureSummary?: (contestId: string) => { summary: string; summarizesUrl: string } | null;
  /** What a measure would actually change, provision by provision. */
  measureProvisions?: (contestId: string) => readonly {
    id: string;
    label: string;
    what: string;
    citesUrl: string;
  }[];
  /** General-election nominees for a contest, where the source has them. */
  nominees?: (contestId: string) => readonly { name: string; partyLabel?: string | null }[];
}

/**
 * The records belonging to ONE resolved ballot subject, and nothing else.
 *
 * Every branch selects on a canonical id — `contestId`, the candidate's target
 * key, the measure's contest id. Nothing here matches on a display name, which
 * is the whole difference between this and what shipped: a name-matched
 * retrieval would hand a reader asking about one Chris King the records of
 * another.
 */
export function ballotRecordsFor(
  record: BallotSubjectRecord,
  deps: BallotRetrievalDeps,
): { records: EvidenceRecord[]; denominators: Record<string, number> } {
  const records: EvidenceRecord[] = [];
  const denominators: Record<string, number> = {};
  const contest = deps.contests.find((c) => c.id === record.contestId) ?? null;

  if (contest) {
    records.push({
      kind: "CONTEST",
      id: contest.id,
      /* The date SPELLS OUT. This record renders verbatim to a reader whenever
         synthesis is unavailable or rejected, and `2026-11-03` is an
         identifier rather than something a person says — the product-wide
         convention `formatDateLong` carries. */
      text:
        `${contest.title} appears on this ballot for ${deps.set.election.name}` +
        ` on ${formatDateLong(deps.set.election.date) ?? deps.set.election.date}.` +
        ` Voters choose ${contest.voteFor}` +
        `${contest.termYears ? `, for a term of ${contest.termYears} years` : ""}.` +
        (contest.scopeNote ? ` ${contest.scopeNote}` : ""),
      occurredAt: deps.set.election.date,
      sourceUrl: contest.provenance?.sourceUrl ?? null,
      sourceOrg: contest.provenance?.sourceOrg ?? null,
      retrievedAt: contest.provenance?.collectedAt ?? null,
    });
  }

  if (record.kind === "MEASURE") {
    const measures = deps.set.measures.filter((m) => m.contestId === record.contestId);
    denominators.measureRecordsForThisQuestion = measures.length;
    for (const measure of measures) records.push(...measureRecords(measure));

    const summary = deps.measureSummary?.(record.contestId) ?? null;
    if (summary) {
      records.push({
        kind: "MEASURE_SUMMARY",
        id: `${record.contestId}#summary`,
        text: summary.summary,
        sourceUrl: summary.summarizesUrl,
      });
    }
    const provisions = deps.measureProvisions?.(record.contestId) ?? [];
    denominators.provisionsRecorded = provisions.length;
    for (const provision of provisions) {
      records.push({
        kind: "MEASURE_PROVISION",
        id: provision.id,
        text: `${provision.label}: ${provision.what}`,
        sourceUrl: provision.citesUrl,
      });
    }
    return { records, denominators };
  }

  if (record.kind === "CONTEST") {
    const candidacies = deps.set.candidacies.filter((c) => c.contestId === record.contestId);
    denominators.candidatesFiledForThisContest = candidacies.length;
    for (const candidacy of candidacies) records.push(candidacyRecord(candidacy, record.contestTitle));

    const nominees = deps.nominees?.(record.contestId) ?? [];
    denominators.generalElectionNominees = nominees.length;
    for (const nominee of nominees) {
      records.push({
        kind: "CANDIDACY",
        id: candidateTargetKey(record.contestId, nominee.name),
        text:
          `${nominee.name} is on the general-election ballot for ${record.contestTitle}` +
          `${nominee.partyLabel ? `, filed as ${nominee.partyLabel}` : ""}.`,
        sourceUrl: null,
      });
    }
    records.push(...absenceRecords(record.ocdId, deps.absences));
    return { records, denominators };
  }

  /* PERSON — one candidate, selected by an exact canonical id. The filing row
     is reached through `candidacyId` where the general-lineup key is the one
     the page renders, and through the id itself otherwise. */
  const wantedCandidacy = record.candidacyId ?? record.id;
  const candidacy = deps.set.candidacies.find((c) => c.id === wantedCandidacy) ?? null;
  if (candidacy) {
    records.push(candidacyRecord(candidacy, record.contestTitle));
    denominators.filingRecordsForThisCandidate = 1;
  } else {
    records.push({
      kind: "CANDIDACY",
      id: record.id,
      text: `${record.name} is on the general-election ballot for ${record.contestTitle}.`,
      sourceUrl: null,
    });
  }

  const positions = deps.positions?.(record.id) ?? [];
  denominators.sourcedPositionPassages = positions.length;
  for (const [index, position] of positions.entries()) {
    records.push({
      /*
       * **A POSITION IS A QUOTE, NEVER A CHARACTERISATION — and the sentence
       * around it states the MECHANISM rather than a stance.**
       *
       * This read *"On water, Katie Hobbs published: …"*, which asserts that she
       * published something about water. What the corpus actually holds is a
       * passage found by SEARCHING her published material for that issue's
       * phrases, and the window around a match is often navigation furniture —
       * the Hobbs passage a reader saw was a run of site headings. The quote is
       * honest; the frame around it was not, and a frame is a claim.
       *
       * So the record says what was done and what came back. A paraphrase would
       * be this product generating a position, which is the one thing it may
       * never do; asserting a topic the passage does not discuss is the same
       * thing one step quieter.
       */
      kind: "POSITION",
      id: `${record.id}#position-${index}`,
      text:
        `Searching ${record.name}'s published material for ${position.issueLabel} ` +
        `found this passage: "${position.quote}"`,
      sourceUrl: position.documentUrl,
      retrievedAt: position.retrievedAt,
    });
  }

  return { records, denominators };
}

function candidacyRecord(candidacy: Candidacy, contestTitle: string): EvidenceRecord {
  const name = candidacyDisplayName(candidacy);
  const parts = [`${name} filed for ${contestTitle}`];
  if (candidacy.partyLabel) parts.push(`as ${candidacy.partyLabel}`);
  if (candidacy.slogan) parts.push(`under the filed slogan "${candidacy.slogan}"`);
  /*
   * **`incumbent === null` IS UNKNOWN AND SAYS SO.** The Morris filing does not
   * state incumbency and every 2026 row there is null. Rendering null as "not
   * an incumbent" would turn a gap in a filing into a claim about a person.
   */
  const incumbency =
    candidacy.incumbent === true
      ? " The filing records them as the incumbent."
      : candidacy.incumbent === false
        ? " The filing records them as not the incumbent."
        : " The filing does not state whether they are the incumbent.";
  return {
    kind: "CANDIDACY",
    id: candidacy.id,
    text: `${parts.join(", ")}.${incumbency}`,
    sourceUrl: candidacy.provenance?.sourceUrl ?? null,
    sourceOrg: candidacy.provenance?.sourceOrg ?? null,
    retrievedAt: candidacy.provenance?.collectedAt ?? null,
  };
}

function measureRecords(measure: Measure): EvidenceRecord[] {
  const out: EvidenceRecord[] = [
    {
      kind: "MEASURE_QUESTION",
      id: measure.id,
      /* VERBATIM. The official question text is never paraphrased into a
         record — `lib/ballot/types.ts` states that as a property of the field,
         and a record that summarised it would be the summary an answer then
         summarises again. */
      text: measure.questionText,
      sourceUrl: measure.provenance?.sourceUrl ?? null,
      sourceOrg: measure.provenance?.sourceOrg ?? null,
      retrievedAt: measure.provenance?.collectedAt ?? null,
    },
  ];
  if (measure.officialStatement) {
    out.push({
      kind: "MEASURE_STATEMENT",
      id: `${measure.id}#statement`,
      text: measure.officialStatement,
      sourceUrl: measure.provenance?.sourceUrl ?? null,
      sourceOrg: measure.provenance?.sourceOrg ?? null,
      retrievedAt: measure.provenance?.collectedAt ?? null,
    });
  }
  return out;
}

/**
 * The authority's own statement that something is NOT on the ballot.
 *
 * These are evidence of the same standing as a contest — *"There is no Vail
 * Unified School District governing board race on the November 3, 2026
 * ballot"* is a fact a reader needs, in the authority's words, with a
 * citation. An empty contest list without one of these reads as our gap.
 */
function absenceRecords(
  ocdId: string,
  absences: readonly BallotAbsence[],
): EvidenceRecord[] {
  return absences
    .filter((a) => a.ocdId === ocdId)
    .map((a) => ({
      kind: "BALLOT_ABSENCE" as const,
      id: `absence:${a.ocdId}`,
      text: a.statement,
      sourceUrl: a.provenance?.sourceUrl ?? null,
      sourceOrg: a.provenance?.sourceOrg ?? null,
      retrievedAt: a.provenance?.collectedAt ?? null,
    }));
}

/** Every absence the reader's own divisions carry, for a question about them. */
export function absencesForDivisions(
  ocdIds: readonly string[],
  absences: readonly BallotAbsence[],
): EvidenceRecord[] {
  const wanted = new Set(ocdIds);
  return absences.flatMap((a) => (wanted.has(a.ocdId) ? absenceRecords(a.ocdId, [a]) : []));
}
