"use client";

import type { ReactNode } from "react";
import { Card } from "./card";
import { CardSubjectContext } from "./card-subject-context";
import { CardSection } from "@/components/officials/card-section";
import { WorkingOnIt } from "@/components/demand/working-on-it";
import type { DemandSubjectType } from "@/components/demand/demand-pill";
import { PERSON_CARD_SECTIONS, type PersonCardSectionId } from "@/lib/design/card-sections";
import type { CardSource } from "@/lib/officials/card-sources";

/** One frame and reading order for an officeholder or a candidate. */
export function PersonCard({ title, eyebrow, identity, contact, sections, sources = [], afterSections,
  onClose, className, independent = false, subject, identityKey, defaultOpenSections = [],
}: {
  title: string;
  identityKey?: string;
  defaultOpenSections?: readonly PersonCardSectionId[];
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
  return (
    <CardSubjectContext.Provider value={subject ?? null}><Card key={identityKey ?? subject?.id ?? title} title={title} titleVisible={false} eyebrow={eyebrow} sources={sources}
      sourcesContent={sections.sources} onClose={onClose} className={className} independent={independent}>
      <div data-person-identity>{identity}</div>
      <div data-person-contact>{contact ?? <WorkingOnIt subject={subject} />}</div>
      {PERSON_CARD_SECTIONS.filter(section => section.id !== "sources").map(section => (
        <CardSection key={section.id} title={section.title} defaultOpen={defaultOpenSections.includes(section.id)}>
          {sections[section.id] ?? <WorkingOnIt subject={subject} />}
        </CardSection>
      ))}
      {afterSections}
    </Card></CardSubjectContext.Provider>
  );
}
