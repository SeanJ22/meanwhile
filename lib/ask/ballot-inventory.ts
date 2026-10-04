import type {
  BallotAbsence,
  BallotSet,
  Candidacy,
  CandidacyRemoval,
  Contest,
  Measure,
} from "../ballot/types.ts";
import type { BindableEntity } from "../routing/named-entity.ts";
import { bindNamedEntity, COMMON_QUESTION_NOUNS } from "../routing/named-entity.ts";
import { formatDateLong } from "../text/format-date.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { reconciledCandidacyIdForCard } from "../identity/az-2026.ts";
import type { MeasureAnalysis } from "../ballot/analyses.ts";
import { readerContestScope } from "../ballot/reader-scope.ts";
import type { CandidatePublicationDate, CandidateSourceClass } from "../candidates/corpus.ts";

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
  /** A sourced former filing, never a currently listed candidate. */
  removedFromFiling?: boolean;
  /** A held source filing queried directly, outside the current certified lineup. */
  historicalFiling?: boolean;
  /** A filing the reader named whose contest is not one of the reader's divisions: not on their ballot. */
  outsideReaderDivisions?: boolean;
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
  requestedFilingIds: readonly string[] = [],
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

    for (const removal of set.removals ?? []) if (removal.contestId === contest.id) {
      const name = [removal.givenName, removal.familyName].filter(Boolean).join(" ");
      add(removal.id, name, "person", "person", {
        kind: "PERSON", id: removal.id, name, contestId: contest.id,
        contestTitle: contest.title, ocdId: contest.ocdId, removedFromFiling: true,
      });
    }

    // Office vocabulary varies by filing authority; the district's canonical
    // OCD key supplies the number. These are names for one existing contest,
    // never a name-based join between different people or governments.
    const cd = /\/cd:(\d+)$/.exec(contest.ocdId)?.[1];
    if (cd && officeIdentity(contest.title) === "us_representative") {
      const n = Number(cd);
      const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
      for (const number of [cd, `${cd}${suffix}`]) {
        for (const office of ["U.S. House", "U.S. Representative", "Congress"]) {
          add(contest.id, `${office} District ${number}`, "body", "contest", record);
        }
      }
    }

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
        const candidacyId = reconciledCandidacyIdForCard(id);
        const match = filed.find((c) => c.id === candidacyId);
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

  /*
   * Exact held filings remain answerable without becoming current ballot cards.
   *
   * **A PERSON THE READER NAMES IS ANSWERABLE WHEREVER THE READER STANDS.**
   * (2026-09-25, the Ask model comparison.) *"How much has Rebecca Harned
   * raised?"*, asked by a reader in Merrimack County, came back UNRESOLVED over
   * a state holding that files her committee: her contest (State Senator,
   * District 7) is not one of the reader's divisions, and this loop required
   * that it be. The division scope exists so a MEASURE or a CONTEST from
   * somewhere else is never handed to a reader as though it were on their
   * ballot — and it still is not: only a filing the reader's own words named
   * (`namedSourceFilingIds`) is admitted, as that one person, marked
   * `outsideReaderDivisions` so no record says it is on this reader's ballot.
   * The same rule `namedOfficeholders` follows for a held official.
   */
  const requested = new Set(requestedFilingIds);
  for (const candidacy of set.candidacies) {
    if (!requested.has(candidacy.id) || [...subjects.values()].some((subject) => subject.id === candidacy.id || subject.candidacyId === candidacy.id)) continue;
    const matched = contests.find((row) => row.id === candidacy.contestId);
    const contest = matched ?? set.contests.find((row) => row.id === candidacy.contestId);
    if (!contest || contest.type === "MEASURE") continue;
    const name = candidacyDisplayName(candidacy);
    add(candidacy.id, name, "person", "person", {
      kind: "PERSON", id: candidacy.id, candidacyId: candidacy.id, name, contestId: contest.id, contestTitle: contest.title, ocdId: contest.ocdId,
      ...(matched ? { historicalFiling: true } : { outsideReaderDivisions: true }),
    });
  }
  return { entities, subjects };
}

