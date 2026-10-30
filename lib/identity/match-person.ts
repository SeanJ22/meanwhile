import { isSingleValuedNamespace } from "../core/ids.ts";
import { parsePersonName, type ComparableName } from "./name-parts.ts";

/**
 * The one way a record is tied to a person. It matches on a key both records carry, such as an Open States id, a
 * bioguide id, an FEC id or a state's filer id; or on a name together with the same seat and a term that does not
 * conflict. A name alone never matches. When two candidates are equally good, or only the name agrees, it says so and
 * the caller sends the case to a detective. It never picks one.
 */

export interface PersonEvidence {
  /** The caller's handle for this record: an entity id, an officeholder id, a candidacy id. */
  readonly id: string;
  /** As published: `Forename Middle Surname`, `SURNAME, FORENAME`, or already taken apart. */
  readonly name: string | ComparableName;
  readonly state?: string | null;
  /** Identity keys, each written `namespace:value`; see `identityKeys` in lib/core/ids.ts. */
  readonly keys?: Iterable<string>;
  /** The exact seats the record puts this person in. Two records share a seat only when a token is the same. */
  readonly seats?: readonly string[];
  readonly term?: { readonly start?: string | null; readonly end?: string | null } | null;
}

export type TieReason =
  /** The probe's keys reach several records, so those records are all this person. */
  | "KEYS_JOIN_CANDIDATES"
  /** Two records disagree on a key that only one person can hold. */
  | "KEY_CONFLICT"
  /** Several records carry the same name in the same seat. */
  | "SEAT_AND_NAME_AMBIGUOUS";

export type PersonMatch<T extends PersonEvidence> =
  | { readonly kind: "MATCH"; readonly basis: "KEY" | "SEAT_AND_NAME" | "SEAT_AND_SHORT_NAME"; readonly candidate: T }
  | { readonly kind: "NEW" }
  | { readonly kind: "TIE"; readonly reason: TieReason; readonly candidates: readonly T[] }
  | { readonly kind: "NAME_ONLY"; readonly candidates: readonly T[] };

interface Prepared {
  readonly name: ComparableName;
  readonly state: string | null;
  readonly keys: ReadonlySet<string>;
  readonly seats: ReadonlySet<string>;
  readonly term: PersonEvidence["term"];
}

const prepare = (evidence: PersonEvidence): Prepared => ({
  name: typeof evidence.name === "string" ? parsePersonName(evidence.name) : evidence.name,
  state: evidence.state?.trim().toUpperCase() || null,
  keys: new Set(evidence.keys ?? []),
  seats: new Set(evidence.seats ?? []),
  term: evidence.term,
});

const firstNames = (name: ComparableName): string[] => [name.first, ...(name.aliases ?? [])].filter(Boolean);

/** Exact surname and first name (or a nickname the record prints); a middle name matches its own initial, and a missing middle never disqualifies. */
function sameName(a: ComparableName, b: ComparableName): boolean {
  if (!a.last || a.last !== b.last || a.suffix && b.suffix && a.suffix !== b.suffix) return false;
  const firstsB = firstNames(b);
  if (!firstNames(a).some(first => firstsB.includes(first))) return false;
  if (!a.middles.length || !b.middles.length) return true;
  return a.middles.join(" ") === b.middles.join(" ") || a.middles.map(m => m[0]).join("") === b.middles.map(m => m[0]).join("");
}

/** A first name of three or more letters that begins the other's (Greg, Gregory), or a printed nickname that does. An initial is never a short form. */
function shortName(a: ComparableName, b: ComparableName): boolean {
  if (!a.last || a.last !== b.last) return false;
  return firstNames(a).some(x => firstNames(b).some(y => x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))));
}

const namespaceOf = (key: string): string => key.slice(0, Math.max(key.indexOf(":"), 0));

