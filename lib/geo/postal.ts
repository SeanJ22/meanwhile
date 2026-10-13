import file from "./postal-zips.json" with { type: "json" };
import { postalAreaIn, type PostalTable } from "./postal-core.ts";

/** Server-only postal metadata; the browser loads it through zcta-table's lazy import. */
export function postalArea(zip: string) {
  return postalAreaIn(file.zips as unknown as PostalTable, zip);
}

export function zipNeedsAddress(zip: string): boolean {
  const area = postalArea(zip);
  return area !== null && area.type !== "standard";
}
