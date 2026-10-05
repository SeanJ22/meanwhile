import { assertPublicUrl } from "../hunt/egress.ts";
import { politeGetBytes } from "../sources/http.ts";
import { decodeImage, PORTRAIT_ACCEPT } from "./decode.ts";
import { portraitHash, verifyPortraitSources, type PortraitSources } from "./evidence.ts";
import type { OfficeholderPhoto } from "../officials/types.ts";

export interface PortraitRuntime {
  readonly read: (url: string) => Promise<Uint8Array>;
  readonly put: (key: string, bytes: Uint8Array) => Promise<void>;
}

const runtime: PortraitRuntime = {
  read: async url => (await politeGetBytes(assertPublicUrl(url).href, {accept:PORTRAIT_ACCEPT,signal:AbortSignal.timeout(30_000)})).bytes,
  put: async (key, bytes) => {
    const { getStore } = await import("@netlify/blobs");
    const siteID = process.env.WTP_BLOBS_SITE_ID, token = process.env.WTP_BLOBS_TOKEN;
    const store = getStore({name:"meanwhile-portraits",consistency:"strong",...(siteID && token ? {siteID,token} : {})});
    await store.set(key, new Uint8Array(bytes).buffer, {onlyIfNew:true});
  },
};

/** Reuse the existing portrait blob store and same-origin reader endpoint. */
export async function storeVerifiedPortrait(name: string, sources: PortraitSources, now: string, io: PortraitRuntime = runtime): Promise<OfficeholderPhoto> {
  const sourceCheck = verifyPortraitSources(name, sources, now);
  const original = await io.read(sources.imageUrl);
  const decoded = decodeImage(original);
  if (!decoded.ok) throw Error(`PORTRAIT_${decoded.reason}`);
  const bytes = original;
  const imageHash = portraitHash(bytes);
  const key = `officials/${imageHash.slice(7)}.${decoded.format === "jpeg" ? "jpg" : decoded.format}`;
  await io.put(key, bytes);
  return {url:`/api/portraits/${key}`,sourceUrl:sources.imageUrl,license:sourceCheck.license?.value ?? null,
    attribution:`Portrait: ${sourceCheck.attribution!.sourceUrl}`,collectedAt:now,verification:{...sourceCheck,imageHash,sourceImageHash:portraitHash(original)}};
}
