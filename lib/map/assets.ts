import { storedKeyValue } from "../core/keys-values.ts";
import { PUBLIC_SITE_ORIGIN } from "../ops/origins.ts";

const PROVIDER = "https://api.maptiler.com/";
const PREFIX = "/api/maptiler";
const assetRoots = new Set(["maps", "tiles", "fonts", "resources"]);
const privateHeaders = { "cache-control": "no-store", "content-type": "application/json" };
const unavailable = () => new Response(JSON.stringify({ says: "Map files could not be loaded." }), { status: 503, headers: privateHeaders });

function localAssets(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value.map(item => localAssets(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, localAssets(item, key)]));
  if (typeof value !== "string") return value;
  let text = value;
  if (/^(?:(?:https?:)?\/\/api\.maptiler\.com\/|\/(?:maps|tiles|fonts|resources)\/)/i.test(value)) {
    const url = new URL(value, PROVIDER);
    if (url.hostname === "api.maptiler.com") {
      url.searchParams.delete("key");
      text = `${PREFIX}${url.pathname}${url.search}`.replace(/%7b/gi, "{").replace(/%7d/gi, "}");
    }
  }
  // A provider error or unexpected JSON field must not echo the saved credential.
  return text.split(key).join("[saved key]").split(encodeURIComponent(key)).join("[saved key]");
}

export async function readMapAsset(path: readonly string[], search: URLSearchParams, dependencies: {
  readonly readKey?: () => Promise<string | undefined>;
  readonly fetch?: typeof fetch;
} = {}): Promise<Response> {
  if (!assetRoots.has(path[0] ?? "") || path.length < 2 || path.length > 12 ||
      path.some(part => !part || part.length > 512 || part === "." || part === ".." || /[\\/\u0000-\u001f]/.test(part)) ||
      !/\.(?:json|pbf|png|jpe?g|webp|avif|svg)$/i.test(path.at(-1) ?? "")) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  try {
    const key = await (dependencies.readKey ?? (async () => storedKeyValue("NEXT_PUBLIC_MAPTILER_KEY")))();
    if (!key) return unavailable();
    const url = new URL(path.map(encodeURIComponent).join("/"), PROVIDER);
    url.search = search.toString();
    url.searchParams.set("key", key);
    const response = await (dependencies.fetch ?? fetch)(url, {
      redirect: "error", signal: AbortSignal.timeout(2_500),
      headers: { Origin: PUBLIC_SITE_ORIGIN, Referer: `${PUBLIC_SITE_ORIGIN}/` },
    });
    if (!response.ok) return unavailable();
    const type = response.headers.get("content-type") ?? "application/octet-stream";
    if (!/(?:json|image\/|protobuf|octet-stream|vector-tile)/i.test(type)) return unavailable();
    const headers = { "content-type": type, "cache-control": response.headers.get("cache-control") ?? "public, max-age=300",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };
    if (/json/i.test(type)) return Response.json(localAssets(await response.json(), key), { headers });
    if (/svg/i.test(type)) return new Response(String(localAssets(await response.text(), key)), { headers });
    return new Response(response.body, { headers });
  } catch { return unavailable(); }
}
