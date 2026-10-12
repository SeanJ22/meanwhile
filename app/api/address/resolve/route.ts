import { resolveAddressRequest } from "@/lib/geo/address-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return resolveAddressRequest(request);
}
