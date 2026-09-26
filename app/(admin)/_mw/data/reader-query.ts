import "server-only";

/**
 * The reader store, for the slices Admin reads from its promoted pointers
 * (`lib/control-plane/admin-view/promoted-slices.ts`). Every call runs its
 * statements in one READ ONLY transaction over HTTP: one round trip, no socket
 * to open, and Postgres itself refuses a write. Null where this deployment
 * names no reader store.
 */
export { readerQuery } from "@/lib/civic-data/promoted-reader-query.ts";
