import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { PersonCard } from "@/components/ui/person-card";
import { FundingDisplay } from "@/components/funding/funding-section";
import { PublicStatementsProfile } from "@/components/officials/public-statements-profile";
import { PositionsSection } from "@/components/officials/positions-section";
import { fundingAnswerForTarget } from "@/lib/funding/display";
import { fundingForTarget, settleFundingRead } from "@/lib/funding/snapshot";
import { fecRegistrationLabel } from "@/lib/funding/fec-discovery";
import { fecPersonId, fecPersonName } from "@/lib/ask/fec-national";

export const dynamic = "force-dynamic";

export default async function FecCandidateProfile({ params }: { params: Promise<{ candidate: string }> }) {
  const { candidate } = await params;
  if (!/^[HS]\d[A-Z]{2}\d{5}$/.test(candidate)) notFound();
  try { await settleFundingRead(); }
  catch {
    // An unread profile is one counted gap with the standing request, never a field placeholder.
    return <main className="mw-page min-h-dvh p-5"><Card title="Candidate profile" sources={[]} independent
      gaps={[{ id: `fec-profile:${candidate}`, label: "this candidate's profile", subject: { type: "CANDIDATE", id: `fec:${candidate}` } }]}>{null}</Card></main>;
  }
  const row = fundingForTarget(`fec:${candidate}`); if (!row) notFound();
  const personId = fecPersonId(row), name = fecPersonName(row.name), money = fundingAnswerForTarget(`fec:${candidate}`);
  return <main className="mw-page min-h-dvh overflow-y-auto bg-[var(--bg)]">
    <div className="mx-auto max-w-3xl px-5 py-10" data-fec-profile={candidate} data-person-id={personId}>
      <Link href="/" className="mw-back-pill">← Back to the map</Link>
      <PersonCard title={name} identityKey={personId} independent defaultOpenSections={["money"]} subject={{ type: "CANDIDATE", id: personId }}
        identity={<div><h1 className="t-title font-semibold text-paper">{name}</h1><p className="mt-1 t-detail text-muted">{fecRegistrationLabel(row)}</p></div>}
        contact={null}
        sources={[{ what: "FEC registration and campaign money", provenance: row.provenance }]}
        sections={{ money: money.kind === "funding" ? <FundingDisplay data={money.data} context={null} bare /> : null,
          positions: <PositionsSection subjectId={personId} subjectName={name} contentOnly /> }}
        afterSections={<PublicStatementsProfile subjectId={personId} />} />
    </div>
  </main>;
}
