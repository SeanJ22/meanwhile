import { identityKeys } from "../core/ids.ts";
import { matchPerson } from "../identity/match-person.ts";
import { nameParts } from "../identity/name-parts.ts";

const personKeys = (key: string | null | undefined) => (key?.trim() ? identityKeys(key.trim(), []) : []);

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

export interface ContestIncumbencyInput {
  readonly candidates: readonly CandidateRef[];
  readonly holders: readonly SeatHolderRef[];
  readonly officeIsElected: boolean;
}

export const NOT_ELECTED: IncumbencyDecision = {
  standing: "UNKNOWN",
  basis: "this office is not filled by election, so incumbency does not attach to it",
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

  // Every holder and candidate here is in this one contest, so the contest is the seat; a published person key outranks the name.
  const seat = ["this contest"];
  const candidateEvidence = input.candidates.map((c) => ({ id: c.id, name: nameParts(c.givenName, c.familyName), keys: personKeys(c.personKey), seats: seat }));
  const matchesFor = (h: SeatHolderRef, at: number): { candidates: CandidateRef[]; byKey: boolean; tied: boolean } => {
    const found = matchPerson({ id: `holder:${at}`, name: nameParts(h.givenName, h.familyName), keys: personKeys(h.personKey), seats: seat }, candidateEvidence, { shortFirstNames: true });
    if (found.kind === "MATCH") return { candidates: input.candidates.filter((c) => c.id === found.candidate.id), byKey: found.basis === "KEY", tied: false };
    const tied = found.kind === "TIE" ? new Set(found.candidates.map((c) => c.id)) : new Set<string>();
    return { candidates: input.candidates.filter((c) => tied.has(c.id)), byKey: false, tied: tied.size > 0 };
  };

  const incumbentIds = new Set<string>();
  let anyByKey = false;
  for (const [at, h] of input.holders.entries()) {
    const { candidates: hit, byKey, tied } = matchesFor(h, at);

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
    if (tied) {
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
