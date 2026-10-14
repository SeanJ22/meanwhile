const text = (value: unknown): value is string => typeof value === "string";
const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** Source-specific optional facts may retain their exact prior authority while
 * a new roster verifies membership. Identity is part of every retained fact;
 * a changed person, party assertion, or URL must obtain its own current proof. */
export function inheritedRosterSourceFacts(beforeValue: unknown, afterValue: unknown): Map<string, unknown> {
  const before = row(beforeValue), after = row(afterValue);
  const inherited = new Map<string, unknown>();
  if (!before.bodyId || before.bodyId !== after.bodyId) return inherited;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (text(after.partisanshipSourceUrl) && after.partisanshipSourceUrl !== after.sourceUrl &&
      before.partisanshipSourceUrl === after.partisanshipSourceUrl && before.partisanship === after.partisanship) {
    inherited.set(after.partisanshipSourceUrl, [after.bodyId, after.partisanship, after.partisanshipSourceUrl]);
  }
  const persons = new Map(rows(before.members).map(value => { const person = row(value); return [person.id, person]; }));
  // One URL can support several people. Every current assertion citing that URL
  // must match the prior record; one changed assertion invalidates its reuse.
  const candidates = new Map<string, unknown[]>();
  const invalid = new Set<string>();
  for (const value of rows(after.members)) {
    const person = row(value), old = persons.get(person.id);
    const membership = row(person.membershipSource);
    if (text(membership.sourceUrl)) {
      const previousSource = old?.membershipSource ?? { sourceUrl: before.sourceUrl, sourceOrg: before.sourceOrg, collectedAt: before.collectedAt };
      const withoutSource = (entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "membershipSource"));
      if (!old || !equal(membership, previousSource) || !equal(withoutSource(person), withoutSource(old))) invalid.add(membership.sourceUrl);
      candidates.set(membership.sourceUrl, [...(candidates.get(membership.sourceUrl) ?? []), [person.id, membership, withoutSource(person)]]);
    }
    for (const fields of [["partySourceUrl", "partyLabel", "partySourceOrg", "partyCollectedAt"]]) {
      const url = person[fields[0]];
      if (!text(url) || url === after.sourceUrl) continue;
      const names = ["id", "name", "officeTitle", ...fields];
      const fact = names.map(name => person[name] ?? null);
      if (!old || !equal(fact, names.map(name => old[name] ?? null))) invalid.add(url);
      candidates.set(url, [...(candidates.get(url) ?? []), fact]);
    }
    for (const field of ["termNote", "email", "phone", "websiteUrl"] as const) {
      const retained = row(row(person.retainedFieldSources)[field]);
      const url = retained.sourceUrl;
      if (!text(url) || url === after.sourceUrl) continue;
      const oldSource = row(row(old?.retainedFieldSources)[field]);
      const previousSource = text(oldSource.sourceUrl) ? oldSource : old?.membershipSource ?? { sourceUrl: before.sourceUrl, sourceOrg: before.sourceOrg, collectedAt: before.collectedAt };
      const fact = [person.id, person.name, person.officeTitle, field, person[field] ?? null, retained];
      if (!old || !equal(person[field] ?? null, old[field] ?? null) || !equal(retained, previousSource) || person.name !== old.name || person.officeTitle !== old.officeTitle) invalid.add(url);
      candidates.set(url, [...(candidates.get(url) ?? []), fact]);
    }
  }
  for (const [url, facts] of candidates) if (!invalid.has(url)) inherited.set(url, [...(inherited.has(url) ? [inherited.get(url)] : []), ...facts]);
  for (const url of invalid) inherited.delete(url);
  return inherited;
}

export function registryMemberCitedUrls(key: string, record: unknown): string[] {
  const member = row(record);
  const kind = key.slice(0, key.indexOf(":"));
  const cited: unknown[] =
    kind === "division" || kind === "body" ? [row(member.provenance).sourceUrl]
      : kind === "body-roster" ? [
        member.sourceUrl,
        member.partisanshipSourceUrl,
        ...rows(member.members).flatMap((person) => [row(person).partySourceUrl, row(row(person).membershipSource).sourceUrl,
          ...Object.values(row(row(person).retainedFieldSources)).map(source => row(source).sourceUrl)]),
      ]
      : kind === "statewide-executive" ? [member.sourceUrl, member.partySourceUrl]
      : kind === "official-candidacy" ? [row(member.candidacy).sourceUrl, ...rows(member.ballotSourceUrls)]
      : kind === "official-photo" ? [member.sourceUrl]
      : [];
  return [...new Set(cited.filter((url): url is string => text(url) && /^https:\/\//.test(url)))].sort();
}
