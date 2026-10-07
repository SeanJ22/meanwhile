/** URL identity for link health: fragments do not name a different page. */
export function linkHealthKey(address: string): string | null {
  try {
    const url = new URL(address);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export interface ReaderLinkHealth {
  readonly formatVersion: 1;
  readonly sweptAt: string;
  readonly deadAddresses: readonly string[];
}

/** Only a DEAD verdict disables a link; a deferred read keeps the last finding. */
export function projectLinkHealth(previous: ReaderLinkHealth | null,
  results: readonly { url: string; verdict: "OK" | "DEAD" | "LATER" | "WAITING" }[], sweptAt: string,
): ReaderLinkHealth {
  if (!Number.isFinite(Date.parse(sweptAt))) throw new Error("Link sweep has no valid read time");
  const dead = new Set(previous?.deadAddresses ?? []);
  for (const result of results) {
    const key = linkHealthKey(result.url);
    if (!key) continue;
    if (result.verdict === "DEAD") dead.add(key);
    if (result.verdict === "OK") dead.delete(key);
  }
  return { formatVersion: 1, sweptAt, deadAddresses: [...dead].sort() };
}

export function readLinkHealth(value: unknown): ReaderLinkHealth | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ReaderLinkHealth>;
  return row.formatVersion === 1 && typeof row.sweptAt === "string" && Number.isFinite(Date.parse(row.sweptAt)) &&
    Array.isArray(row.deadAddresses) && row.deadAddresses.every(url => typeof url === "string" && linkHealthKey(url) === url)
    ? row as ReaderLinkHealth : null;
}
