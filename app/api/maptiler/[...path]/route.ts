import { loadWebsiteSavedKeys } from "@/lib/core/keys-entry.ts";
import { readMapAsset } from "@/lib/map/assets.ts";
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  await loadWebsiteSavedKeys();
  return readMapAsset((await params).path, new URL(request.url).searchParams);
}
