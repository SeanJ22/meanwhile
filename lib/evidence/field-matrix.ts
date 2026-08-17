/**
 * The required-field matrix, version `vH-1`, frozen 2026-08-16 before any
 * hunting began.
 *
 * ## What it is for
 *
 * "Eleven rungs per required field" compares unequal objects unless the
 * fields are fixed in advance. This file fixes them: per subject type, what
 * must be obtained for that subject to count as complete, what the evidence
 * standard is, and what the two terminal states look like.
 *
 * ## It is a FLOOR, never a ceiling
 *
 * The matrix defines what must be obtained. It does not define the limit of
 * what to take. Where a source yields more than the matrix asks — terms of
 * office, appointment versus election, meeting cadence, staff contacts,
 * budget documents, enabling statutes, board rules, historical membership —
 * that is taken and recorded as beyond-matrix acquisition. The expensive part
 * of any hunt is REACHING the source; once it is open, additional fields are
 * nearly free, and every field deferred to "later" pays the full discovery
 * cost a second time.
 *
 * A field the matrix did not anticipate is a SCHEMA CORRECTION with an audit
 * trail — a new entry with its own version stamp — never a silent change to
 * the denominator.
 *
 * ## `not_applicable` leaves the denominator; `missing` does not
 *
 * A town with no mayor has no mayor field to miss. A town whose zoning board
 * publishes no venue has a required field we failed to obtain, and it stays
 * in the denominator: failing to find something is a cost, and a denominator
 * that quietly sheds its failures reports a completion rate that means
 * nothing.
 */

export const FIELD_MATRIX_VERSION = "vH-1";
export const FIELD_MATRIX_FROZEN_AT = "2026-08-16";

export type Requirement = "required" | "optional";

export interface FieldSpec {
  field: string;
  requirement: Requirement;
  /** When this field does not apply at all, and so leaves the denominator. */
  notApplicableWhen: string;
  evidenceStandard: string;
  /** What a successful terminal state looks like. */
  success: string;
  /** What an honest exhausted terminal state looks like. */
  exhausted: string;
}

export type SubjectType =
  | "body"
  | "official"
  | "candidate"
  | "school_body"
  | "meeting_series"
  | "office";

const SOURCED = "a source record: source_url, source_org, collected_at, and the read date";

