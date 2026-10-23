import type { Candidacy } from "./types.ts";
import { readerText } from "../text/reader-names.ts";

/** Mixed-case spelling stays as filed; only ledger capitals are cased. */
export function surnameDisplayCase(surname: string): string {
  return readerText(surname, "name");
}

export function ballotCandidateDisplayName(candidate: Pick<Candidacy, "givenName" | "familyName">): string {
  if (candidate.givenName.trim()) return readerText(`${candidate.givenName} ${candidate.familyName}`.trim(), "name");
  return candidate.familyName.split(/\s*\/\s*/).map(person => {
    const [family, given, ...suffixes] = person.split(",").map(part => part.trim());
    if (!given || /^(?:jr\.?|sr\.?|[ivx]+)$/i.test(given)) return surnameDisplayCase(person.trim());
    const name = `${surnameDisplayCase(given)} ${surnameDisplayCase(family)}`;
    return suffixes.length ? `${name}, ${suffixes.map(surnameDisplayCase).join(", ")}` : name;
  }).join(" / ");
}

export function searchableSurname(filed: string): string {
  const withoutSuffix = filed.replace(/,?\s*(JR|SR|II|III|IV)\.?\s*$/i, "").trim();
  return surnameDisplayCase(withoutSuffix || filed);
}

export function searchableGiven(filed: string): string {
  return surnameDisplayCase(filed.trim().split(/\s+/)[0] ?? filed);
}
