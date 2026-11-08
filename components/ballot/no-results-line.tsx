"use client";

import { useReaderCopy } from "@/hooks/use-reader-copy";
import { feedbackHref } from "@/lib/feedback/shape";

/** A card or tab without results: the reader copy plus the existing "get this sooner" request. */
export function NoResultsLine({ about }: { about: string }) {
  const readerCopy = useReaderCopy();
  return <span data-no-results="" className="rr-status">
    <span>{readerCopy("copy.working")}</span>{" "}
    <a className="rr-link" href={feedbackHref({ about, intent: "sooner" })}>Want us to get this sooner?</a>
  </span>;
}
