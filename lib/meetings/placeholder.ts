/**
 * Text a publisher typed to hold a place: a calendar entry titled "Test" or
 * "Test Meeting", a venue of "TBD" or "TEST TEST TEST". The shape is the
 * publisher's own marker, never a list of bodies; real titles that merely
 * contain the word ("Testing Center Advisory Board") do not match.
 */
const TEST_TITLE = /^[\s\p{P}]*(?:test(?:ing)?|placeholder|dummy)(?:\s+(?:meeting|event|agenda|entry))?[\s\p{P}]*$/iu;
const UNSTATED_VENUE = /^[\s\p{P}]*(?:(?:test(?:ing)?|placeholder|dummy|tbd|tba|n\/a|to be (?:determined|announced))\b[\s\p{P}]*)+$/iu;

/** A sitting the publisher titled as a test; it is not a meeting a resident can attend. */
export function isTestSitting(sitting: { readonly title: string }): boolean {
  return TEST_TITLE.test(sitting.title);
}

/** A venue the publisher left as a placeholder: the page states no place. */
export function isPlaceholderVenue(text: string): boolean {
  return UNSTATED_VENUE.test(text.trim());
}
