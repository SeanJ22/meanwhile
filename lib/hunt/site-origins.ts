/** The government site and its www twin, normalized for discovery. */
export function siteOrigins(ownWebAddress: string | null): readonly string[] {
  if (ownWebAddress === null) return [];
  const raw = ownWebAddress.trim();
  if (raw === "") return [];
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return [];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return [];
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return [];
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [...new Set([`https://${host}`, `https://${twin}`])];
}
