import { getElectionResults, postElectionResults } from "../../lib/election-results/feed-response.ts";
import { nativeResultFeedStore } from "../../lib/election-results/feed-store.ts";
import { isAdminHostRequest } from "../../lib/control-plane/admin-auth.ts";
import { ADMIN_ORIGIN } from "../../lib/ops/origins.ts";

interface ResultFunctionContext { readonly deploy?: { readonly context?: string } }

/** Serve prepared result blobs without starting Next, loading saved keys, or warming database connections. */
export default async function readerElectionResults(request: Request, context?: ResultFunctionContext): Promise<Response> {
  if (isAdminHostRequest(request.headers, ADMIN_ORIGIN))
    return new Response(null, { status: 404, headers: { "x-robots-tag": "noindex, nofollow, noarchive" } });
  const store = nativeResultFeedStore(context?.deploy?.context);
  const response = request.method === "GET" ? await getElectionResults(request, store)
    : request.method === "POST" ? await postElectionResults(request, store)
    : new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  response.headers.set("x-wtp-reader-runtime", "native");
  response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = { path: "/api/election-results", method: ["GET", "POST"] };
