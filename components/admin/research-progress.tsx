import type { ResearchProgressHealth } from "@/lib/control-plane/research-progress-health.ts";

/** Small server-rendered projection. Never ships the full research state to the browser. */
export function ResearchProgress({ reading }: { readonly reading: ResearchProgressHealth }) {
  return (
    <section className={`card l-${reading.level}`} aria-labelledby="research-progress-heading">
      <h2 id="research-progress-heading">Research progress — {reading.state.toLowerCase()}</h2>
      <p>{reading.detail}</p>
      <dl>
        <dt>Worker activity</dt><dd>{reading.dispatch}</dd>
        <dt>Why work waits</dt><dd>{reading.deferrals}</dd>
        <dt>Stage advancement</dt><dd>{reading.advancement}</dd>
        <dt>Research acquisition</dt><dd>{reading.acquisition}</dd>
        <dt>Research publication</dt><dd>{reading.publication}</dd>
        <dt>Model spending</dt><dd>{reading.spend}</dd>
      </dl>
      <p><a href="/admin/sources">Routine source acquisition and publication</a> shows source refreshes, validated production versions, and Reader readback separately.</p>
      <p className="note">{reading.asOf ? <>Dispatch observation: <time dateTime={reading.asOf}>{reading.asOf}</time>.</> : "No current observation."}
        {reading.window && <> Research evidence window: <time dateTime={reading.window.since}>{reading.window.since}</time> to <time dateTime={reading.window.through}>{reading.window.through}</time>.</>}
      </p>
    </section>
  );
}
