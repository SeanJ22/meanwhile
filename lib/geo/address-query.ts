/** Extract the published street address from a venue heading and attendance instructions. */
export function censusAddressQuery(published: string): string {
  const text = published
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/Hawai[‘’']i/gi, "Hawaii");
  const street =
    /\b\d+[a-z]?(?:-\d+)?\s+(?:[a-z0-9][\w.'’-]*\s+){0,8}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|square|sq|way|expressway|expy|plaza|center|ctr|broadway)\b\.?/i.exec(
      text,
    );
  const bare = /(?:^|[\r\n,;:]|\bat\s+)\s*(\d+\s+[a-z][\s\S]*)/i.exec(
    text,
  )?.[1];
  let address = street ? text.slice(street.index) : (bare ?? text);
  address = address.split(
    /https?:\/\/|\b(?:join\s+(?:zoom|the)|meeting\s+id|pass\s*code|virtual\s*\(?online|or\s+(?:by\s+zoom|virtually)|this\s+meeting\s+is)/i,
    1,
  )[0];
  // A room or floor is useful attendance text but is not part of a Census street address.
  address = address
    .replace(
      /,?\s+(?:(?:conference\s+)?(?:room|rm\.?|suite|ste\.?)\s*#?\s*[\w-]+|(?:first|second|third|fourth|\d+(?:st|nd|rd|th))\s+(?:floor|flr\.?))\b/gi,
      "",
    )
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[\r\n]+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/[\s,;.]+$/, "");
  return address.trim();
}

/** A repeated address or the same named room in an already published sitting retains its verified point. */
export function repeatsPublishedVenue(
  published: string,
  name: string,
  address: string | null,
): boolean {
  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const text = words(published);
  const suffix =
    /\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|place|pl|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|square|sq)\b/g;
  const priorName = words(name);
  const sameStreetWithoutSuffix =
    !suffix.test(text) &&
    text === priorName.replace(suffix, "").replace(/\s+/g, " ").trim();
  return (
    Boolean(text) &&
    (text === words(address ?? "") ||
      text === priorName ||
      sameStreetWithoutSuffix ||
      (text.length >= 12 && priorName.endsWith(` ${text}`)))
  );
}
