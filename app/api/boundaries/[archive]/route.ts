import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { getStore } from "@netlify/blobs";
import { open } from "node:fs/promises";
import { BOUNDARY_CACHE_HEADERS, boundaryRange } from "@/lib/map/boundary-archive";

export async function GET(request: Request, context: { params: Promise<{ archive: string }> }): Promise<Response> {
  await loadWebsiteSavedKeys();
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

  // Reader assets belong to this Netlify site, never the runner's Blob store.
  // Netlify supplies its site credentials through the request's Blobs context.
  let upstream: Response | undefined;
  let phase = "context";
  try {
    const store = getStore({ name: "map-tiles",
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        // Without an edge URL the SDK first obtains a signed URL as JSON.
        // That control request must remain a normal 200, without a Range.
        if (headers.get("accept") === "application/json;type=signed-url") {
          phase = "lookup";
          return fetch(input, init);
        }
        phase = "range";
        headers.set("Range", `bytes=${range.start}-${range.end}`);
        const response = await fetch(input, { ...init, headers });
        upstream = response;
        // Never silently download the national archive to slice it in a function.
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
        if (response.status === 206 && match && Number(match[1]) === range.start
          && Number(match[2]) === Math.min(range.end, Number(match[3]) - 1)) {
          // Store.get accepts only 200. Adapt its internal response after
          // validating the actual upstream 206; the browser still receives 206.
          return new Response(response.body, { status: 200, headers: response.headers });
        }
        if (response.ok) {
          await response.body?.cancel();
          // A non-retryable SDK error avoids five repeated whole-file requests.
          return new Response(null, { status: 400 });
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
  } catch (error) {
    // No URLs, tokens, or provider response bodies in logs.
    console.error("[boundaries] archive read failed", {
      archive, phase, status: upstream?.status,
      error: error instanceof Error ? error.name : "UnknownError",
      siteID: process.env.SITE_ID ?? null,
    });
    return new Response("Boundary tiles are temporarily unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
