import { serveAnswer } from "@/lib/reader/answer-serve";

export const runtime = "nodejs";

/** A ZIP's answer at the address of what it is made from: `/api/answer/<zip>/<key>`. */
export async function GET(request: Request, context: { params: Promise<{ zip: string; key: string }> }): Promise<Response> {
  const { zip, key } = await context.params;
  return serveAnswer(request, zip, key);
}
