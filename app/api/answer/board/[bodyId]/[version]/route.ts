import { serveBoard } from "@/lib/reader/answer-serve";

export const runtime = "nodejs";

/** What a ZIP's answer leaves with a board, at the version of the board's file: `/api/answer/board/<bodyId>/<fileVersion>`. */
export async function GET(request: Request, context: { params: Promise<{ bodyId: string; version: string }> }): Promise<Response> {
  const { bodyId, version } = await context.params;
  return serveBoard(request, decodeURIComponent(bodyId), version);
}
