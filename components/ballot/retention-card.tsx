import { Card } from "@/components/ui/card";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { LevelTag } from "@/components/ui/level-tag";
import { PickControl } from "./pick-control";
import { tierForOffice } from "@/lib/ocd/tiers";
import { ballotCandidateDisplayName } from "@/lib/ballot/name-case";
import type { Candidacy, Contest } from "@/lib/ballot/types";

export function RetentionCard({ contest, candidates }: { contest: Contest; candidates: readonly Candidacy[] }) {
  const wording = [contest.scopeNote, contest.provenance.quote].find(text => text &&
    (/\b(?:shall|should)\b[\s\S]*\?/i.test(text) || /^Vote Yes or No\b/i.test(text))) ?? null;
  const named = candidates.filter(candidate => !`${contest.title} ${wording ?? ""}`.toLowerCase().includes(ballotCandidateDisplayName(candidate).toLowerCase()));
  return <Card title={contest.title}
    attrs={{ "data-contest-id": contest.id, "data-contest-type": "RETENTION", "data-ocd-id": contest.ocdId }}
    eyebrow={<LevelTag tier={tierForOffice(contest.title, contest.ocdId)} />}
    sources={[{ what: wording ? "Official retention ballot wording" : "Official retention filing", provenance: contest.provenance },
      ...named.map(candidate => ({ what: ballotCandidateDisplayName(candidate), provenance: candidate.provenance }))]}>
    {named.map(candidate => <p key={candidate.id} className="t-record" data-retention-nominee>{ballotCandidateDisplayName(candidate)}</p>)}
    {wording ? <p className="t-record whitespace-pre-line t-body leading-relaxed text-paper-dim" data-retention-question>{wording}</p>
      : <CardGapContribution id={`retention-question:${contest.id}`} label="the official retention question" />}
    <PickControl contestId={contest.id} contestTitle={contest.title} voteFor={1} prominent
      options={[{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }]} />
  </Card>;
}
