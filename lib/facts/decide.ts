import { canonicalJson } from "../control-plane/repository/types.ts";
import type { Provenance } from "./check.ts";

export type Decision = "PUBLISH" | "CONFIRM" | "KEEP_CURRENT" | "FLAG_OWNER";

export interface Side { readonly value: unknown; readonly provenance: Provenance; readonly fetchedAt: Date; readonly sourceUrl?: string }

const official = (p: Provenance) => p === "OFFICIAL" || p === "FILING";

/** Newer and more official wins; a value Sean typed changes only through him. */
export function decide(current: Side | null, incoming: Side, field?: string): Decision {
  if (current === null) return "PUBLISH";
  if (canonicalJson(current.value) === canonicalJson(incoming.value)) return "CONFIRM";
  if (incoming.provenance === "OWNER") return "PUBLISH";
  if (current.provenance === "OWNER") return official(incoming.provenance) ? "FLAG_OWNER" : "KEEP_CURRENT";
  if (field === "agenda_url" && official(current.provenance) && agendaPage(current.value, current.sourceUrl) && !agendaPage(incoming.value)) return "KEEP_CURRENT";
  if (official(current.provenance) !== official(incoming.provenance)) return official(incoming.provenance) ? "PUBLISH" : "KEEP_CURRENT";
  return incoming.fetchedAt > current.fetchedAt ? "PUBLISH" : "KEEP_CURRENT";
}

/** Preserve an official agenda or calendar page when a newer sidebar points to an unrelated page. */
function agendaPage(value: unknown, sourceUrl?: string): boolean {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (/youtube|facebook|twitter|instagram|vimeo/i.test(url.hostname + url.pathname)) return false;
  const purpose = /agenda|calendar|meeting|council[-_/]?archives|boarddocs|legistar/i.test(`${url.pathname} ${url.search} ${url.hostname}`);
  // A council/board page already published as the agenda route is the government's own meeting page, even when its URL says only "city-council-2".
  if (!purpose && !(sourceUrl && /council|board|commission/i.test(url.pathname))) return false;
  return sourceUrl === undefined || URL.canParse(sourceUrl) && url.hostname.replace(/^www\./, "") === new URL(sourceUrl).hostname.replace(/^www\./, "");
}
