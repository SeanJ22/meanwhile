import { servePlaceIndexPointer } from "@/lib/reader/place-files-serve";

export const runtime = "nodejs";

/** The pointer of a state, the only file that moves: `/api/reader/index/<ST>.json`. */
export async function GET(_request: Request, context: { params: Promise<{ state: string }> }): Promise<Response> {
  return servePlaceIndexPointer((await context.params).state.replace(/\.json$/, "").toUpperCase());
}
