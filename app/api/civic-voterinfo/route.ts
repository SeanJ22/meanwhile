import { after } from "next/server";
import { readerCivicLookup, recordCivicReaderOutcome } from "@/lib/sources/google-civic/reader-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let address: string;
  try {
    const body = await request.json() as { address?: unknown };
    address = typeof body.address === "string" ? body.address.trim() : "";
  } catch { return Response.json({ error: "An address is required." }, { status: 400 }); }
  if (address.length < 3 || address.length > 200) return Response.json({ error: "An address is required." }, { status: 400 });
  const lookup = await readerCivicLookup(address);
  after(() => recordCivicReaderOutcome(lookup).catch(() => console.warn("Google Civic lookup door could not be recorded.")));
  return Response.json(lookup, { headers: { "cache-control": "no-store" } });
}
