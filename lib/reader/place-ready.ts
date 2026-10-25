import { Buffer } from "node:buffer";
import { gzipSync, gunzipSync } from "node:zlib";
import type { PlacePackage } from "./place-types.ts";

interface PackedReadyPlace {
  readonly encoding: "gzip-json-v1";
  readonly data: string;
}

/** Compress the complete JSON response before it crosses the database connection. */
export function packReadyPlace(page: PlacePackage): PackedReadyPlace {
  return { encoding: "gzip-json-v1", data: gzipSync(JSON.stringify(page)).toString("base64") };
}

/** Previously built uncompressed pages remain readable until their next rebuild. */
export function unpackReadyPlace(page: unknown): PlacePackage {
  if (!page || typeof page !== "object" || !("encoding" in page)) return page as PlacePackage;
  if (page.encoding !== "gzip-json-v1" || !("data" in page) || typeof page.data !== "string")
    throw new Error("PLACE_PAGE_ENCODING_INVALID");
  return JSON.parse(gunzipSync(Buffer.from(page.data, "base64")).toString("utf8")) as PlacePackage;
}
