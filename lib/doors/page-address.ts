const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

/** A hostname as the registry stores it: lower case, no scheme, no path, no port. */
export function normalizeHost(raw: string): string | null {
  let text = raw.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    try { text = new URL(text).hostname; } catch { return null; }
  }
  text = text.replace(/\.$/, "");
  return HOST.test(text) ? text : null;
}

/** The address a door is keyed on: no fragment, no tracking noise, no trailing slash. */
export function pageAddress(raw: string): { readonly url: string; readonly host: string } | null {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const host = normalizeHost(parsed.hostname);
  if (host === null) return null;
  parsed.hash = "";
  const path = parsed.pathname.replace(/\/+$/, "");
  const keep = [...parsed.searchParams.entries()].filter(([key]) => !/^(utm_|fbclid$|gclid$)/i.test(key)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = keep.length === 0 ? "" : `?${new URLSearchParams(keep).toString()}`;
  return { url: `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ""}${path}${query}`, host };
}
