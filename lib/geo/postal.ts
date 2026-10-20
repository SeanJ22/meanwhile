import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postalAreaIn, type PostalTable } from "./postal-core.ts";
import { serverReaderValue } from "../reader/memory.ts";

/** API, page, and startup module contexts share one parsed server table. */
export function postalTable(): PostalTable {
  return serverReaderValue("postal-table", () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), "lib/geo/postal-zips.json"), "utf8")) as { zips: PostalTable };
    return file.zips;
  });
}

/** Server-only postal metadata; the browser loads it through zcta-table's lazy import. */
export function postalArea(zip: string) {
  return postalAreaIn(postalTable(), zip);
}

export function zipNeedsAddress(zip: string): boolean {
  const area = postalArea(zip);
  return area !== null && area.type !== "standard";
}
