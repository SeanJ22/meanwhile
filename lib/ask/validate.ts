import { overLengthBudget } from "./length-contract.ts";
import { packSourceUrls, type EvidencePack } from "./evidence.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { writerSelection } from "./writer-selection.ts";

export type ValidationVerdict =
  | { kind: "PASSED"; checked: string[] }
  | { kind: "FAILED"; failed: string[]; checked: string[] };

const VOTING_ADVICE = [
  /\byou should (?:vote|support|back|choose|pick)\b/i,
  /\bwe recommend\b/i,
  /\bthe best candidate\b/i,
  /\bvote (?:for|against)\b/i,
  /\bbest choice for you\b/i,
];

const SELF_VERDICT = [
  /\bunfortunately\b/i,
  /\bwe (?:were unable|failed|could not manage)\b/i,
  /\bi'?m sorry\b/i,
  /\bapolog(?:ies|ise|ize)\b/i,
];

const INTERNAL_VOCABULARY = [
  /\bocd-division\b/i,
  /\bNO_SOURCE_FOUND\b/,
  /\b(?:UPCOMING_AGENDA|PAST_MEETING|MEETING_TIME|PERSON_RECORD|TOPIC_OWNER)\b/,
  /\bAGENDA_[A-Z_]+\b/,
  /\bbodyId\b/i,
];

export function urlsIn(text: string): string[] {
  return text.match(/https?:\/\/[^\s)>\]"']+/gi) ?? [];
}

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

  const normalize = (u: string) => u.replace(/[.,;:)\]}>'"]+$/, "");

  checked.push("no-invented-source-url");
  for (const url of [...urlsIn(answer), ...citedUrls]) {
    if (!allowed.has(normalize(url))) {
      failed.push(`invented-source-url:${normalize(url).slice(0, 120)}`);
      break;
    }
  }

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

  // A record with no bodyId is not failed: measures and statewide officeholders belong to no single body.
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

  checked.push("no-withheld-votes-called-unpublished");
  const withheld = writerSelection(pack).withheld;
  if ((withheld.memberVoteRows > 0 && pack.records.some((r) => r.kind === "MEETING_MEMBER_VOTE")) || (withheld.personVoteRecords ?? 0) > 0) {
    const sentences = answer.split(/(?<=[.!?])\s+/);
    if (sentences.some((sentence) => /\bvot(?:e|es|ed|ing)\b/i.test(sentence) &&
      /\b(?:not|never|no|hasn't|haven't|didn't|isn't|aren't|wasn't|weren't)\b/i.test(sentence) &&
      /\b(?:publish(?:ed)?|record(?:ed)?|release(?:d)?|available|posted|held)\b/i.test(sentence))) {
      failed.push("withheld-votes-called-unpublished");
    }
  }

  // Over budget rejects the prose; it is never truncated.
  checked.push("within-length-budget");
  const tooLong = overLengthBudget(answer);
  if (tooLong) failed.push(tooLong);

  checked.push("temporal-consistency");
  const dated = pack.records.filter((r) => r.occurredAt).map((r) => Date.parse(r.occurredAt!));
  const now = Date.parse(pack.asOf ?? pack.today);
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
