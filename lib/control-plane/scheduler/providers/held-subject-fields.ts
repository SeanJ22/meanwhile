import type { HeldSubjectDetails } from "./held-subject-enrichment.ts";

/** A term belongs to the held body, or to this person's exact named office when no body identity is held. */
export function officialTermScope(bodyId: string | null, officeTitle: string | null): string | null {
  return bodyId || (officeTitle?.trim() ? `office:${encodeURIComponent(officeTitle.trim())}` : null);
}

/** The reader paths already shipped on River; missing edges stay explicitly owed. */
export function heldFactReaderDependency(subject: HeldSubjectDetails, field: string, membershipHeld: boolean): string | null {
  if (subject.subjectKind === "body" && ["name", "homepage", "office_phone", "office_address", "agenda_url", "meeting_cadence"].includes(field)) return null;
  if (subject.subjectKind === "government") return "Reader owner: lib/registry/server.ts and lib/reader/place.ts must overlay exact government facts onto RegistrationGovernmentListing, including source-backed bodyIds.";
  if (field === "office_address") return "Reader owner: lib/facts/roster-read.ts and lib/reader/state.ts must project exact person office_address into Officeholder.offices; lib/officials/lookup.ts and components/officials/contact-pills.tsx must carry and display it.";
  if (field === "portrait") return "Reader owner: lib/facts/roster-read.ts and lib/reader/state.ts must project verified exact-person portrait facts into the existing photo fields, or the native officialPhotos/rosterPhotos publisher must carry them.";
  if (field.startsWith("committee:")) return "Directory reader owner: app/api/directory/route.ts must join exact-person committee facts to held committee identities and existing committee records.";
  if (field.startsWith("statement:")) return "Statements reader owner: lib/corpus/data-plane.ts must expose exact-person attributed dated statement facts to the existing positions and Ask corpus.";
  if (subject.subjectKind === "official" && subject.bodyId && membershipHeld &&
    (["name", "email", "phone", "website", `office:${subject.bodyId}`].includes(field) ||
      ["term_start", "term_end", "term_note"].some(key => field === `${key}:${subject.bodyId}`))) return null;
  if (subject.subjectKind === "official" && !subject.bodyId) return "Reader owner: lib/reader/state.ts must join exact-person contact and exact-office term facts to the existing federal or executive native roster, preserving role identity and sources.";
  return "Roster reader owner: lib/facts/roster-read.ts needs a verified live member:<person> fact for this exact held body before it reads this person's contact and body-scoped term facts.";
}