/** True when both carry a key from a namespace where a person holds one value, and the values differ. */
function keysConflict(a: Prepared, b: Prepared): boolean {
  const values = (keys: ReadonlySet<string>) => {
    const found = new Map<string, Set<string>>();
    for (const key of keys) {
      const namespace = namespaceOf(key);
      if (namespace && isSingleValuedNamespace(namespace)) found.set(namespace, (found.get(namespace) ?? new Set()).add(key));
    }
    return found;
  };
  const left = values(a.keys), right = values(b.keys);
  for (const [namespace, held] of left) {
    const other = right.get(namespace);
    if (other && ![...held].some(key => other.has(key))) return true;
  }
  return false;
}

/** ISO dates compare as text. A term with no dates, or one that is not a date, conflicts with nothing. */
function termsConflict(a: PersonEvidence["term"], b: PersonEvidence["term"]): boolean {
  const date = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
  const [aStart, aEnd, bStart, bEnd] = [date(a?.start), date(a?.end), date(b?.start), date(b?.end)];
  return Boolean(aEnd && bStart && aEnd < bStart || bEnd && aStart && bEnd < aStart);
}

const sharesSeat = (a: Prepared, b: Prepared): boolean => [...a.seats].some(seat => b.seats.has(seat)) && !termsConflict(a.term, b.term);

export interface MatchOptions {
  /**
   * For a contest, where a filing prints the full first name and the roster the short one: a short form counts as the same name
   * in the same seat, but only when no candidate in that seat matches exactly. Elsewhere a short form is never inferred.
   */
  readonly shortFirstNames?: boolean;
}

export function matchPerson<T extends PersonEvidence>(probe: PersonEvidence, candidates: readonly T[], options: MatchOptions = {}): PersonMatch<T> {
  const p = prepare(probe);
  const keyed: { candidate: T; held: Prepared }[] = [], conflicted: T[] = [], seated: T[] = [], short: T[] = [], named: T[] = [];
  for (const candidate of candidates) {
    const c = prepare(candidate);
    if (p.state && c.state && p.state !== c.state) continue;
    const conflict = keysConflict(p, c);
    if ([...p.keys].some(key => c.keys.has(key))) {
      if (conflict) conflicted.push(candidate);
      else keyed.push({ candidate, held: c });
      continue;
    }
    if (conflict) continue;
    if (sameName(p.name, c.name)) (sharesSeat(p, c) ? seated : named).push(candidate);
    else if (options.shortFirstNames && shortName(p.name, c.name) && sharesSeat(p, c)) short.push(candidate);
  }
  if (conflicted.length) return { kind: "TIE", reason: "KEY_CONFLICT", candidates: [...conflicted, ...keyed.map(row => row.candidate)] };
  if (keyed.length === 1) return { kind: "MATCH", basis: "KEY", candidate: keyed[0].candidate };
  if (keyed.length > 1) {
    const here = keyed.filter(row => sharesSeat(p, row.held));
    return here.length === 1 ? { kind: "MATCH", basis: "KEY", candidate: here[0].candidate }
      : { kind: "TIE", reason: "KEYS_JOIN_CANDIDATES", candidates: keyed.map(row => row.candidate) };
  }
  if (seated.length === 1) return { kind: "MATCH", basis: "SEAT_AND_NAME", candidate: seated[0] };
  if (seated.length > 1) return { kind: "TIE", reason: "SEAT_AND_NAME_AMBIGUOUS", candidates: seated };
  if (short.length === 1) return { kind: "MATCH", basis: "SEAT_AND_SHORT_NAME", candidate: short[0] };
  if (short.length > 1) return { kind: "TIE", reason: "SEAT_AND_NAME_AMBIGUOUS", candidates: short };
  return named.length ? { kind: "NAME_ONLY", candidates: named } : { kind: "NEW" };
}

/** True only when the probe and the candidate are one person by a key, or by name and seat. */
export const samePerson = (probe: PersonEvidence, candidate: PersonEvidence, options: MatchOptions = {}): boolean =>
  matchPerson(probe, [candidate], options).kind === "MATCH";
