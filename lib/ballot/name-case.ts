import type { Candidacy } from "./types.ts";
import { readerText } from "../text/reader-names.ts";

/** The generational suffixes written Jr/Sr however they were filed; other two-letter capitals may be initials. */
const CASED_SHORT_SUFFIX = /^(?:JR|SR)$/;

/** Case each filed all-capitals word; preserve mixed-case words and initials. */
export function surnameDisplayCase(surname: string): string {
  const trimmed = surname.trim();
  if (trimmed.length === 0) return surname;
  // Initials ("B.", "S.K.", a quoted "BJ") keep the form the filing prints; JR and SR are written Jr and Sr.
  return trimmed
    .split(/(\s+|-)/)
    .map((part) => {
      const letters = part.replace(/[^A-Za-z]/g, "");
      return letters.length <= 2 && !CASED_SHORT_SUFFIX.test(letters) ? part : readerText(part, "name");
    })
    .join("");
}

export function ballotCandidateDisplayName(candidate: Pick<Candidacy, "givenName" | "familyName" | "ticket">): string {
  if (candidate.ticket) return `${ballotCandidateDisplayName({ ...candidate, ticket: undefined })} / ${ballotCandidateDisplayName(candidate.ticket.runningMate)}`;
  const givenName = candidate.givenName ?? "", familyName = candidate.familyName ?? "";
  if (givenName.trim()) return `${surnameDisplayCase(givenName)} ${surnameDisplayCase(familyName)}`.trim();
  return familyName.split(/\s*\/\s*/).map(person => {
    const [family, given, ...suffixes] = person.split(",").map(part => part.trim());
    if (!given || /^(?:jr\.?|sr\.?|[ivx]+)$/i.test(given)) return surnameDisplayCase(person.trim());
    const name = `${surnameDisplayCase(given)} ${surnameDisplayCase(family)}`;
    return suffixes.length ? `${name}, ${suffixes.map(surnameDisplayCase).join(", ")}` : name;
  }).join(" / ");
}
