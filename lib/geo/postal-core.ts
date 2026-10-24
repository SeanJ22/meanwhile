/** Postal ZIPs describe mail destinations. Only a residential address settles districts. */
export type ZipType = "standard" | "po-box" | "unique" | "military" | null;

/** Acquired postal source row. Null coordinates mean a known, unplaced ZIP. */
export type PostalRow = [
  lat: number | null, lng: number | null, type: ZipType,
  zcta: string | null, place: string, state: string,
  county: string, countyFips: string | null, placeGeoid: string | null,
];
export type PostalTable = Record<string, PostalRow>;

export interface PostalArea {
  type: ZipType;
  zcta: string | null;
  place: string;
  state: string;
  county: string;
  countyFips: string | null;
  placeGeoid: string | null;
}

export function postalAreaIn(table: PostalTable, zip: string): PostalArea | null {
  const row = table[zip];
  return row ? { type: row[2], zcta: row[3], place: row[4], state: row[5],
    county: row[6], countyFips: row[7], placeGeoid: row[8] } : null;
}

/** A mail-only ZIP that is also its own Census ZCTA has residents of its own; only one borrowing another ZCTA's area settles no districts. */
export function postalAreaNeedsAddress(zip: string, area: Pick<PostalArea, "type" | "zcta"> | null): boolean {
  return area !== null && area.type !== "standard" && area.zcta !== zip;
}

export const ZIP_AREA_MISSING = "We don't have that ZIP's area yet. Enter your street address and we'll find your districts.";

export function postalAreaMessage(area: PostalArea): string {
  const kind = area.type === "po-box" ? "P.O. Box only" : area.type === "unique" ? "unique to one institution" : "a mail destination";
  return `${area.place}, ${area.state}${area.county ? ` · ${area.county}` : ""}. This ZIP is ${kind}. Your districts depend on where you live. Enter your street address to find them.`;
}

/** These are places to browse, never a reader's residential district assignments. */
export function isTownOrCountyDivision(id: string): boolean {
  return /^ocd-division\/country:us(?:\/(?:state|territory|district):[a-z]{2})?(?:\/(?:county|place|cousub):[^/]+)*$/.test(id);
}
