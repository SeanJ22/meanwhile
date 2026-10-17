import { rejectUnknown } from "@/lib/api/params";
import { lookupIn } from "@/lib/geo/zcta-core";
import type { PostalRow } from "@/lib/geo/postal-core";
import { createReadStream } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

async function zipRow(file: string, zip: string): Promise<unknown[] | null> {
  const key = new RegExp(`[,\\{]\\s*"${zip}"\\s*:\\s*\\[`);
  let buffer = "";
  let found = false;
  let scanned = 0, depth = 0;
  let quoted = false, escaped = false;
  for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
    buffer += chunk;
    if (!found) {
      const match = key.exec(buffer);
      if (!match) { buffer = buffer.slice(-128); continue; }
      buffer = buffer.slice(match.index + match[0].length - 1);
      found = true;
    }
    for (; scanned < buffer.length; scanned++) {
      const char = buffer[scanned];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "[") depth++;
      else if (char === "]" && --depth === 0) return JSON.parse(buffer.slice(0, scanned + 1));
    }
  }
  if (found) throw new Error("ZIP reference row is incomplete");
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const unknown = rejectUnknown(params, ["zip"]);
  const zips = params.getAll("zip");
  if (!unknown.ok || zips.length !== 1 || !/^\d{5}$/.test(zips[0])) {
    return Response.json({ error: "Send one five-digit ZIP." }, { status: 400 });
  }
  const zip = zips[0];
  const [centroid, postal] = await Promise.all([
    zipRow(join(process.cwd(), "lib", "geo", "zcta-centroids.json"), zip),
    zipRow(join(process.cwd(), "lib", "geo", "postal-zips.json"), zip),
  ]);
  return Response.json({ location: lookupIn(centroid ? { [zip]: centroid as [number, number] } : {}, zip,
    postal ? { [zip]: postal as PostalRow } : {}) });
}