/** Bind the reader's words to a held filing; never join one civic record by a name. */
export function namedSourceFilingIds(question: string, set: BallotSet | null): string[] {
  if (!set) return [];
  const binding = bindNamedEntity(question, set.candidacies.map((candidacy) => ({ id: candidacy.id, name: candidacyDisplayName(candidacy), nameClass: "person" as const, divisionType: "person" })));
  return binding.kind === "BOUND" ? [binding.entity.id] : binding.kind === "AMBIGUOUS" ? binding.candidates.map((candidate) => candidate.id) : [];
}

/** The evidence subject for a resolved ballot entity. */
export function ballotSubject(record: BallotSubjectRecord): EvidenceSubject {
  return {
    kind: record.kind === "PERSON" ? "PERSON" : record.kind,
    id: record.id,
    name: record.name,
    office: record.kind === "PERSON" && !record.removedFromFiling ? record.contestTitle : null,
  };
}

export interface BallotRetrievalDeps {
  measureAnalysis?: (contestId: string) => MeasureAnalysis | null;
  set: BallotSet;
  contests: readonly Contest[];
  absences: readonly BallotAbsence[];
  /** Sourced page passages for a candidate target key. Empty is a real answer. */
  positions?: (targetKey: string) => readonly {
    issueLabel: string;
    quote: string;
    documentUrl: string;
    retrievedAt: string;
    sourceClass?: CandidateSourceClass;
    sourceRevisionId?: string;
    sourceArtifactId?: string;
    sourceContentHash?: string;
    textStart?: number;
    textEnd?: number;
    revisionStatus?: "CURRENT" | "HISTORICAL" | "UNKNOWN";
    publicationDate?: CandidatePublicationDate;
  }[];
  /** The plain-language measure summary and the analysis it cites. */
  measureSummary?: (contestId: string) => { summary: string; summarizesUrl: string; yesMeans?: string | null; noMeans?: string | null } | null;
  /** What a measure would actually change, provision by provision. */
  measureProvisions?: (contestId: string) => readonly {
    id: string;
    label: string;
    what: string;
    citesUrl: string;
  }[];
  /** General-election nominees for a contest, where the source has them. */
  nominees?: (contestId: string) => readonly AskNominee[];
}

export interface AskNominee {
  name: string;
  partyLabel?: string | null;
  note?: string | null;
  sourceUrl?: string | null;
  sourceOrg?: string | null;
  retrievedAt?: string | null;
}

