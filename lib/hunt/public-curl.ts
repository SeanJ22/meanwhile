import { resolvePublicTarget, type PublicLookup } from "./egress.ts";
import { abortable, publicProxyFor } from "./public-transport.ts";

/** One hop only. -q must be first: an operator's curlrc cannot re-enable redirects. */
export async function checkedCurlArguments(raw: string, options: { signal: AbortSignal; lookup?: PublicLookup; env?: Readonly<Record<string, string | undefined>> }): Promise<string[]> {
  const { url, addresses } = await abortable(resolvePublicTarget(raw, options.lookup), options.signal);
  const selected = addresses.find(address => address.family === 4) ?? addresses[0];
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const ip = selected.family === 6 ? `[${selected.address}]` : selected.address;
  const proxy = publicProxyFor(url, options.env);
  return ["-q", "-s", "-S", "-i", "--compressed", "--proto", "=http,https", "--max-redirs", "0", "--suppress-connect-headers",
    "--connect-to", `${url.hostname}:${port}:${ip}:${port}`,
    // CONNECT to the checked IP also prevents the proxy from resolving the
    // original name a second time. Never bypass a configured proxy on failure.
    ...(proxy ? ["--proxy", proxy.href, "--noproxy", "", "--proxytunnel"] : ["--noproxy", "*"])];
}

/** Decode headers separately from bytes; skip informational (100/103) responses. */
export function parseCurlIncluded(out: Buffer): { status: number | null; contentType: string; location: string | null; body: Uint8Array } {
  let offset = 0;
  while (offset < out.length) {
    const cut = out.indexOf("\r\n\r\n", offset);
    const head = out.subarray(offset, cut < 0 ? out.length : cut).toString("latin1");
    const matched = /^HTTP\/[\d.]+\s+(\d{3})/.exec(head)?.[1];
    const status = matched ? Number(matched) : null;
    const next = cut < 0 ? out.length : cut + 4;
    if (status !== null && status >= 100 && status < 200 && status !== 101) { offset = next; continue; }
    const header = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, "im").exec(head)?.[1]?.trim() ?? null;
    return { status, contentType: header("content-type") ?? "", location: header("location"), body: new Uint8Array(out.subarray(next)) };
  }
  return { status: null, contentType: "", location: null, body: new Uint8Array(0) };
}
