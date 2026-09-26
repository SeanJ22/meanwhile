/** The existing Ask engine, without booting the unrelated Next page server.
 * No alternative acquisition, interpretation, validation or publication path. */
import { randomUUID } from "node:crypto";
import { POST } from "../../app/api/ask/grounded/route.ts";
import { withResponseLifetime } from "../../lib/log/after-response.ts";

const instance = randomUUID();
let requests = 0;

const groundedAsk = async (request: Request, context: { waitUntil(work: Promise<unknown>): void }): Promise<Response> => {
  const ordinal = ++requests;
  const response = await withResponseLifetime(work => context.waitUntil(work), () => POST(request));
  response.headers.set("x-wtp-ask-instance", instance);
  response.headers.set("x-wtp-ask-instance-request", String(ordinal));
  return response;
};
export default groundedAsk;

export const config = { path: "/api/ask/grounded", method: "POST" };
