import { join } from "node:path";
import type { PostalRow } from "../geo/postal-core.ts";
import { zipSourceRows } from "./source-rows.ts";

export interface PostalLink { readonly zip: string; readonly zcta: string; readonly addressRequired: boolean }

/** Stream flat postal rows; one state's aliases never load the national table. */
export async function statePostalLinks(root: string, state: string): Promise<PostalLink[]> {
  const result: PostalLink[] = [];
  for await (const [zip,value] of zipSourceRows(join(root, "lib/geo/postal-zips.json"))) {
    const row = value as PostalRow;
    if (row[5] !== state || !row[3] || row[3] === zip) continue;
    result.push({ zip, zcta: row[3], addressRequired: row[2] !== "standard" });
  }
  return result;
}