function nomineeRecord(contestId: string, contestTitle: string, nominee: AskNominee): EvidenceRecord {
  return { kind: "CANDIDACY", id: candidateTargetKey(contestId, nominee.name),
    text: `${nominee.name} is on the general-election ballot for ${contestTitle}${nominee.partyLabel ? `, filed as ${nominee.partyLabel}` : ""}.${nominee.note ? ` ${nominee.note}` : ""}`,
    sourceUrl: nominee.sourceUrl ?? null, sourceOrg: nominee.sourceOrg ?? null, retrievedAt: nominee.retrievedAt ?? null };
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
  if (record.removedFromFiling) {
    const removal = deps.set.removals?.find((entry) => entry.id === record.id && entry.contestId === record.contestId);
    return { records: removal ? removalRecords(removal) : [], denominators: { removedFilingsForThisSubject: removal ? 1 : 0 } };
  }

  if (contest && !record.historicalFiling && !record.outsideReaderDivisions) {
    const nominees = deps.nominees?.(contest.id) ?? [];
    const certified = nominees[0];
    const scope = readerContestScope(contest, {
      certified: certified?.sourceUrl && certified.sourceOrg && certified.retrievedAt ? {
        count: nominees.length, sourceUrl: certified.sourceUrl, sourceOrg: certified.sourceOrg, readAt: certified.retrievedAt,
      } : null,
      questionTextHeld: deps.set.measures.some((measure) => measure.contestId === contest.id && Boolean(measure.questionText.trim())),
    });
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
        (contest.voteFor === null ? "" : ` Voters choose ${contest.voteFor}`) +
        `${contest.termYears ? `, for a term of ${contest.termYears} years` : ""}.` +
        (scope.currentNote ? ` ${scope.currentNote}` : ""),
      occurredAt: deps.set.election.date,
      sourceUrl: contest.provenance?.sourceUrl ?? null,
      sourceOrg: contest.provenance?.sourceOrg ?? null,
      retrievedAt: contest.provenance?.collectedAt ?? null,
    });
    if (scope.qualification) records.push({ kind: "CONTEST", id: `${contest.id}#current-lineup`,
      text: scope.qualification.text, sourceUrl: scope.qualification.sourceUrl,
      sourceOrg: scope.qualification.sourceOrg, retrievedAt: scope.qualification.readAt });
  }

  if (record.kind === "MEASURE") {
    const measures = deps.set.measures.filter((m) => m.contestId === record.contestId);
    denominators.measureRecordsForThisQuestion = measures.length;
    for (const measure of measures) records.push(...measureRecords(measure));
    const analysis = deps.measureAnalysis?.(record.contestId);
    if (analysis?.text && analysis.extraction !== "failed") records.push({ kind: "MEASURE_ANALYSIS", id: `${analysis.contestId}#analysis`, text: analysis.text, sourceUrl: analysis.analysisUrl, sourceOrg: analysis.sourceOrg, retrievedAt: analysis.retrievedAt });
    denominators.readableMeasureAnalyses = analysis?.text && analysis.extraction !== "failed" ? 1 : 0;

    const summary = deps.measureSummary?.(record.contestId) ?? null;
    if (summary) {
      records.push({
        kind: "MEASURE_SUMMARY",
        id: `${record.contestId}#summary`,
        text: summary.summary,
        sourceUrl: summary.summarizesUrl,
      });
      for (const vote of ["YES", "NO"] as const) {
        const meaning = vote === "YES" ? summary.yesMeans : summary.noMeans;
        if (meaning) records.push({ kind: "MEASURE_SUMMARY", id: `${record.contestId}#${vote.toLowerCase()}-meaning`,
          text: `${vote}: ${meaning}`, measureMeaning: { vote, meaning }, sourceUrl: summary.summarizesUrl });
      }
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
    /*
     * **THE POSITIVE HALF OF THE RELEVANCE GATE.** (ASK-24, 2026-09-02.)
     *
     * Every record above is this measure's own evidence — its contest row, its
     * official question and statement, its summary, its provisions — so each
     * carries the measure's canonical id as the subject it is evidence FOR.
     * `lib/ask/relevance.ts` reads that to keep them and to drop a record
     * stamped for a different subject, at the id level. Without this a measure
     * pack could carry another ballot item's record on nothing but a shared
     * division, which is the U.S. Senate bullet the owner met under Prop 141.
     */
    for (const created of records) created.subjectId = record.id;
    return { records, denominators };
  }

  if (record.kind === "CONTEST") {
    const candidacies = deps.set.candidacies.filter((c) => c.contestId === record.contestId);
    denominators.candidatesFiledForThisContest = candidacies.length;
    for (const candidacy of candidacies) records.push(candidacyRecord(candidacy, record.contestTitle));

    const nominees = deps.nominees?.(record.contestId) ?? [];
    denominators.generalElectionNominees = nominees.length;
    for (const nominee of nominees) {
      records.push(nomineeRecord(record.contestId, record.contestTitle, nominee));
    }
    const removals = (deps.set.removals ?? []).filter((entry) => entry.contestId === record.contestId);
    for (const removal of removals) records.push(...removalRecords(removal));
    denominators.removedFilingsForThisContest = removals.length;
    records.push(...absenceRecords(record.ocdId, absencesWithoutRemovals(deps.absences, deps.set.removals ?? [])));
    return { records, denominators };
  }

  /* PERSON — one candidate, selected by an exact canonical id. The filing row
     is reached through `candidacyId` where the general-lineup key is the one
     the page renders, and through the id itself otherwise. */
  const wantedCandidacy = record.candidacyId ?? record.id;
  const candidacy = deps.set.candidacies.find((c) => c.id === wantedCandidacy) ?? null;
  const nominee = deps.nominees?.(record.contestId).find((entry) => candidateTargetKey(record.contestId, entry.name) === record.id);
  if (candidacy) {
    records.push(candidacyRecord(candidacy, record.contestTitle));
    denominators.filingRecordsForThisCandidate = 1;
  } else if (!nominee) {
    records.push({
      kind: "CANDIDACY",
      id: record.id,
      text: `${record.name} is on the general-election ballot for ${record.contestTitle}.`,
      sourceUrl: null,
    });
  }
  if (nominee) records.push(nomineeRecord(record.contestId, record.contestTitle, nominee));

  const positions = [...new Map(
    [...new Set([record.id, wantedCandidacy])].flatMap((key) => deps.positions?.(key) ?? [])
      .map((position) => [`${position.documentUrl}|${position.quote}`, position]),
  ).values()];
  denominators.sourcedPositionPassages = positions.length;
  for (const [index, position] of positions.entries()) {
    const source = position.sourceClass === "CAMPAIGN_SITE" ? "campaign page" :
      position.sourceClass === "OFFICIAL_SITE" ? "official page" : "held public page";
    const version = position.revisionStatus === "CURRENT" ? "Latest captured version." :
      position.revisionStatus === "HISTORICAL" ? "Earlier captured version, not the latest captured page." :
        "Source version status is unknown.";
    const publication = position.publicationDate
      ? ` Source-stated publication date ${position.publicationDate.date}.` : "";
    const span = position.sourceRevisionId && position.sourceArtifactId &&
      Number.isSafeInteger(position.textStart) && Number.isSafeInteger(position.textEnd)
      ? ` Source revision ${position.sourceRevisionId}, capture ${position.sourceArtifactId}, extracted UTF-16 span ${position.textStart}-${position.textEnd}.`
      : "";
    records.push({
      /*
       * **A SOURCE PASSAGE IS A QUOTE, NEVER A CHARACTERISATION — and the sentence
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
      kind: "SOURCE_PASSAGE",
      id: `${record.id}#position-${position.sourceRevisionId ?? index}`,
      text:
        `Searching a ${source} linked to ${record.name} for ${position.issueLabel} ` +
        `found this passage: "${position.quote}". ${version}${publication}${span} ` +
        "A phrase match does not establish the candidate's personal stance or the passage's speaker.",
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

/** A removal has its own canonical identity and both source documents. */
export function removalRecords(removal: CandidacyRemoval): EvidenceRecord[] {
  return [
    { kind: "BALLOT_ABSENCE", id: removal.id, canonicalSubjectId: removal.id, text: removal.statement,
      sourceUrl: removal.absentFrom.sourceUrl, sourceOrg: removal.absentFrom.sourceOrg, retrievedAt: removal.absentFrom.collectedAt },
    { kind: "BALLOT_ABSENCE", id: `${removal.id}#last-listed`, canonicalSubjectId: removal.id,
      text: `${removal.givenName} ${removal.familyName} appeared in the earlier filing read ${formatDateLong(removal.lastListed.collectedAt) ?? removal.lastListed.collectedAt}.`,
      sourceUrl: removal.lastListed.sourceUrl, sourceOrg: removal.lastListed.sourceOrg, retrievedAt: removal.lastListed.collectedAt },
  ];
}

/** The same filing change must not become an absence attached to a different candidate. */
export function absencesWithoutRemovals(absences: readonly BallotAbsence[], removals: readonly CandidacyRemoval[]): BallotAbsence[] {
  return absences.filter((absence) => !removals.some((removal) => removal.statement === absence.statement && removal.absentFrom.sourceUrl === absence.provenance.sourceUrl));
}

/** Every absence the reader's own divisions carry, for a question about them. */
export function absencesForDivisions(
  ocdIds: readonly string[],
  absences: readonly BallotAbsence[],
): EvidenceRecord[] {
  const wanted = new Set(ocdIds);
  return absences.flatMap((a) => (wanted.has(a.ocdId) ? absenceRecords(a.ocdId, [a]) : []));
}
