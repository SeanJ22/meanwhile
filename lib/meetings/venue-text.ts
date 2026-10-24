/** A blank marker may carry the publisher's city and postal code without naming a room or street. */
export function hasPublishedVenue(value: string | null | undefined): boolean {
  const text = value?.trim();
  return Boolean(text && !/^[-–—](?:\s*[a-z][a-z .'-]*\s+[a-z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?$/i.test(text));
}
