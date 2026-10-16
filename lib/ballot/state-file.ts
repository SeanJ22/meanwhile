import { createReadStream } from "node:fs";
import type { GenericBallotProjection } from "./generic-projection.ts";
import type { ManualSourceSetReceipt } from "../civic-data/types.ts";

interface BallotStateFile {
  readonly ballots: GenericBallotProjection["ballots"];
  readonly sourceReceipt: ManualSourceSetReceipt;
}

type BallotFileRow = (path: readonly string[], row: unknown) => void;

export async function readBallotStateFile(file: string, onRow?: BallotFileRow): Promise<BallotStateFile> {
  type Frame = { value: Record<string, unknown> | unknown[]; path: string[]; phase: string; key: string; index: number; stream: boolean };
  const frames: Frame[] = [];
  let root: unknown, done = false, token = "", quoted = false, escaped = false;
  const invalid = () => { throw new SyntaxError("Invalid ballot state JSON."); };
  const expectsValue = () => !frames.length ? !done : ["first", "value"].includes(frames.at(-1)!.phase);
  const valuePath = () => {
    const parent = frames.at(-1);
    return parent ? [...parent.path, Array.isArray(parent.value) ? String(parent.index) : parent.key] : [];
  };
  const accept = (value: unknown) => {
    const parent = frames.at(-1);
    if (!parent) { if (done) invalid(); root = value; done = true; return; }
    if (parent.phase === "key" || parent.phase === "first-key") {
      if (typeof value !== "string") invalid();
      parent.key = value as string; parent.phase = "colon"; return;
    }
    if (!expectsValue()) invalid();
    if (Array.isArray(parent.value)) {
      if (parent.stream) onRow?.(parent.path, value);
      else parent.value.push(value);
      parent.index++;
    } else Object.defineProperty(parent.value, parent.key, { value, enumerable: true, configurable: true, writable: true });
    parent.phase = "comma";
  };
  for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
    for (const char of chunk) {
      if (quoted) {
        token += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') { quoted = false; accept(JSON.parse(token)); token = ""; }
        continue;
      }
      if (token && /[\s,\]}:]/.test(char)) { accept(JSON.parse(token)); token = ""; }
      if (/\s/.test(char)) continue;
      const frame = frames.at(-1);
      if (char === '"') {
        if (token || !(expectsValue() || frame?.phase === "key" || frame?.phase === "first-key")) invalid();
        token = char; quoted = true;
      } else if (char === "{" || char === "[") {
        if (token || !expectsValue()) invalid();
        const path = valuePath();
        frames.push({ value: char === "[" ? [] : {}, path, phase: char === "[" ? "first" : "first-key", key: "", index: 0,
          stream: char === "[" && path[0] === "ballots" && (path.length === 3 || path.length === 4 &&
            ["generalLineup", "measureAnalyses", "lineupReconciliation"].includes(path[2])) });
      } else if (char === "}" || char === "]") {
        if (!frame || (char === "]") !== Array.isArray(frame.value) || !["first", "first-key", "comma"].includes(frame.phase)) invalid();
        frames.pop(); accept(frame!.value);
      } else if (char === ":") {
        if (frame?.phase !== "colon") invalid();
        frame!.phase = "value";
      } else if (char === ",") {
        if (frame?.phase !== "comma") invalid();
        frame!.phase = Array.isArray(frame!.value) ? "value" : "key";
      } else {
        if (!expectsValue()) invalid();
        token += char;
      }
    }
  }
  if (token && !quoted) accept(JSON.parse(token));
  if (quoted || frames.length || !done || !root || typeof root !== "object") invalid();
  return root as BallotStateFile;
}
