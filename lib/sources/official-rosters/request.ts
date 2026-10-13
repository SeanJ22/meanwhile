import { createHash } from "node:crypto";
import type { OfficialRosterTarget } from "./targets.ts";

export const GEORGIA_SESSIONS_URL = "https://www.legis.ga.gov/api/sessions";
export const GEORGIA_MEMBER_URL_PREFIX = "https://www.legis.ga.gov/api/members/list/";

export function georgiaCurrentSession(bytes: Uint8Array): string {
  const rows = JSON.parse(new TextDecoder().decode(bytes)) as { id: number; isCurrent: boolean }[];
  if (!Array.isArray(rows)) throw new Error("Georgia official session inventory is not an array");
  const current = rows.filter(row => row.isCurrent === true);
  if (current.length !== 1 || !Number.isInteger(current[0]!.id) || current[0]!.id <= 0) throw new Error("Georgia official session inventory lacks one current session ID");
  return String(current[0]!.id);
}

/** Georgia's public website computes this request before displaying its own rosters. */
export function georgiaPublicTokenRequest(now: string | Date): { url: string; init: RequestInit } {
  const milliseconds = new Date(now).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error("Georgia public API request requires a valid check time");
  // Public application constants, observed in www.legis.ga.gov's own JavaScript bundle.
  const key = createHash("sha512").update(`QFpCwKfd7fjVEXFFwSu36BwwcP83xYgxLAhLYmKkletvarconst${milliseconds}`).digest("hex");
  const url = new URL("https://www.legis.ga.gov/api/authentication/token");
  url.searchParams.set("key", key);
  url.searchParams.set("ms", String(milliseconds));
  return { url: url.href, init: { method: "GET" } };
}

/** A token is obtained from the public-site request above, never from a user credential. */
export function georgiaPublicApiRequest(publicToken: string, url = GEORGIA_SESSIONS_URL): RequestInit {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.legis.ga.gov" || !parsed.pathname.startsWith("/api/")) throw new Error("Georgia public-site token can only be sent to its official API");
  if (!publicToken || /[\r\n]/.test(publicToken)) throw new Error("Georgia public website did not return a valid access token");
  return { headers: { Authorization: `Bearer ${publicToken}` } };
}

/** Public endpoint request semantics; roster bodies and cache probes share these semantics. */
export function officialRosterRequest(target: Pick<OfficialRosterTarget, "state">, url: string, _now: string | Date): RequestInit {
  const parsed = new URL(url);
  if (target.state === "DE" && parsed.hostname === "legis.delaware.gov" && /^\/json\/(?:House\/GetRepresentatives|Senate\/GetSenators)$/.test(parsed.pathname)) return { method: "POST", body: "" };
  return {};
}
