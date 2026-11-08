import { ResultCard } from "./result-card";
import { LiveRaceSummary } from "./live-results";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { PickControl } from "./pick-control";
import { VoteCastBox } from "./vote-cast";
import type { ReactionViewContext } from "@/lib/reactions/client";
import { tierForOffice } from "@/lib/ocd/tiers";
import { ballotCandidateDisplayName } from "@/lib/ballot/name-case";
import type { Candidacy, Contest } from "@/lib/ballot/types";
import { readerText } from "@/lib/text/reader-names";

export function RetentionCard({ contest, candidates, voteAfter = false, context = null }: { contest: Contest; candidates: readonly Candidacy[]; voteAfter?: boolean; context?: ReactionViewContext | null }) {
  const wording = [contest.scopeNote, contest.provenance.quote].find(text => text &&
    (/\b(?:shall|should)\b[\s\S]*\?/i.test(text) || /^Vote Yes or No\b/i.test(text))) ?? null;
  const named = candidates.filter(candidate => !`${contest.title} ${wording ?? ""}`.toLowerCase().includes(ballotCandidateDisplayName(candidate).toLowerCase()));
  return <ResultCard id={contest.id} title={readerText(contest.title)} tier={tierForOffice(contest.title, contest.ocdId)} rule="Yes or no"
    summary={<LiveRaceSummary contest={{ id: contest.id, aliases: contest.aliases, title: contest.title, ocdId: contest.ocdId, voteFor: contest.voteFor }}
      choices={candidates.map(candidate => ({ id: candidate.id, aliases: [candidate.id, ...candidate.aliases ?? []], name: ballotCandidateDisplayName(candidate) }))} />}
    attrs={{ "data-contest-id": contest.id, "data-contest-type": "RETENTION", "data-ocd-id": contest.ocdId }}
    sources={[{ what: wording ? "Official retention ballot wording" : "Official retention filing", provenance: contest.provenance },
      ...named.map(candidate => ({ what: ballotCandidateDisplayName(candidate), provenance: candidate.provenance }))]}>
    {named.map(candidate => <p key={candidate.id} className="t-record" data-retention-nominee>{ballotCandidateDisplayName(candidate)}</p>)}
    {wording ? <p className="t-record whitespace-pre-line t-body leading-relaxed text-paper-dim" data-retention-question>{wording}</p>
      : <CardGapContribution id={`retention-question:${contest.id}`} label="the official retention question" />}
    {voteAfter ? <VoteCastBox contestId={contest.id} kind="measure" options={[{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }]} context={context} />
      : <PickControl contestId={contest.id} contestTitle={contest.title} voteFor={1} prominent
        options={[{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }]} />}
  </ResultCard>;
}
