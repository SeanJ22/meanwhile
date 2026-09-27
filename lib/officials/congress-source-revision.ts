/** Resolve once per authorized acquisition, then read every directory file at
 * that immutable revision. Never silently reuse an old pin after lookup failure. */
export async function currentCongressSourceRevision(request: typeof fetch = fetch): Promise<string> {
  const response = await request("https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1", {
    headers: { "User-Agent": "Meanwhile civic-data collector", accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`CONGRESS_SOURCE_REVISION_HTTP_${response.status}`);
  const rows: unknown = await response.json();
  const sha = Array.isArray(rows) ? rows[0]?.sha : null;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error("CONGRESS_SOURCE_REVISION_INVALID");
  return sha.toLowerCase();
}
