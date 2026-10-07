export type Incumbency = "INCUMBENT" | "CHALLENGER" | "UNKNOWN";

export interface IncumbencyDecision {
  readonly standing: Incumbency;
  readonly basis: string;
  readonly source: string | null;
  readonly gap?: IncumbencyGap;
}

export interface CandidateRef {
  readonly id: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly personKey?: string | null;
}

export interface SeatHolderRef {
  readonly familyName: string;
  readonly givenName: string;
  readonly personKey?: string | null;
  readonly source: string;
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** The shape both name comparisons take. `aliases` is optional for callers
 * that build one by hand; `nameParts` always fills it. */
export interface ComparableName {
  first: string;
  middles: string[];
  last: string;
  aliases?: string[];
}

/** Drops case, punctuation and generational suffixes; middle names come back separately. A name the record prints in double quotes or parentheses is an alias; an apostrophe never delimits one. */
export function nameParts(given: string, family: string): Required<ComparableName> {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,'"`]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const aliases: string[] = [];
  const givenWithoutAliases = String(given ?? "")
    .replace(/[“"]([^”"]+)[”"]/g, (_match, inner: string) => {
      aliases.push(inner);
      return " ";
    })
    .replace(/\(([^)]+)\)/g, (_match, inner: string) => {
      aliases.push(inner);
      return " ";
    });

  const givenTokens = clean(givenWithoutAliases).split(" ").filter(Boolean);
  const familyTokens = clean(family)
    .split(" ")
    .filter((t) => t.length > 0 && !SUFFIXES.has(t));

  return {
    first: givenTokens[0] ?? "",
    middles: givenTokens.slice(1),
    last: familyTokens.join(" "),
    aliases: aliases.map(clean).filter(Boolean),
  };
}

function firstNames(n: ComparableName): string[] {
  return [n.first, ...(n.aliases ?? [])].filter((s) => s.length > 0);
}

/** Exact surname and first name; a middle name matches its own initial, and a missing middle never disqualifies. A miss reads as UNKNOWN, never a wrong label. */
export function namesAgree(a: ComparableName, b: ComparableName): boolean {
  if (a.last.length === 0 || b.last.length === 0) return false;
  if (a.last !== b.last) return false;
  const firstsA = firstNames(a);
  const firstsB = firstNames(b);
  if (firstsA.length === 0 || firstsB.length === 0) return false;
  const agreedFirst = firstsA.some((x) => firstsB.includes(x));
  if (!agreedFirst) return false;

  if (a.middles.length === 0 || b.middles.length === 0) return true;
  const initials = (m: string[]) => m.map((x) => x[0]).join("");
  const full = (m: string[]) => m.join(" ");
  if (full(a.middles) === full(b.middles)) return true;
  return initials(a.middles) === initials(b.middles);
}

/** Exact surname plus a first-name prefix of three characters or more. Safe only inside one contest; an initial is never a nickname. */
export function namesAgreeLoosely(a: ComparableName, b: ComparableName): boolean {
  if (a.last.length === 0 || a.last !== b.last) return false;
  for (const x of firstNames(a)) {
    for (const y of firstNames(b)) {
      if (x.length < 3 || y.length < 3) continue;
      if (x.startsWith(y) || y.startsWith(x)) return true;
    }
  }
  return false;
}

export function splitDisplayName(display: string): { givenName: string; familyName: string } {
  const tokens = display.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (tokens.length === 0) return { givenName: "", familyName: "" };
  if (tokens.length === 1) return { givenName: "", familyName: tokens[0] };

  let end = tokens.length - 1;
  while (end > 0 && SUFFIXES.has(tokens[end].toLowerCase().replace(/[.,]/g, ""))) end -= 1;
  return { givenName: tokens.slice(0, end).join(" "), familyName: tokens[end] };
}

export interface ContestIncumbencyInput {
  readonly candidates: readonly CandidateRef[];
  readonly holders: readonly SeatHolderRef[];
  readonly officeIsElected: boolean;
}

export const NOT_ELECTED: IncumbencyDecision = {
  standing: "UNKNOWN",
  basis: "this office is not filled by election, so incumbency does not attach to it (RULING 118)",
  source: null,
};

