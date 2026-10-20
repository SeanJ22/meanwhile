import { createReadStream } from "node:fs";
import { temporaryPath } from "../civic-data/temporary-path.ts";
import { CHAMBER_DIRECTORY_URLS, parseChamberDirectory, type ChamberCapture } from "./chamber-directory.ts";

/** Read one XML member at a time; only the selected state's authoritative
 * contacts, occupied seats and explicit vacancies remain in the projection. */
export async function readChamberDirectoryFile(input: {
  readonly path: string; readonly finalUrl: string; readonly retrievedAt: string; readonly signal?: AbortSignal;
}, state: string): Promise<ChamberCapture | null> {
  const root = input.finalUrl === CHAMBER_DIRECTORY_URLS.house ? "MemberData"
    : input.finalUrl === CHAMBER_DIRECTORY_URLS.senate ? "contact_information" : null;
  if (!root) throw new Error("CHAMBER_DIRECTORY_SOURCE_INVALID");
  const decoder = new TextDecoder("utf-8", { fatal: true }), selected: string[] = [];
  let buffer = "", tail = "", inside = false, opened = false, closed = false, members = 0;
  const consume = (chunk: string) => {
    const edges = tail + chunk;
    opened ||= new RegExp(`<${root}(?:\\s[^>]*)?>`).test(edges);
    closed ||= edges.includes(`</${root}>`);
    tail = edges.slice(-128);
    buffer += chunk;
    for (;;) {
      if (!inside) {
        const start = buffer.search(/<member(?=\s|>)/);
        if (start < 0) { buffer = buffer.slice(-16); return; }
        buffer = buffer.slice(start); inside = true;
      }
      const end = buffer.indexOf("</member>");
      if (end < 0) return;
      const member = buffer.slice(0, end + 9);
      if ((member.match(/<member(?=\s|>)/g) ?? []).length !== 1) throw new Error("CHAMBER_DIRECTORY_XML_INVALID");
      const parsed = parseChamberDirectory({ finalUrl: input.finalUrl, retrievedAt: input.retrievedAt,
        body: `<${root}>${member}</${root}>` }, state);
      if (parsed.offices.size || parsed.vacancies.length || parsed.occupied.size) selected.push(member);
      members++; buffer = buffer.slice(end + 9); inside = false;
    }
  };
  for await (const chunk of createReadStream(temporaryPath(input.path), { highWaterMark: 64 * 1024 })) {
    input.signal?.throwIfAborted(); consume(decoder.decode(chunk, { stream: true }));
  }
  consume(decoder.decode());
  if (!opened || !closed || inside) throw new Error("CHAMBER_DIRECTORY_XML_INVALID");
  if (!members) throw new Error("CHAMBER_DIRECTORY_MEMBERS_MISSING");
  return selected.length ? { finalUrl: input.finalUrl, retrievedAt: input.retrievedAt, body: `<${root}>${selected.join("")}</${root}>` } : null;
}
