import { serveZip3 } from "@/lib/reader/answer-serve";

export const runtime = "nodejs";

/** The ZIPs of a three digit prefix: `/api/reader/zip3/<NNN>.json`. */
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }): Promise<Response> {
  return serveZip3((await context.params).name.replace(/\.json$/, ""));
}
