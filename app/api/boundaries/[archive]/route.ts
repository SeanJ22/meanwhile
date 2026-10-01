import { getStore } from "@netlify/blobs";
import { open } from "node:fs/promises";
import { BOUNDARY_CACHE_HEADERS, boundaryRange } from "@/lib/map/boundary-archive";

export async function GET(request: Request, context: { params: Promise<{ archive: string }> }): Promise<Response> {
  const { archive } = await context.params;
  if (!/^census-\d{4}-[a-z0-9-]+\.pmtiles$/.test(archive)) return new Response(null, { status: 404 });
  const range = boundaryRange(request.headers.get("range"));
  if (!range) return new Response("A single explicit byte range is required.", { status: 416 });

  // Local staging uses the same one-file read contract without uploading a dev copy.
  if (process.env.NODE_ENV !== "production" && process.env.BOUNDARY_PMTILES_FILE) {
    const file = await open(process.env.BOUNDARY_PMTILES_FILE, "r");
    try {
      const { size } = await file.stat();
      if (range.start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      const end = Math.min(range.end, size - 1);
      const bytes = new Uint8Array(end - range.start + 1);
      await file.read(bytes, 0, bytes.length, range.start);
      return new Response(bytes, { status: 206, headers: { ...BOUNDARY_CACHE_HEADERS,
        "Content-Length": String(bytes.length), "Content-Range": `bytes ${range.start}-${end}/${size}` } });
    } finally { await file.close(); }
  }

  const siteID = process.env.WTP_BLOBS_SITE_ID, token = process.env.WTP_BLOBS_TOKEN;
  let upstream: Response | undefined;
  try {
    const store = getStore({ name: "map-tiles", ...(siteID && token ? { siteID, token } : {}),
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Range", `bytes=${range.start}-${range.end}`);
        const response = await fetch(input, { ...init, headers });
        upstream = response;
        // Never silently download the national archive to slice it in a function.
        if (response.ok && response.status !== 206) {
          await response.body?.cancel();
          throw new Error("Boundary storage did not honor Range");
        }
        return response;
      },
    });
    const body = await store.get(archive, { type: "stream" });
    if (!body || !upstream) return new Response(null, { status: 404 });
    const headers = new Headers(BOUNDARY_CACHE_HEADERS);
    for (const name of ["Content-Range", "Content-Length", "ETag"]) {
      const value = upstream.headers.get(name); if (value) headers.set(name, value);
    }
    return new Response(body, { status: 206, headers });
  } catch {
    return new Response("Boundary tiles are temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
