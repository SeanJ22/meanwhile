"use client";

import { readerText, type ReaderTextMode } from "@/lib/text/reader-names";
import { useReaderNames } from "./reader-names-context";

/** A sentence rendered with the held people, places and bodies in its card. */
export function ReaderText({ text, mode = "sentence", names = [] }: { text: string; mode?: ReaderTextMode; names?: readonly string[] }) {
  const inherited = useReaderNames();
  return readerText(text, mode, [...inherited, ...names]);
}
