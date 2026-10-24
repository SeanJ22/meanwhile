import { Card } from "@/components/ui/card";
import { feedbackHref } from "@/lib/feedback/shape";
import type { NationalCard } from "@/lib/national/section";
import { IdentityPortrait } from "@/components/officials/person-identity";

/** Each verified national executive's card; with none, the section says it is coming soon. */
export function NationalSection({ cards }: { readonly cards: readonly NationalCard[] }) {
  return cards.length === 0 ? (
        <div className="mt-6 space-y-2" data-national-gap>
          <p className="t-body">National government, coming soon.</p>
          <p className="t-body">We&apos;re working on getting this info.</p>
          <a className="t-detail text-link underline" href={feedbackHref({ about: "National government", zip: null })}>Want us to get this sooner?</a>
        </div>
  ) : (
        <ul className="mt-6 space-y-3" data-national-cards>
          {cards.map(card => (
            <li key={card.id}>
              <Card title={card.title} eyebrow={card.office} sources={[...card.sources]}>
                {card.holder && <div className="flex items-center gap-3"><IdentityPortrait name={card.holder} photoUrl={card.photoUrl} /><p className="t-body">{card.holder}</p></div>}
              </Card>
            </li>
          ))}
        </ul>
  );
}
