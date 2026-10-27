const postalBox = /\b(?:p[.\s]*o[.\s]*(?:box|b)|post\s+office\s+box)(?=\b|\d)\.?\s*(?:#\s*)?[a-z0-9-]*/gi;

/** Keep a published street when a separate delivery box was appended to it. */
export function votingPhysicalAddress(address: string): string | null {
  const parts = address.split(/[,;\n]+/);
  let removed = false;
  const physical = parts.flatMap(part => {
    const street = part.replace(postalBox, () => { removed = true; return ""; });
    if (/^\s*general\s+delivery\b/i.test(street)) { removed = true; return []; }
    const cleaned = street.replace(/^\s*[/|]+\s*|\s*[/|]+\s*$/g, "").trim();
    return cleaned ? [cleaned] : [];
  });
  if (!removed) return address.trim() || null;
  // A city, state and ZIP left after removing a box are not a street address.
  if (!physical.some(part => /^(?:\d+[a-z]?(?:-\d+[a-z]?)?|one|two|three)\s+\S/i.test(part))) return null;
  return physical.join(", ");
}

/** Postal delivery destinations cannot be visited as polling places. */
export function mailingOnlyVotingAddress(address: string): boolean {
  return votingPhysicalAddress(address) === null;
}
