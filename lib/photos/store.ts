import { assertPublicUrl } from "../hunt/egress.ts";
import { acquireKnownRelease } from "../sources/known-release.ts";
import { normalizePortrait, PORTRAIT_ACCEPT, MAX_PORTRAIT_BYTES, PORTRAIT_DECODER_VERSION } from "./decode.ts";
import { portraitHash, verifyPortraitSources, type PortraitSources } from "./evidence.ts";
import type { PortraitKeyPrefix } from "./binding.ts";
import type { OfficeholderPhoto } from "../officials/types.ts";

export interface PortraitRuntime {
  readonly read: (url: string, signal?: AbortSignal) => Promise<Uint8Array | {bytes:Uint8Array;retrievedAt:string;contentType:string}>;
  readonly put: (key: string, bytes: Uint8Array) => Promise<void>;
}

const decodedBytes = new WeakMap<Uint8Array, Awaited<ReturnType<typeof normalizePortrait>>>();
export function createPortraitRuntime(acquire:typeof acquireKnownRelease = acquireKnownRelease): PortraitRuntime {
  return {
  read: async (url, signal) => {
    const requested = assertPublicUrl(url);
    if(requested.protocol === "http:") requested.protocol = "https:";
    const host=requested.hostname.replace(/^www\./,"");
    const held = await acquire({sourceId:"person-portrait",releaseId:url,url:requested.href,allowedHosts:[host,`www.${host}`],
      parserVersion:PORTRAIT_DECODER_VERSION,maxBytes:MAX_PORTRAIT_BYTES,checkAfterMs:7*86_400_000,
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      headers:{accept:PORTRAIT_ACCEPT},validate:async (bytes,release)=>{const decoded=await normalizePortrait(bytes);if(!decoded.verdict.ok)throw Error(`PORTRAIT_${decoded.verdict.reason}`);
        const declared=release.contentType.split(";")[0].trim().toLowerCase().replace(/^image\/(?:jpg|pjpeg)$/,"image/jpeg").replace(/^image\/x-png$/,"image/png");
        if(declared.startsWith("text/") || declared.startsWith("image/") && declared!==`image/${decoded.verdict.format}`)throw Error("PORTRAIT_CONTENT_TYPE_MISMATCH");
        decodedBytes.set(bytes,decoded);}});
    return {bytes:held.bytes,retrievedAt:held.retrievedAt,contentType:held.contentType};
  },
  put: async (key, bytes) => {
    const { getStore } = await import("@netlify/blobs");
    const siteID = process.env.WTP_BLOBS_SITE_ID, token = process.env.WTP_BLOBS_TOKEN;
    const store = getStore({name:"meanwhile-portraits",consistency:"strong",...(siteID && token ? {siteID,token} : {})});
    await store.set(key, new Uint8Array(bytes).buffer, {onlyIfNew:true});
  },
  };
}
const runtime=createPortraitRuntime();

/**
 * A resident-task screenshot goes in the same blob store under its own `resident-tasks/` prefix, which
 * the public portrait route never serves; only Admin's image route reads it.
 */
export async function storeRunScreenshot(key: string, bytes: Uint8Array, io: Pick<PortraitRuntime, "put"> = runtime): Promise<void> {
  if (!key.startsWith("resident-tasks/")) throw Error("SCREENSHOT_KEY_OUTSIDE_PREFIX");
  await io.put(key, bytes);
}

/** Reuse the existing portrait blob store and same-origin reader endpoint. */
export async function storeVerifiedPortrait(personId: string, sources: PortraitSources, now: string, io: PortraitRuntime = runtime,
  prefix: PortraitKeyPrefix = "officials", signal?: AbortSignal): Promise<OfficeholderPhoto> {
  const sourceCheck = verifyPortraitSources(personId, sources, now);
  signal?.throwIfAborted();
  const acquired = await io.read(sources.imageUrl, signal);
  signal?.throwIfAborted();
  const original = acquired instanceof Uint8Array ? acquired : acquired.bytes;
  const decoded = decodedBytes.get(original) ?? await normalizePortrait(original);
  if (!decoded.verdict.ok || !("bytes" in decoded)) throw Error(`PORTRAIT_${decoded.verdict.ok ? "NO_IMAGE_DATA" : decoded.verdict.reason}`);
  const bytes = decoded.bytes;
  const imageHash = portraitHash(bytes);
  const key = `${prefix}/${imageHash.slice(7)}.webp`;
  signal?.throwIfAborted();
  await io.put(key, bytes);
  return {url:`/api/portraits/${key}`,sourceUrl:sources.imageUrl,license:sourceCheck.license?.value ?? null,
    attribution:`Portrait: ${sourceCheck.attribution!.sourceUrl}`,collectedAt:acquired instanceof Uint8Array ? now : acquired.retrievedAt,
    verification:{...sourceCheck,imageHash,sourceImageHash:portraitHash(original),decoderVersion:PORTRAIT_DECODER_VERSION,
      width:decoded.verdict.width,height:decoded.verdict.height,imageRetrievedAt:acquired instanceof Uint8Array ? now : acquired.retrievedAt}};
}
