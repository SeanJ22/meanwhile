"use client";

import { useState } from "react";
import type { SeatHolder } from "@/lib/officials/lookup";
import { tribalSeatListingsFor, tribalSeatForHolder, tribalSeatDescription, tribalSeatCardSources } from "@/lib/officials/tribal-seats";
import { mergeSources, personCardSources } from "@/lib/officials/card-sources";
import { OfficialModal } from "@/components/map/popup/official-modal";
import { Card } from "@/components/ui/card";
import type { CardGap } from "@/lib/design/card-gaps";

/** The directory lists seats from references and people from the current published roster. */
export function LegislatureDirectory({ state, holders, unavailable }: {
  state: string;
  holders: SeatHolder[];
  unavailable: boolean;
}) {
  const [selected, setSelected] = useState<SeatHolder | null>(null);
  const tribalSeats = tribalSeatListingsFor(state, holders);
  const regular = holders.filter(holder => !tribalSeatForHolder(holder));
  const sources = mergeSources([
    ...holders.flatMap(holder => personCardSources(holder)),
    ...tribalSeats.flatMap(seat => tribalSeatCardSources(seat.reference)),
  ]);
  const subject = { type: "BODY" as const, id: `US-${state}:legislature` };
  const gaps: CardGap[] = [
    ...tribalSeats.filter(seat => !seat.vacant && seat.holders.length === 0).map(seat => ({
      id: `tribal-holder:${seat.reference.chamber}:${seat.reference.district}`,
      label: `who holds the ${seat.reference.nation} seat`, subject,
    })),
    ...(unavailable || holders.length === 0 ? [{ id: `legislature-roster:${state}`, label: "the current legislature roster", subject }] : []),
  ];
  const openPerson = (holder: SeatHolder) => <button type="button" onClick={() => setSelected(holder)} className="cursor-pointer text-left text-paper hover:text-link hover:underline">{holder.name}</button>;

  return <>
    <Card title="Seats and members" sources={sources} gaps={gaps} className="mt-6">
    {tribalSeats.length > 0 && <section className="mt-6" aria-labelledby="tribal-seats-heading">
      <h2 id="tribal-seats-heading" className="t-structure text-state">Tribal representatives</h2>
      <ul className="mt-2 space-y-4">
        {tribalSeats.map(seat => <li key={`${seat.reference.chamber}:${seat.reference.district}`} data-tribal-seat={seat.reference.district} className="border-b border-[var(--panel-border)] pb-4">
          <h3 className="t-body font-medium text-paper">{seat.reference.nation}</h3>
          <p className="mt-1 t-detail leading-relaxed text-paper-dim">{tribalSeatDescription(seat.reference.nation)}</p>
          <div className="mt-2 t-body">
            {seat.vacant ? <p data-seat-vacancy="official-roster">Vacant · <a href={seat.reference.status!.sourceUrl} target="_blank" rel="noreferrer" className="text-link underline decoration-dotted">Legislature roster</a></p>
              : seat.holders.length > 0 ? seat.holders.map(holder => <p key={holder.id}>{openPerson(holder)}</p>)
                : null}
          </div>
        </li>)}
      </ul>
    </section>}

    {[{chamber:"upper",label:"Senate"},{chamber:"lower",label:"House"},{chamber:"legislature",label:"Legislature"}].map(({chamber,label}) => {
      const members = regular.filter(holder => holder.chamber === chamber);
      return members.length > 0 ? <section key={chamber} className="mt-6" aria-label={label}>
        <h2 className="t-structure text-state">{label}</h2>
        <ul className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {members.map(holder => <li key={holder.id} className="t-detail">{openPerson(holder)}
            <span className="block t-caption text-muted">{holder.memberships?.find(membership => membership.current !== false && membership.chamber === chamber)?.district ?? holder.officeTitle}</span>
          </li>)}
        </ul>
      </section> : null;
    })}
    </Card>
    {selected && <OfficialModal holder={selected} seatLabel={tribalSeatForHolder(selected)?.nation ?? selected.memberships?.find(membership => membership.current !== false)?.district ?? null} tier="state" reactionContext={null} onClose={() => setSelected(null)} />}
  </>;
}
