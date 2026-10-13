/**
 * Reduces a district designation to something two spellings agree on. Some
 * districts are designated by county and number ("<County> 8") and the two
 * sides zero-pad differently. Named districts also vary in spacing and punctuation.
 */
export function designationKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    // Strip leading zeros so "<County> 08" meets "<County> 8".
    .replace(/\b0+(\d)/g, "$1")
    .replace(/\bAND\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

const LABEL_PREFIX = /^(?:State (?:Senate|House|Representative|Legislative(?: Sub)?) ?District|Assembly District|Senate District|Delegate District|Legislative \((?:House|Senate)\) District|Senatorial District|Representative District)\s*/i;
const LABEL_SUFFIX = /(?: State House District| Senatorial District| District)$/i;

/** The designation a registry division's Census-sourced label encodes. */
export function designationFromLabel(label: string): string {
  return designationKey(
    label.replace(/^[A-Z]{2} /, "").replace(/\s*\(\d{4} plan\)$/, "").replace(LABEL_PREFIX, "").replace(LABEL_SUFFIX, ""),
  );
}
