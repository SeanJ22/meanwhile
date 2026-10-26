"use client";

import type { ReactNode } from "react";
import { Card } from "./card";
import { CardSubjectContext } from "./card-subject-context";
import { CardSection } from "@/components/officials/card-section";
import { CardGapContribution } from "./card-gap-context";
import type { DemandSubjectType } from "@/components/demand/demand-pill";
import { PERSON_CARD_READING_ORDER, PERSON_CARD_SECTIONS, type PersonCardSectionId } from "@/lib/design/card-sections";
import type { CardSource } from "@/lib/officials/card-sources";

/** One frame and reading order for an officeholder or a candidate. */
export function PersonCard({ title, eyebrow, identity, contact, sections, sectionIds, sources = [], afterSections,
  onClose, className, independent = false, subject, identityKey, defaultOpenSections = [],
}: {
  title: string;
  identityKey?: string;
  defaultOpenSections?: readonly PersonCardSectionId[];
  eyebrow?: ReactNode;
  identity: ReactNode;
  contact: ReactNode;
  sections: Partial<Record<PersonCardSectionId, ReactNode>>;
  /** The sections this office has. A section outside it is never shown as missing; it defaults to the usual seven. */
  sectionIds?: readonly PersonCardSectionId[];
  sources?: CardSource[];
  afterSections?: ReactNode;
  onClose?: () => void;
  className?: string;
  independent?: boolean;
  subject?: { type: DemandSubjectType; id: string };
}) {
  const has = new Set<PersonCardSectionId>(sectionIds ?? PERSON_CARD_SECTIONS.map(section => section.id));
  return (
    <CardSubjectContext.Provider value={subject ?? null}><Card key={identityKey ?? subject?.id ?? title} title={title} titleVisible={false} eyebrow={eyebrow} sources={sources}
      onClose={onClose} className={className} independent={independent}>
      <div data-person-identity>{identity}</div>
      <CardSection title="Contact" defaultOpen>
        <div data-person-contact>{contact || <CardGapContribution id={`person:${identityKey ?? title}:contact`} label="contact details" subject={subject} />}</div>
      </CardSection>
      {PERSON_CARD_READING_ORDER.filter(section => section.id !== "sources" && (has.has(section.id) || sections[section.id])).map(section => (
        <CardSection key={section.id} title={section.title} defaultOpen={defaultOpenSections.includes(section.id)}>
          {sections[section.id] || <CardGapContribution id={`person:${identityKey ?? title}:${section.id}`} label={section.title.toLowerCase()} subject={subject} />}
        </CardSection>
      ))}
      {sections.sources}
      {afterSections}
    </Card></CardSubjectContext.Provider>
  );
}
