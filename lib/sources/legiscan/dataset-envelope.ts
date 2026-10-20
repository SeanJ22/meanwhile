import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { object, type LegiscanSession } from "./dataset.ts";

const MARKER = "__streamed_legiscan_dataset_zip__";
const ARCHIVE_LIMIT = 256 * 1024 * 1024;
const METADATA_LIMIT = 1024 * 1024;

/** The exact API envelope is held by the source-file cache. Decode its large
 * JSON base64 string to disk while keeping only the small metadata envelope. */
export async function decodeLegiscanDatasetEnvelope(input: {
  path: string; archivePath: string; session: LegiscanSession; signal: AbortSignal;
}): Promise<void> {
  let metadata = "", token = "", base64 = "", escape = "";
  let mode: "TEXT" | "STRING" | "ZIP" = "TEXT", stringEscaped = false;
  let lastString: string | null = null, expectZip = false, zipFields = 0, archiveBytes = 0, padded = false;
  const invalid = () => { throw new Error("LEGISCAN_DATASET_RESPONSE_IDENTITY_INVALID"); };
  const appendMetadata = (value: string) => {
    metadata += value;
    if (metadata.length > METADATA_LIMIT) throw new Error("LEGISCAN_DATASET_METADATA_TOO_LARGE");
  };
  const decodeBase64 = () => {
    if (!base64.length || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("LEGISCAN_DATASET_BASE64_INVALID");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.toString("base64") !== base64) throw new Error("LEGISCAN_DATASET_BASE64_INVALID");
    archiveBytes += bytes.length;
    if (archiveBytes > ARCHIVE_LIMIT) throw new Error("LEGISCAN_DATASET_BASE64_INVALID");
    base64 = "";
    return bytes;
  };
  const zipCharacter = (character: string) => {
    if (!/^[A-Za-z0-9+/=]$/.test(character) || padded && character !== "=") throw new Error("LEGISCAN_DATASET_BASE64_INVALID");
    if (character === "=") padded = true;
    base64 += character;
  };
  async function* archive() {
    const source = createReadStream(input.path, { highWaterMark: 64 * 1024 }), decoder = new TextDecoder("utf-8", { fatal: true });
    for await (const chunk of source) {
      input.signal.throwIfAborted();
      for (const character of decoder.decode(chunk, { stream: true })) {
        if (mode === "ZIP") {
          if (escape) {
            escape += character;
            if (escape.length === 2 && character !== "u" || escape.length === 6) {
              let decoded: string;
              try { decoded = JSON.parse(`"${escape}"`) as string; } catch { throw new Error("LEGISCAN_DATASET_BASE64_INVALID"); }
              zipCharacter(decoded); escape = "";
            } else if (escape.length > 6) throw new Error("LEGISCAN_DATASET_BASE64_INVALID");
          } else if (character === "\\") escape = "\\";
          else if (character === '"') {
            if (base64.length) yield decodeBase64();
            if (!archiveBytes) throw new Error("LEGISCAN_DATASET_BASE64_INVALID");
            mode = "TEXT"; lastString = MARKER; expectZip = false;
          } else zipCharacter(character);
          if (base64.length >= 64 * 1024 && !padded) yield decodeBase64();
          continue;
        }
        if (mode === "STRING") {
          appendMetadata(character); token += character;
          if (stringEscaped) stringEscaped = false;
          else if (character === "\\") stringEscaped = true;
          else if (character === '"') {
            try { lastString = JSON.parse(token) as string; } catch { invalid(); }
            mode = "TEXT";
          }
          continue;
        }
        if (character === '"') {
          if (expectZip) {
            if (++zipFields !== 1) invalid();
            appendMetadata(JSON.stringify(MARKER)); mode = "ZIP";
          } else { appendMetadata(character); token = '"'; stringEscaped = false; mode = "STRING"; }
        } else {
          appendMetadata(character);
          if (character === ":") { expectZip = lastString === "zip"; lastString = null; }
          else if (!/\s/.test(character)) { expectZip = false; lastString = null; }
        }
      }
    }
    decoder.decode();
    if (mode !== "TEXT" || escape || zipFields !== 1) invalid();
  }
  await pipeline(archive(), createWriteStream(temporaryPath(input.archivePath), { flags: "wx" }));
  let payload: Record<string, unknown>;
  try { payload = object(JSON.parse(metadata)); } catch { invalid(); }
  const dataset = object(payload!.dataset), session = input.session;
  if (payload!.status !== "OK" || dataset.session_id !== session.sessionId || dataset.state_id !== session.stateId ||
      dataset.dataset_hash !== session.datasetHash || dataset.dataset_date !== session.datasetDate ||
      dataset.mime_type !== "application/zip" || dataset.zip !== MARKER) invalid();
}
