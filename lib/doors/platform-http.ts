import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FLEET_SAFETY_BOUNDS } from "../control-plane/fleet-safety.ts";
import { assertPublicUrl } from "../hunt/egress.ts";

const execute = promisify(execFile);
const running = new Set<number>();
/** Measurement observes the public HTTP children as part of the worker's resident memory. */
export const platformHttpProcessIds = () => [...running];

/** Public platform responses, without Node's failing HTTP-parser cancellation path. The existing fleet download bound still applies. */
export const platformFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assertPublicUrl(url);
  const args = ["--silent", "--show-error", "--http1.1", "--suppress-connect-headers", "--include", "--compressed",
    "--max-time", "30", "--request", init?.method ?? "GET"];
  for (const [key, value] of new Headers(init?.headers)) args.push("--header", `${key}: ${value}`);
  if (init?.body !== undefined && init.body !== null) args.push("--data-binary", "@-");
  args.push("--url", url);
  const result = execute("curl", args, { encoding: "buffer", maxBuffer: FLEET_SAFETY_BOUNDS.maxDownloadBytes + 64 * 1024,
    signal: init?.signal ?? undefined, windowsHide: true });
  if (result.child.pid) running.add(result.child.pid);
  result.child.stdin?.end(typeof init?.body === "string" ? init.body : init?.body instanceof Uint8Array ? init.body : undefined);
  const { stdout } = await result.catch(error => { throw new Error(`Platform HTTP read failed (${init?.signal?.aborted ? "request timed out" : `curl exit ${error.code ?? "unknown"}`})`); })
    .finally(() => { if (result.child.pid) running.delete(result.child.pid); });
  const response = platformHttpResponse(stdout);
  Object.defineProperty(response, "url", { value: url });
  return response;
};

/** Curl emits the HTTP headers before the exact response body; interim 1xx headers do not belong to the document. */
export function platformHttpResponse(bytes: Uint8Array): Response {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let start = 0;
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n", start);
    if (end < 0) throw new Error("The platform returned no complete HTTP headers");
    const [line, ...fields] = buffer.subarray(start, end).toString("utf8").split("\r\n");
    const status = Number(/^HTTP\/\S+\s+(\d{3})\b/.exec(line)?.[1]);
    if (!status) throw new Error("The platform returned an unreadable HTTP status");
    start = end + 4;
    if (status < 200) continue;
    const headers = new Headers();
    for (const field of fields) { const colon = field.indexOf(":"); if (colon > 0) headers.append(field.slice(0, colon), field.slice(colon + 1).trim()); }
    // Curl has decoded the wire representation, as fetch does; callers receive the document bytes.
    headers.delete("content-encoding"); headers.delete("content-length"); headers.delete("transfer-encoding");
    return new Response(status === 204 || status === 304 ? null : new Uint8Array(buffer.subarray(start)), { status, headers });
  }
}
