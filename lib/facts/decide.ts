import { canonicalJson } from "../control-plane/repository/types.ts";
import type { Provenance } from "./check.ts";

export type Decision = "PUBLISH" | "CONFIRM" | "KEEP_CURRENT" | "FLAG_OWNER";

export interface Side { readonly value: unknown; readonly provenance: Provenance; readonly fetchedAt: Date }

const official = (p: Provenance) => p === "OFFICIAL" || p === "FILING";

/** Newer and more official wins; a value Sean typed changes only through him. */
export function decide(current: Side | null, incoming: Side): Decision {
  if (current === null) return "PUBLISH";
  if (canonicalJson(current.value) === canonicalJson(incoming.value)) return "CONFIRM";
  if (incoming.provenance === "OWNER") return "PUBLISH";
  if (current.provenance === "OWNER") return official(incoming.provenance) ? "FLAG_OWNER" : "KEEP_CURRENT";
  if (official(current.provenance) !== official(incoming.provenance)) return official(incoming.provenance) ? "PUBLISH" : "KEEP_CURRENT";
  return incoming.fetchedAt > current.fetchedAt ? "PUBLISH" : "KEEP_CURRENT";
}
