import { closeSync, openSync, writeSync } from "node:fs";
import { DiskRows } from "./disk-rows.ts";

/** JSON arrays from repeatable disk views are written one member at a time. */
export function* streamedJson(value: unknown): Generator<string> {
  if (value instanceof DiskRows || Array.isArray(value)) {
    yield "[";
    let first = true;
    for (const row of value) {
      if (!first) yield ",";
      first = false;
      yield* streamedJson(row);
    }
    yield "]";
  } else if (value !== null && typeof value === "object") {
    if ("toJSON" in value && typeof value.toJSON === "function") {
      yield* streamedJson(value.toJSON());
      return;
    }
    yield "{";
    let first = true;
    for (const [key, row] of Object.entries(value)) {
      if (row === undefined || typeof row === "function" || typeof row === "symbol") continue;
      if (!first) yield ",";
      first = false;
      yield JSON.stringify(key) + ":";
      yield* streamedJson(row);
    }
    yield "}";
  } else {
    yield JSON.stringify(value) ?? "null";
  }
}

export function writeStreamedJsonSync(path: string, value: unknown): void {
  const fd = openSync(path, "w");
  try {
    let buffer = "";
    for (const part of streamedJson(value)) {
      buffer += part;
      if (buffer.length >= 32_768) { writeSync(fd, buffer); buffer = ""; }
    }
    writeSync(fd, buffer + "\n");
  } finally { closeSync(fd); }
}
