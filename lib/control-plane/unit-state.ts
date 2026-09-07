/**
 * **WHICH STATE A UNIT OF WORK BELONGS TO — read from the id's STRUCTURE, not
 * from whether two letters appear somewhere in it.** (ADM-29, 2026-09-06.)
 *
 * ## The finding
 *
 * The owner red-boxed two pills on `Obligations by state`:
 *
 * > *"14 are just in other (what does that mean, other states?), and 3 are in
 * > Delaware. I'm wondering why we're pulling Delaware stuff right now."*
 *
 * Read back from the production control plane on 2026-09-06, the three
 * "Delaware" obligations are:
 *
 * ```
 *   freshness:candidate-enrichment:nj:2026:state-nj-place-boonton
 *     :member-of-the-town-council-ward-2:de-venezia-marie#…
 * ```
 *
 * They are New Jersey. They were counted as Delaware because the old predicate
 * asked *"does `de` appear delimited somewhere in this string?"* and a New
 * Jersey candidate whose surname is filed **De Venezia** answers yes. Nine more
 * obligations landed in `other` for the mirror-image reason: `ballot-az-pima`
 * puts `az` between two hyphens, and the old predicate required a colon, slash
 * or space before the code, so genuinely Arizonan work was attributed to no
 * state at all.
 *
 * So Delaware was neither a test artifact, a discovery spillover nor a scope
 * leak. **It was a misattribution**, and the same defect was under-counting
 * Arizona by nine. The brief's instruction was to determine which and not to
 * guess; this module is the determination.
 *
 * ## Why this is one function and not a display patch
 *
 * The same predicate decides three things: which pill an obligation is counted
 * under (`publish-owner-snapshot.mts`), which pill an Attempt is counted under
 * on the fleet cards (`fleet-view.ts`), and — the one that matters — **which
 * units a `Deploy fleet here` target actually dispatches to**
 * (`scheduler/dispatch-target.ts`). Under the old predicate, deploying to
 * Delaware would have sent workers at a New Jersey town-council candidate, and
 * deploying to Arizona would have missed nine Arizona campaign-finance
 * obligations. RULING 103: the fix goes at the shared code path, once.
 *
 * ## The rules, in precedence order
 *
 * A unit belongs to at most ONE state, and the most specific structural signal
 * wins. Every rule is anchored to a real id shape in the store, listed beside
 * it; a rule with no id shape behind it is a guess and is not here.
 *
 * ```
 *   R1  state:<code> / state-<code>     ocd-division/country:us/state:az/…
 *                                       …:state-nj-place-boonton:…
 *   R2  <code> as a whole segment       freshness:jurisdiction:nh:…
 *                                       nh:city:city-of-berlin · curated:az/…
 *   R3  ballot-<code> at a boundary     freshness:campaign-finance:ballot-az-pima:…
 *   R4  the subject STARTS <code>- or   az-sos-cfs-2026 · nh-sos-cfs-2026
 *       <code>:
 * ```
 *
 * R4 is deliberately anchored to the START of the id or subject rather than to
 * any hyphen boundary. That is the whole difference between `az-sos-cfs-2026`,
 * which is Arizona's Secretary of State campaign-finance system, and
 * `…:de-venezia-marie`, which is a person.
 *
 * PURE. Two strings in, a state code or null out.
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

/**
 * R4 — the id or subject STARTS with the code and a separator.
 *
 * The underscore is in the separator set because a whole family of route ids is
 * screaming-snake — `AZ_SEETHEMONEY_PLAIN_FETCH`, `NH_CAMPAIGN_FINANCE_BULK` —
 * and lower-cases to `az_…`. It is admitted only at the START, which is the
 * whole difference between this rule and the one that made a candidate called
 * De Venezia into Delaware.
 */
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

/**
 * The state a PLACE-shaped subject sits in — the same rules **minus** the
 * `ballot-<code>` one.
 *
 * The fleet card answers a different question from the obligation pill: not
 * *"which state does this work count under"* but *"what is the most specific
 * place these workers worked in"*. A ballot subject already has a name of its
 * own — `ballot-az-pima:prop-423` renders "Pima County Prop 423" — and
 * collapsing it to "Arizona" would throw away the place the owner reads.
 *
 * Same rules, one deliberately left out, and the reason written down.
 */
export function stateOfSubjectPlace(hay: string): string | null {
  const lower = hay.toLowerCase();
  return byStatePosition(lower) ?? byWholeSegment(lower) ?? byLeadingCode(lower);
}

/**
 * Does this unit belong to the named state?
 *
 * The shape `dispatch-target.ts` and the two publishers call. A unit carries
 * exactly one state, so this is an equality test rather than a search — which
 * is precisely the change: the old predicate could answer yes for two different
 * states about the same row.
 */
export function unitBelongsToState(id: string, subjectId: string, code: string): boolean {
  return stateCodeOf(id, subjectId) === code.trim().toLowerCase();
}
