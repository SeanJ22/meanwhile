import { servePlaceFile } from "@/lib/reader/place-files-serve";

export const runtime = "nodejs";

/** A place's file, or a state's index, by the hash that names it: `/api/reader/files/<hash>.json`. */
export async function GET(request: Request, context: { params: Promise<{ name: string }> }): Promise<Response> {
  return servePlaceFile(request, (await context.params).name.replace(/\.json$/, ""));
}
