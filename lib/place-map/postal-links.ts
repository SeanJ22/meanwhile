import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { PostalRow } from "../geo/postal-core.ts";

export interface PostalLink { readonly zip: string; readonly zcta: string; readonly addressRequired: boolean }

/** Stream flat postal rows; one state's aliases never load the national table. */
export async function statePostalLinks(root: string, state: string): Promise<PostalLink[]> {
  let buffer = "";
  const result: PostalLink[] = [];
  const pattern = /"(\d{5})"\s*:\s*(\[(?:[^"\[\]]|"(?:[^"\\]|\\.)*")*\])/g;
  for await (const chunk of createReadStream(join(root, "lib/geo/postal-zips.json"), { encoding: "utf8" })) {
    buffer += chunk;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null, consumed = 0;
    while ((match = pattern.exec(buffer))) {
      const row = JSON.parse(match[2]) as PostalRow;
      consumed = pattern.lastIndex;
      if (row[5] !== state || !row[3] || row[3] === match[1]) continue;
      result.push({ zip: match[1], zcta: row[3], addressRequired: row[2] !== "standard" });
    }
    buffer = buffer.slice(consumed);
  }
  return result;
}