export function resolveContestIncumbency(input: ContestIncumbencyInput): Map<string, IncumbencyDecision> {
  const out = new Map<string, IncumbencyDecision>();

  if (!input.officeIsElected) {
    for (const c of input.candidates) out.set(c.id, NOT_ELECTED);
    return out;
  }

  const source = input.holders[0]?.source ?? null;
  const unknown = (basis: string): Map<string, IncumbencyDecision> => {
    for (const c of input.candidates) out.set(c.id, { standing: "UNKNOWN", basis, source });
    return out;
  };

  if (input.holders.length === 0) {
    return unknown(
      "we haven't sourced who currently holds this seat, so we cannot say which of these people " +
        "holds it and which are running against them",
    );
  }

  // A published person key is preferred over every name comparison.
  const matchesFor = (h: SeatHolderRef): { candidates: CandidateRef[]; byKey: boolean } => {
    const key = h.personKey?.trim() || null;
    if (key) {
      const byKey = input.candidates.filter((c) => (c.personKey?.trim() || null) === key);
      if (byKey.length > 0) return { candidates: byKey, byKey: true };
    }
    const parts = nameParts(h.givenName, h.familyName);
    const strict = input.candidates.filter((c) => namesAgree(nameParts(c.givenName, c.familyName), parts));
    if (strict.length > 0) return { candidates: strict, byKey: false };
    return {
      candidates: input.candidates.filter((c) => namesAgreeLoosely(nameParts(c.givenName, c.familyName), parts)),
      byKey: false,
    };
  };

  const incumbentIds = new Set<string>();
  let anyByKey = false;
  for (const h of input.holders) {
    const { candidates: hit, byKey } = matchesFor(h);

    if (hit.length === 0) {
      const sameSurname = input.candidates.filter(
        (c) => nameParts(c.givenName, c.familyName).last === nameParts(h.givenName, h.familyName).last,
      );
      // Fail closed: a shared surname means the comparison may not be up to this contest.
      if (sameSurname.length > 0) {
        return unknown(
          `a sitting member of this seat (${h.givenName} ${h.familyName}) shares a surname with a ` +
            "candidate here and our name comparison could not decide whether they are the same " +
            "person. Guessing either way would be a claim about somebody by name, so the contest " +
            "reads as not yet sourced.",
        );
      }
      continue;
    }

    // Fail closed: one sitting member matching two candidates would be a guess.
    if (hit.length > 1) {
      return unknown(
        `${hit.length} candidates in this contest could be the same sitting member on the record we ` +
          "hold. Choosing between them would be a guess about a named person, so the whole contest " +
          "reads as not yet sourced.",
      );
    }
    if (hit.length === 1) {
      incumbentIds.add(hit[0].id);
      anyByKey ||= byKey;
    }
    // hit.length === 0 is NORMAL and is not a failure: a sitting member who is
    // not seeking re-election is simply not on this ballot.
  }

  const basisKind = anyByKey
    ? "a stable identifier published by the body"
    : "a name match against the body's own roster";

  for (const c of input.candidates) {
    out.set(
      c.id,
      incumbentIds.has(c.id)
        ? { standing: "INCUMBENT", basis: `holds this seat, by ${basisKind}`, source }
        : {
            standing: "CHALLENGER",
            basis: `does not appear among the people currently holding this seat, by ${basisKind}`,
            source,
          },
    );
  }
  return out;
}

export type IncumbencyGap = "HOLDER_NOT_SOURCED" | "CONTEST_NOT_ESTABLISHED";

export function incumbencyLabel(
  standing: Incumbency,
  gap: IncumbencyGap = "HOLDER_NOT_SOURCED",
): string | null {
  switch (standing) {
    case "INCUMBENT":
      return "Incumbent";
    case "CHALLENGER":
      return "Challenger";
    case "UNKNOWN":
      return gap === "CONTEST_NOT_ESTABLISHED"
        ? "We haven't confirmed this for everyone in this contest"
        : "We haven't sourced who holds this seat yet";
  }
}
