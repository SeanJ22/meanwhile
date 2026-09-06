"use client";

import { useEffect, useState } from "react";
import type { softwareReleaseManifest } from "@/lib/review/release-manifest";

type Manifest = ReturnType<typeof softwareReleaseManifest>;

/** Displays the actual endpoint response, rather than a second manifest calculation. */
export function ManifestReview() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/release-manifest", { cache: "no-store", signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error("Manifest unavailable");
        return response.json() as Promise<Manifest>;
      })
      .then(setManifest)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  if (failed) return <p role="alert">The live software manifest could not be read. Reload to retry.</p>;
  if (!manifest) return <p role="status">Reading the live software manifest…</p>;
  return (
    <section aria-label="Live release manifest">
      <p>Visual review: <strong>{manifest.reviewState}</strong></p>
      <p>Staging boundary: <strong>{manifest.stagingBoundary}</strong></p>
      <ol>{manifest.reviewSections.map(section => <li key={section.id}><a href={section.url}>{section.name}</a></li>)}</ol>
      <p>Lumen popup family</p>
      <ul>{manifest.lumen.examples.map(example => <li key={example.id}>{example.name}: <a href={example.dark}>Dark</a> · <a href={example.light}>Light</a></li>)}</ul>
      <p>Raised state: {manifest.raisedState.status}</p>
      <ul>{manifest.raisedState.candidates.map(candidate => <li key={candidate.id}><a href={candidate.url}>{candidate.label}</a> — Arizona <a href={candidate.arizona.dark}>dark</a> / <a href={candidate.arizona.light}>light</a>; New Jersey <a href={candidate.newJersey.dark}>dark</a> / <a href={candidate.newJersey.light}>light</a></li>)}</ul>
      <details open>
        <summary>Exact live software manifest</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }} data-release-manifest>{JSON.stringify(manifest, null, 2)}</pre>
      </details>
    </section>
  );
}