export const FIELD_MATRIX: Record<SubjectType, FieldSpec[]> = {
  body: [
    {
      field: "name_as_published",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard: `${SOURCED}, from the body's own page or its parent government's roster`,
      success: "the body's name exactly as the government writes it",
      exhausted: "the body is named in an enumeration but has no self-published page; the enumeration is cited",
    },
    {
      field: "role_and_powers_plain_language",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard: `${SOURCED}, paraphrasing a cited charter, statute, bylaw or the body's own description`,
      success: "one or two sentences a fifteen-year-old passes, with the source named",
      exhausted: "'we have not found this body's own description of what it does', with rungs",
    },
    {
      field: "meeting_venue",
      requirement: "required",
      notApplicableWhen: "the body publishes that it meets remotely only",
      evidenceStandard: "the venue in the BODY'S OWN words — never borrowed from a sibling body",
      success: "a street address the body itself publishes",
      exhausted: "the honest venue-unavailable state with every rung listed",
    },
    {
      field: "meeting_schedule",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard: `${SOURCED}; NH may lawfully publish a date and place and no agenda (RSA 91-A:2)`,
      success: "dated sittings, with startPrecision honest about day-versus-hour",
      exhausted: "'could not reach the calendar', with the wall named — never 'no meetings'",
    },
    {
      field: "roster",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard: `${SOURCED}; surnames only is a partial, not a success`,
      success: "every seat, with the holder's name as filed",
      exhausted: "the body publishes no membership; rungs recorded",
    },
    {
      field: "homepage_or_official_page",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard: "a URL that was actually fetched and returned the body's own page",
      success: "a fetched, verified URL",
      exhausted: "no page exists for this body; the parent page is cited instead and labelled as the parent's",
    },
    {
      field: "enabling_authority",
      requirement: "optional",
      notApplicableWhen: "never",
      evidenceStandard: "the statute, charter article or town-meeting vote that created the body, cited",
      success: "a citation a reader can follow",
      exhausted: "not located",
    },
  ],
  official: [
    {
      field: "name_as_filed",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard: `${SOURCED}, from an election authority or the body's own roster`,
      success: "the name as the authority writes it",
      exhausted: "the seat is published as vacant, or the body publishes no names",
    },
    {
      field: "seat_or_title",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard: SOURCED,
      success: "the office as published",
      exhausted: "rungs recorded",
    },
    {
      field: "photo",
      requirement: "required",
      notApplicableWhen: "never — an honest initials placeholder is a SUCCESS, not an absence",
      evidenceStandard: "one of the four doors in CLAUDE.md, with the door recorded per row",
      success: "a clean solo portrait through a named door, or honest initials with the doors tried",
      exhausted: "initials, with every door recorded as tried in docs/photo-report.md",
    },
    {
      field: "working_contact",
      requirement: "required",
      notApplicableWhen: "the government publishes only a general office contact, which is then recorded as the body's",
      evidenceStandard: `${SOURCED}; a contact that was not seen published is never inferred`,
      success: "an email or phone the government itself publishes for this person or seat",
      exhausted: "'no direct contact published', with the general office contact offered and labelled as such",
    },
    {
      field: "specific_verified_page",
      requirement: "required",
      notApplicableWhen: "never",
      evidenceStandard:
        "a page about THIS person, fetched; an official-host read IS the verification, on the read date",
      success: "a fetched URL on the body's own or the government's own host",
      exhausted: "no per-person page exists; the roster page is cited and labelled as the roster's",
    },
    {
      field: "campaign_site",
      requirement: "optional",
      notApplicableWhen: "the person holds an appointed seat and has never stood for it",
      evidenceStandard:
        "the candidate's own domain, or a social page whose authenticity is establishable by an authoritative trail, labelled honestly",
      success: "a fetched URL, labelled by what it is",
      exhausted: "no campaign presence found; rungs recorded",
    },
    {
      field: "term_and_seat_basis",
      requirement: "optional",
      notApplicableWhen: "never",
      evidenceStandard: `${SOURCED}: elected or appointed, term length, term end`,
      success: "the basis and the term, sourced",
      exhausted: "not published",
    },
    {
      field: "public_disclosures",
      requirement: "optional",
      notApplicableWhen: "the jurisdiction compels no disclosure from this seat",
      evidenceStandard:
        "the filing itself — financial disclosure, conflict of interest, outside employment, gifts, recusals — as filed, never characterized",
      success: "the filing, cited, rendered as filed",
      exhausted: "the obligation exists and the filing was not reachable; rungs recorded",
    },
  ],
  candidate: [
    { field: "name_as_filed", requirement: "required", notApplicableWhen: "never", evidenceStandard: "the election authority's own filing", success: "the name as filed", exhausted: "n/a — a candidate without a filing is not on the ballot" },
    { field: "office_and_party_as_filed", requirement: "required", notApplicableWhen: "the contest is non-partisan by statute", evidenceStandard: "the election authority's own filing", success: "as filed", exhausted: "rungs recorded" },
    { field: "photo", requirement: "required", notApplicableWhen: "never — honest initials are a success", evidenceStandard: "the four-door rule, door recorded", success: "a portrait through a named door, or initials with doors tried", exhausted: "initials, doors recorded per candidate" },
    { field: "campaign_site_or_page", requirement: "required", notApplicableWhen: "never", evidenceStandard: "own domain, or an authenticated social page labelled as one", success: "a fetched URL", exhausted: "THIN_CANDIDATE_LINE, with rungs — equal effort recorded per candidate" },
    { field: "blurb_with_source_class", requirement: "required", notApplicableWhen: "never", evidenceStandard: "prose attributed in the committed register, or nothing at all", success: "labelled prose", exhausted: "no self-description found; the standard line renders" },
    { field: "sourced_positions", requirement: "optional", notApplicableWhen: "never", evidenceStandard: "a specific statement, vote, filing or questionnaire — never inferred from party", success: "positions with sources", exhausted: "'no public position found'" },
  ],
  school_body: [
    { field: "superintendent", requirement: "required", notApplicableWhen: "the district publishes no superintendent post", evidenceStandard: `${SOURCED} from the district's own site`, success: "name and contact, sourced", exhausted: "rungs recorded" },
    { field: "board_roster", requirement: "required", notApplicableWhen: "never", evidenceStandard: `${SOURCED}; surnames only is a partial`, success: "every seat with its holder", exhausted: "rungs recorded" },
    { field: "member_towns", requirement: "required", notApplicableWhen: "the district serves a single town", evidenceStandard: "the district's own or the state's own enumeration — never inferred from proximity", success: "the member list, cited", exhausted: "rungs recorded" },
    { field: "meeting_venue", requirement: "required", notApplicableWhen: "remote-only, published", evidenceStandard: "the body's own words", success: "an address", exhausted: "honest venue-unavailable with rungs" },
    { field: "meeting_schedule", requirement: "required", notApplicableWhen: "never", evidenceStandard: SOURCED, success: "dated sittings", exhausted: "the wall named" },
  ],
  meeting_series: [
    { field: "dated_sittings", requirement: "required", notApplicableWhen: "never", evidenceStandard: "the body's own calendar, notice or published schedule", success: "rows with dates and honest precision", exhausted: "the wall named, never an empty render" },
    { field: "venue_per_sitting", requirement: "required", notApplicableWhen: "the body publishes one standing venue for the series", evidenceStandard: "the sitting's own notice", success: "an address", exhausted: "honest, with rungs" },
    { field: "agenda_document", requirement: "optional", notApplicableWhen: "NH RSA 91-A:2 requires no agenda at all", evidenceStandard: "the document itself, in any format; a PDF is data", success: "a fetched document", exhausted: "no agenda published — lawful in NH and stated as such" },
  ],
  office: [
    { field: "office_name_plain_language", requirement: "required", notApplicableWhen: "never", evidenceStandard: "the authority's own naming", success: "a name a stranger understands", exhausted: "rungs recorded" },
    { field: "what_it_does", requirement: "required", notApplicableWhen: "never", evidenceStandard: "statute, charter, or the office's own description, cited", success: "plain language with a source", exhausted: "rungs recorded" },
    { field: "current_holder", requirement: "required", notApplicableWhen: "the seat is published as vacant", evidenceStandard: `${SOURCED} from an election authority or the office itself`, success: "the holder as published", exhausted: "rungs recorded" },
    { field: "how_it_is_filled", requirement: "optional", notApplicableWhen: "never", evidenceStandard: "the statute or charter, cited", success: "elected or appointed, term, cited", exhausted: "not published" },
  ],
};

/** Required fields only — the denominator any completion rate is stated against. */
export function requiredFields(type: SubjectType): string[] {
  return FIELD_MATRIX[type].filter((f) => f.requirement === "required").map((f) => f.field);
}

export function requiredCount(type: SubjectType): number {
  return requiredFields(type).length;
}
