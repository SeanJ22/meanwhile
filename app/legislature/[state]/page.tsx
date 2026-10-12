import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { LegislatureDirectory } from "@/components/officials/legislature-directory";
import { titleFor } from "@/lib/brand";
import { US_STATES } from "@/lib/control-plane/readiness/catalog";
import { statePeopleScopeForDivision } from "@/lib/officials/people-identity";
import { seatHolderForMembership } from "@/lib/officials/lookup";
import { heldOfficialStateLegislatorsFromRead } from "@/lib/state-rollcalls/legislators";
import { readerAuthorityEdge, readReaderManifest } from "@/lib/meetings/edge-serving";
import { withReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { settleStateLegislatorsRead } from "@/lib/registry/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {title: titleFor("State legislature")};

export default async function LegislaturePage({params}: {params: Promise<{state:string}>}) {
  const {state: stateParam} = await params;
  const state = US_STATES.find(row => row.code.toLowerCase() === stateParam.toLowerCase());
  if (!state) notFound();
  const scope = statePeopleScopeForDivision(`ocd-division/country:us/state:${state.code.toLowerCase()}`);
  if (!scope) notFound();
  const manifest = await readReaderManifest().catch(() => null);
  const edge = manifest ? await readerAuthorityEdge(manifest,undefined,["state-legislators"]).catch(() => null) : null;
  const read = await withReaderAuthorityEdge(edge,() => settleStateLegislatorsRead(scope)).catch(() => null);
  const held = read?.kind === "PROMOTED" || read?.kind === "BOOTSTRAP" ? heldOfficialStateLegislatorsFromRead(scope, read) : null;
  const holders = (held?.seats ?? []).flatMap(holder => {
    const selected = seatHolderForMembership(holder, holder.memberships?.find(membership => membership.current !== false)?.id);
    return selected ? [selected] : [];
  }).sort((a,b) => a.name.localeCompare(b.name));
  return <main className="mw-page mx-auto max-w-3xl px-4 py-8 text-paper">
    <Link href="/" className="mw-back-pill">← Back</Link>
    <div className="mt-4"><Logo variant="wordmark" size={30} /></div>
    <h1 className="mt-2 text-xl font-semibold">{state.name} Legislature</h1>
    <LegislatureDirectory state={state.code.toUpperCase()} holders={holders} unavailable={read === null || read.kind === "STORE_UNREACHABLE"} />
  </main>;
}
