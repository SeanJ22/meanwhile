/** A mailing box is not the street address a reader needs to visit the office. */
export function isPostalOnlyAddress(value: string): boolean {
  const box = /\b(?:p\.?\s*o\.?\s*(?:box|drawer)|post\s+office\s+box|box)\s*[a-z0-9-]+\b/gi;
  if (!box.test(value)) return false;
  const rest = value.replace(box, " ");
  if (/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(?:[a-z0-9'-]+\s+){0,5}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct(?!\s+\d{5}\b)|way|boulevard|blvd|place|pl|square|sq)\b/i.test(rest)) return false;
  return !/\b\d+[a-z]?\s+(?:(?:[nsew]{1,2})\.?\s+)?(?:[a-z]|\d+(?:st|nd|rd|th)?\s+(?:st(?:reet)?|ave(?:nue)?|road|rd|drive|dr|lane|ln|court|ct|way|boulevard|blvd)\b)/i.test(rest);
}
