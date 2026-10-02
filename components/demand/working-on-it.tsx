import { DemandPill, type DemandSubjectType } from "./demand-pill";

/**
 * What a reader sees wherever we do not hold the information yet (rulings §10):
 * the one sentence, and the existing "Want us to get this info sooner?" tap
 * where the gap belongs to a body or a candidate.
 */
export const WORKING_ON_IT = "We’re working on getting this info";

export function WorkingOnIt({
  about,
  subject,
  attrs,
  className,
}: {
  /** A name the gap is about, said after the sentence ("…on Vail School District"). */
  about?: string | null;
  /** The body or candidate the tap is for. No subject, no pill. */
  subject?: { type: DemandSubjectType; id: string } | null;
  /** The data-* markers the surface already carries for this state. */
  attrs?: Record<`data-${string}`, string>;
  className?: string;
}) {
  return (
    <div data-working-on-it="" {...attrs} className={className}>
      <p className="text-[0.8125rem] leading-relaxed text-voice">
        {about ? `${WORKING_ON_IT} on ${about}.` : `${WORKING_ON_IT}.`}
      </p>
      {subject ? <DemandPill subjectType={subject.type} subjectId={subject.id} className="mt-1" /> : null}
    </div>
  );
}
