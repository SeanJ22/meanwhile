import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);

/** Use HTTP content encoding so every JSON consumer sees the original value. */
export async function compressedJson(request: Request, value: unknown, init: ResponseInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
  const encodings = (request.headers.get("Accept-Encoding") ?? "").split(",").map(part => {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    const quality = parameters.map(parameter => /^\s*q\s*=\s*(\d(?:\.\d+)?)\s*$/.exec(parameter)).find(Boolean);
    return { name, quality: quality ? Number(quality[1]) : 1 };
  });
  const explicit = encodings.find(entry => entry.name === "gzip");
  const acceptable = (explicit ?? encodings.find(entry => entry.name === "*"))?.quality ?? 0;
  const json = JSON.stringify(value);
  if (acceptable <= 0) return new Response(json, { ...init, headers });
  const body = await compress(Buffer.from(json), { level: 9 });
  headers.set("Content-Encoding", "gzip");
  return new Response(new Uint8Array(body), { ...init, headers });
}
