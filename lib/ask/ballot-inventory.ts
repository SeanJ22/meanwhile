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
  // Both keys are needed because the filing and lineup identify the same person differently.
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

export function candidateTargetKey(contestId: string, name: string): string {
  return `${contestId}|${name}`;
}

/** As filed: given name then family name, the way the cards render it. */
export function candidacyDisplayName(candidacy: Candidacy): string {
  return [candidacy.givenName, candidacy.familyName].filter(Boolean).join(" ");
}

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

    // Use the canonical district number because office wording varies between filing authorities.
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

    // Bind to the reader lineup key while retaining the separate filing identity.
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

  // Named filings remain answerable outside the reader’s ballot without implying they are on it.
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

/** The records belonging to one resolved ballot subject, selected by canonical id, never by name. */
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
      /* The date spelled out: this record can render verbatim. */
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
    // Relevance filtering uses the measure identity for every supporting passage.
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

  /* One candidate, by exact canonical id; the filing row through `candidacyId` where the lineup key is used. */
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
  /* `incumbent === null` is unknown and says so, never "not an incumbent". */
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
      /* Verbatim: the official question text is never paraphrased. */
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
  if (measure.voterGuide) {
    const guide = measure.voterGuide;
    for (const [kind, value, source] of [
      ["Official analysis", guide.summary, guide],
      ["Fiscal impact", guide.fiscalImpact, guide.fiscalImpactSource ?? guide],
      ["Passage threshold", guide.passageThreshold, guide.passageThresholdSource ?? guide],
      ...(guide.argumentsFor ?? []).map(text => ["State-published argument for", text, guide] as const),
      ...(guide.argumentsAgainst ?? []).map(text => ["State-published argument against", text, guide] as const),
    ] as const) {
      if (value) out.push({ kind: "MEASURE_ANALYSIS", id: `${measure.id}#guide-${out.length}`, text: `${kind}: ${value}`,
        sourceUrl: source.sourceUrl, sourceOrg: source.publisher, retrievedAt: source.retrievedAt });
    }
  }
  return out;
}

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
