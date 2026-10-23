/**
 * pdf.js parses in this process (its "fake worker"). On a publisher file whose cross-reference table no longer
 * matches its bytes, the worker side rejects internal promises that nothing awaits, while the awaited API call
 * rejects as well and is handled by the caller. Node's default would end the whole job for those stray
 * rejections, so one damaged county PDF (Dallas's Election Day list, 2026-10-23) stopped every later Texas
 * source. This keeps Node's default for every other unhandled rejection and only records pdf.js's own.
 */

let installed = false;

/** A rejection pdf.js raised itself: one of its exception classes, built inside pdfjs-dist. */
export function isPdfjsInternalRejection(reason: unknown): reason is Error {
  return reason instanceof Error && /(?:Exception|FormatError)$/.test(reason.name) && /pdfjs-dist/.test(reason.stack ?? "");
}

/** Install once, before the first pdf.js read. */
export function guardPdfjsRejections(): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    if (isPdfjsInternalRejection(reason)) {
      console.error(JSON.stringify({ event: "pdfjs_internal_rejection", name: reason.name, detail: reason.message.slice(0, 200) }));
      return;
    }
    // Node's default when no other handler exists: the rejection becomes an uncaught exception.
    if (process.listenerCount("unhandledRejection") === 1) process.nextTick(() => { throw reason; });
  });
}
