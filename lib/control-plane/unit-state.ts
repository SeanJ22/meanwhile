import { US_STATES } from "./readiness/catalog.ts";

const CODES: readonly string[] = US_STATES.map((s) => s.code);

function byStatePosition(hay: string): string | null {
  const m = hay.match(/(?:\b(?:state|district|territory)[:-]|(?:^|:)government:us-)([a-z]{2})(?![a-z])/);
  return m && CODES.includes(m[1]) ? m[1] : null;
}

function byWholeSegment(hay: string): string | null {
  for (const m of hay.matchAll(/(?:^|[:/ ])([a-z]{2})(?=[:/ ]|$)/g)) {
    if (CODES.includes(m[1])) return m[1];
  }
  return null;
}

function byBallotPrefix(hay: string): string | null {
  const m = hay.match(/(?:^|[:/ ])ballot-([a-z]{2})(?=[-:/ ]|$)/);
  return m && CODES.includes(m[1]) ? m[1] : null;
}

function byLeadingCode(hay: string): string | null {
  const m = hay.match(/^([a-z]{2})[-:_]/);
  return m && CODES.includes(m[1]) ? m[1] : null;
}

export function stateCodeOf(id: string, subjectId: string): string | null {
  const hay = `${id} ${subjectId}`.toLowerCase();
  const lowerId = id.toLowerCase();
  const lowerSubject = subjectId.toLowerCase();
  return (
    byStatePosition(hay) ??
    byWholeSegment(hay) ??
    byBallotPrefix(hay) ??
    byLeadingCode(lowerSubject) ??
    byLeadingCode(lowerId)
  );
}

export function stateOfSubjectPlace(hay: string): string | null {
  const lower = hay.toLowerCase();
  return byStatePosition(lower) ?? byWholeSegment(lower) ?? byLeadingCode(lower);
}

export function unitBelongsToState(id: string, subjectId: string, code: string): boolean {
  return stateCodeOf(id, subjectId) === code.trim().toLowerCase();
}
