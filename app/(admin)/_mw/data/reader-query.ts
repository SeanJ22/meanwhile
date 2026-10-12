import "server-only";

/** Every call runs in one READ ONLY transaction over HTTP. Null where this deployment names no reader store. */
export { readerQuery } from "@/lib/civic-data/promoted-reader-query.ts";
