/** A CDN that keeps responses by URL the way Netlify's does for what the routes send: for as long as Netlify-CDN-Cache-Control says, tagged by Netlify-Cache-Tag and Netlify-Cache-ID, followed by stale-while-revalidate. */
interface Kept { readonly status: number; readonly headers: Headers; readonly body: Uint8Array; readonly storedAt: number; readonly fresh: number; readonly stale: number; readonly tags: readonly string[] }

const seconds = (control: string | null, directive: string): number => Number(new RegExp(`(?:^|[ ,])${directive}=(\\d+)`).exec(control ?? "")?.[1] ?? 0);

export function fakeCdn(origin: (url: URL) => Promise<Response>, clock: () => number) {
  const kept = new Map<string, Kept>();
  const runs = { origin: 0, hits: 0 };
  const fetchOrigin = async (url: URL): Promise<Response> => {
    runs.origin++;
    const response = await origin(url), control = response.headers.get("netlify-cdn-cache-control");
    const body = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200 || response.status === 307 || response.status === 404) {
      const fresh = seconds(control, "max-age") * 1000;
      if (fresh > 0) kept.set(url.pathname + url.search, { status: response.status, headers: response.headers, body, storedAt: clock(), fresh, stale: seconds(control, "stale-while-revalidate") * 1000,
        tags: [...(response.headers.get("netlify-cache-tag")?.split(",") ?? []), ...(response.headers.get("netlify-cache-id")?.split(",") ?? [])].map(tag => tag.trim()) });
    }
    return new Response(body as BodyInit, { status: response.status, headers: response.headers });
  };
  const get = async (path: string, hops = 0): Promise<Response> => {
    const url = new URL(path, "https://example.test"), held = kept.get(url.pathname + url.search), age = held ? clock() - held.storedAt : Infinity;
    let response: Response;
    if (held && age < held.fresh) { runs.hits++; response = new Response(held.body as BodyInit, { status: held.status, headers: held.headers }); }
    else if (held && age < held.fresh + held.stale) { runs.hits++; response = new Response(held.body as BodyInit, { status: held.status, headers: held.headers }); await fetchOrigin(url); }
    else response = await fetchOrigin(url);
    const to = response.headers.get("location");
    if (response.status === 307 && to && hops < 3) return get(to, hops + 1);
    return response;
  };
  return { get, runs, purge: (tag: string) => { for (const [key, entry] of kept) if (entry.tags.includes(tag)) kept.delete(key); } };
}
