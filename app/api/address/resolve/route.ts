import { readerRoute } from "@/lib/api/reader-route";
import { resolveAddressRequest } from "@/lib/geo/address-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Census host is fixed, so the platform fetch is used; late-bound so a test can stand in for it.
export const POST = readerRoute("/api/address/resolve", async function POST(request: Request) {
  return resolveAddressRequest(request, (input, init) => globalThis.fetch(input, init));
}, ["census-districts", "ballot-contests"]);
