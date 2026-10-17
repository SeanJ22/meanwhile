import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class EgressRefusal extends Error {}
export const MAX_PUBLIC_REDIRECTS = 10;
type PublicAddress = { address: string; family: 4 | 6 };
export type PublicLookup = (hostname: string) => Promise<readonly PublicAddress[]>;
export type PublicTarget = { url: URL; addresses: readonly PublicAddress[] };

/** Conservative global-unicast test; URL parsing first canonicalizes unusual IP spellings. */
export function isPublicAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  // Only native global unicast. This also refuses mapped IPv4, NAT64, local,
  // multicast and 6to4 tunnels rather than trusting an embedded destination.
  const first = Number.parseInt(canonical.split(":")[0], 16);
  if (!(first >= 0x2000 && first <= 0x3fff) || first === 0x2002) return false;
  if (first === 0x2001) {
    const second = Number.parseInt(canonical.split(":")[1] || "0", 16);
    if (second <= 0x1ff || second === 0xdb8) return false;
  }
  // Documentation prefix assigned in 2024.
  if (first === 0x3fff && Number.parseInt(canonical.split(":")[1] || "0", 16) <= 0x0fff) return false;
  return true;
}

/** Syntax/literal check only. Actual reads must use publicFetch, which pins checked DNS answers. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new EgressRefusal("not an absolute URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new EgressRefusal("public sources carry http(s) only");
  if (url.username || url.password) throw new EgressRefusal("public source URLs cannot contain credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host || host === "localhost" || [".localhost", ".local", ".internal", ".home.arpa", ".onion"].some(suffix => host.endsWith(suffix))) {
    throw new EgressRefusal("public sources cannot use a private host");
  }
  if (isIP(host) && !isPublicAddress(host)) throw new EgressRefusal("public sources cannot use a private or reserved IP address");
  return url;
}

export async function systemPublicLookup(hostname: string): Promise<readonly PublicAddress[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(answer => ({ address: answer.address, family: answer.family as 4 | 6 }));
}

/** Check every answer, not just the preferred one; callers connect only to these saved addresses. */
export async function resolvePublicTarget(raw: string, resolve: PublicLookup = systemPublicLookup): Promise<PublicTarget> {
  const url = assertPublicUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family ? [{ address: host, family: family as 4 | 6 }] : await resolve(host);
  if (!addresses.length || addresses.some(answer => !isPublicAddress(answer.address) || isIP(answer.address) !== answer.family)) {
    throw new EgressRefusal("source DNS did not resolve exclusively to public IP addresses");
  }
  return { url, addresses };
}

/** Credentials stay with their origin, including when callers walk redirects manually. */
export function publicRedirectHeaders(headers: HeadersInit | undefined, from: string, to: string): Headers {
  const next = new Headers(headers);
  next.delete("host");
  if (new URL(from).origin !== new URL(to).origin) {
    for (const name of ["authorization", "proxy-authorization", "cookie", "cookie2", "x-api-key", "api-key"]) next.delete(name);
  }
  return next;
}

export { publicFetch } from "./public-transport.ts";
