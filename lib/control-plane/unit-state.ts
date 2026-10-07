/**
 * Which state a unit of work belongs to, read from the id's structure. A unit belongs to at most one state; the
 * most specific rule wins:
 *
 *   R1  state:<code> / state-<code>           ocd-division/country:us/state:xx/… · …:state-xx-place-name:…
 *   R2  <code> as a whole segment             freshness:jurisdiction:xx:… · curated:xx/…
 *   R3  ballot-<code> at a boundary           freshness:campaign-finance:ballot-xx-name:…
 *   R4  the subject starts <code>- or <code>:  xx-sos-cfs-2026
 *
 * R4 is anchored to the start, so a surname segment such as `…:de-name-person` is never read as a state. Pure.
 */
import { US_STATES } from "./readiness/catalog.ts";

/** The two-letter codes, lower case, in catalog order. */
const CODES: readonly string[] = US_STATES.map((s) => s.code);

/** R1 — the code in an explicit `state:`/`state-` position. */
function byStatePosition(hay: string): string | null {
  const m = hay.match(/\bstate[:-]([a-z]{2})(?![a-z])/);
  return m && CODES.includes(m[1]) ? m[1] : null;
}

/** R2 — the code as a whole `:`/`/`/space-delimited segment. */
function byWholeSegment(hay: string): string | null {
  for (const m of hay.matchAll(/(?:^|[:/ ])([a-z]{2})(?=[:/ ]|$)/g)) {
    if (CODES.includes(m[1])) return m[1];
  }
  return null;
}

/** R3 — `ballot-<code>` at a segment boundary. */
function byBallotPrefix(hay: string): string | null {
  const m = hay.match(/(?:^|[:/ ])ballot-([a-z]{2})(?=[-:/ ]|$)/);
  return m && CODES.includes(m[1]) ? m[1] : null;
}

/** R4: the id or subject starts with the code and a separator. Underscore is admitted (screaming-snake route ids lower-case to `xx_…`) only at the start. */
function byLeadingCode(hay: string): string | null {
  const m = hay.match(/^([a-z]{2})[-:_]/);
  return m && CODES.includes(m[1]) ? m[1] : null;
}

/**
 * The state a unit of work belongs to, or null when it genuinely belongs to
 * none — a national source, or a proof run.
 *
 * `null` is a real answer and must render as its own named category, never as a
 * silently dropped row.
 */
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

/** The state a place-shaped subject sits in: the same rules minus R3, because a ballot subject already names its own place. */
export function stateOfSubjectPlace(hay: string): string | null {
  const lower = hay.toLowerCase();
  return byStatePosition(lower) ?? byWholeSegment(lower) ?? byLeadingCode(lower);
}

/** Whether this unit belongs to the named state. A unit carries exactly one state, so this is an equality test. */
export function unitBelongsToState(id: string, subjectId: string, code: string): boolean {
  return stateCodeOf(id, subjectId) === code.trim().toLowerCase();
}
