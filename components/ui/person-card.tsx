"use client";

import type { ReactNode } from "react";
import { Card } from "./card";
import { CardSubjectContext } from "./card-subject-context";
import { CardSection } from "@/components/officials/card-section";
import type { CardGap } from "@/lib/design/card-gaps";
import type { DemandSubjectType } from "@/components/demand/demand-pill";
import { PERSON_CARD_SECTIONS, type PersonCardSectionId } from "@/lib/design/card-sections";
import type { CardSource } from "@/lib/officials/card-sources";

/** One frame and reading order for an officeholder or a candidate. */
export function PersonCard({ title, eyebrow, identity, contact, sections, sources = [], afterSections,
  onClose, className, independent = false, subject, identityKey,
}: {
  title: string;
  identityKey?: string;
  eyebrow?: ReactNode;
  identity: ReactNode;
  contact: ReactNode;
  sections: Partial<Record<PersonCardSectionId, ReactNode>>;
  sources?: CardSource[];
  afterSections?: ReactNode;
  onClose?: () => void;
  className?: string;
  independent?: boolean;
  subject?: { type: DemandSubjectType; id: string };
}) {
  const gaps: CardGap[] = PERSON_CARD_SECTIONS.filter(section => section.id !== "sources" && !sections[section.id]).map(section => ({ id: `person:${identityKey ?? title}:${section.id}`, label: section.title.toLowerCase(), subject }));
  if (!contact) gaps.push({ id: `person:${identityKey ?? title}:contact`, label: "contact details", subject });
  return (
    <CardSubjectContext.Provider value={subject ?? null}><Card key={identityKey ?? subject?.id ?? title} title={title} titleVisible={false} eyebrow={eyebrow} sources={sources}
      gaps={gaps} onClose={onClose} className={className} independent={independent}>
      <div data-person-identity>{identity}</div>
      {contact && <div data-person-contact>{contact}</div>}
      {PERSON_CARD_SECTIONS.filter(section => section.id !== "sources" && sections[section.id]).map(section => (
        <CardSection key={section.id} title={section.title}>
          {sections[section.id]}
        </CardSection>
      ))}
      {sections.sources}
      {afterSections}
    </Card></CardSubjectContext.Provider>
  );
}
