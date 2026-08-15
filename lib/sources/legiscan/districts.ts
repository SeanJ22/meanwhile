/**
 * LegiScan's district string → our OCD district key.
 *
 * The join this whole source depends on, kept in one place because getting it
 * wrong is silent: a bad mapping produces a *low* match rate, not an error,
 * and a low match rate looks like "the roster is thin" rather than "the key
 * is wrong". It was wrong once during the build — an alphabetical county
 * table indexed from 1 instead of 0 — and it read as 10 of 426 NH members
 * matching, which is exactly the shape of a real coverage gap.
 *
 * Two formats:
 *
 * - **AZ and NJ** number their districts statewide: `HD-040` → `sldl:40`,
 *   `SD-025` → `sldu:25`.
 * - **New Hampshire** numbers House districts *within a county*:
 *   `HD-12-HIL` is Hillsborough 12. The Census SLDL code concatenates a
 *   county ordinal with the two-digit district number — `sldl:512` — where
 *   the ordinal is the county's **zero-based** alphabetical position.
 *   NH Senate districts are statewide-numbered like everyone else.
 *
 * The county table below is asserted against our own committed boundary
 * labels in `tests/legiscan.test.ts` — `public/geo/sldl-33.geojson` carries
 * `State House District Merrimack 08` beside `sldl:608`, so the claim is
 * checkable rather than remembered.
 */

/** Zero-based alphabetical position of each NH county. */
export const NH_COUNTY_ORDINAL: Readonly<Record<string, number>> = {
  BEL: 0, // Belknap
  CAR: 1, // Carroll
  CHE: 2, // Cheshire
  COO: 3, // Coos
  GRA: 4, // Grafton
  HIL: 5, // Hillsborough
  MER: 6, // Merrimack
  ROC: 7, // Rockingham
  STR: 8, // Strafford
  SUL: 9, // Sullivan
};

/**
 * `sldl:512` / `sldu:7`, or null when the string is not a district we can
 * key on.
 *
 * Null is returned rather than guessed at, and the caller counts it. A
 * district string this cannot parse is a finding about a state we have not
 * met yet, not a row to drop quietly.
 */
export function districtKeyFor(
  state: string,
  district: string,
): string | null {
  const d = district.trim();
  const chamber = d.startsWith("SD") ? "sldu" : d.startsWith("HD") ? "sldl" : null;
  if (!chamber) return null;

  if (state === "NH" && chamber === "sldl") {
    const m = /^HD-(\d+)-([A-Z]{3})$/.exec(d);
    if (!m) return null;
    const ordinal = NH_COUNTY_ORDINAL[m[2]];
    if (ordinal === undefined) return null;
    // `Number()` strips the leading zero Belknap's ordinal produces: the OCD
    // id for Belknap 7 is `sldl:7`, not `sldl:007`, and keying on the padded
    // form silently loses every Belknap seat.
    const code = Number(`${ordinal}${String(Number(m[1])).padStart(2, "0")}`);
    return `sldl:${code}`;
  }

  const m = /^[HS]D-(\d+)$/.exec(d);
  if (!m) return null;
  return `${chamber}:${Number(m[1])}`;
}

/**
 * A name reduced to what two sources can be expected to agree on.
 *
 * Diacritics folded, punctuation dropped, case flattened. The comparison is
 * on the **surname**: LegiScan and a legislature's own directory routinely
 * differ on middle names, nicknames and suffixes, and requiring the whole
 * string to agree would reject correct matches. The surname is checked
 * WITHIN a district that already matched, so the pair is what identifies the
 * person — never the name alone, which is the rule.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    // U+0300-U+036F: the combining marks NFD splits accents into.
    .replace(new RegExp("[\u0300-\u036f]", "g"), "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The surname, for the within-district agreement check. */
export function surname(value: string): string {
  const parts = normalizeName(value).split(" ").filter(Boolean);
  // Drop a trailing generational suffix so "Smith Jr" agrees with "Smith".
  const tail = parts[parts.length - 1];
  if (parts.length > 1 && ["jr", "sr", "ii", "iii", "iv"].includes(tail)) {
    return parts[parts.length - 2];
  }
  return tail ?? "";
}
