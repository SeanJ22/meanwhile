"use client";

import { Card } from "@/components/ui/card";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapsContribution } from "@/components/ui/card-gap-context";
import type { CardGap } from "@/lib/design/card-gaps";
import { feedbackHref } from "@/lib/feedback/shape";
import { useReaderCopy } from "@/hooks/use-reader-copy";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";

import { PLACEHOLDER_ADDRESS } from "@/lib/ballot/placeholder-address";
import {
  directionsUrl,
  isPinnable,
  type VotingSite,
  type VotingSitesAnswer,
  milesLabel,
  votingSitesForDisplay,
  type VotingJurisdiction,
  type VotingSource,
} from "@/lib/ballot/voting-sites";

/**
 * Where can I vote? The address goes to `/api/voting-sites`; the sites drop on
 * the map as pins and list here with the sentence naming the jurisdiction's
 * voting model. The only link out is a site's directions handoff.
 */

export interface VotingSitesPanelProps {
  /** Lift the pinnable sites so the map can draw them. */
  onSites: (sites: { id: string; name: string; lat: number; lng: number }[]) => void;
  /** Lift the resolved point (never the address) so the map can draw the ten-mile ring. */
  onAddressPoint?: (point: { lat: number; lng: number } | null) => void;
  /** Which pin is selected, so the list can scroll it into view. */
  selectedSiteId: string | null;
  onSelectSite: (id: string | null) => void;
  onClose: () => void;
  /** Inside the design popup, which owns the title and the close control. */
  embedded?: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "failed" }
  | { kind: "answered"; answer: VotingSitesAnswer };

export function VotingSitesPanel({
  onSites,
  onAddressPoint,
  selectedSiteId,
  onSelectSite,
  onClose,
  embedded = false,
}: VotingSitesPanelProps) {
  const readerCopy = useReaderCopy();
  const [address, setAddress] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const pendingRequest = useRef<AbortController | null>(null);
  const inputId = useId();
  const onSitesRef = useRef(onSites);
  useEffect(() => {
    onSitesRef.current = onSites;
  }, [onSites]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const value = address.trim();
      if (value.length < 3) return;
      pendingRequest.current?.abort();
      const controller = new AbortController();
      pendingRequest.current = controller;
      setState({ kind: "asking" });
      try {
        const res = await fetch("/api/voting-sites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: value }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setState({ kind: "failed" });
          return;
        }
        const answer = (await res.json()) as VotingSitesAnswer;
        if (controller.signal.aborted) return;
        setState({ kind: "answered", answer });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "failed" });
      }
    },
    [address],
  );

  // Lift the pins on each answer and clear them on unmount.
  useEffect(() => {
    if (state.kind !== "answered") {
      onSitesRef.current([]);
      return;
    }
    onSitesRef.current(
      state.answer.jurisdictions
        .flatMap((j) => j.sites)
        .filter(isPinnable)
        .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    );
  }, [state]);

  // The ring appears with an answer and clears when the panel closes.
  useEffect(() => {
    onAddressPoint?.(state.kind === "answered" ? state.answer.point : null);
  }, [state, onAddressPoint]);

  useEffect(() => () => onAddressPoint?.(null), [onAddressPoint]);

  useEffect(() => () => onSitesRef.current([]), []);
  useEffect(() => () => pendingRequest.current?.abort(), []);

  return (
    <section
      className={embedded ? "voting-panel mw-voting-panel" : "voting-panel"}
      role={embedded ? undefined : "dialog"}
      aria-label={embedded ? undefined : "Where can I vote"}
      aria-modal={embedded ? undefined : "false"}
    >
      <Card title="Where can I vote?" titleVisible={!embedded} onClose={embedded ? undefined : onClose} sources={[]} className={embedded ? "[&>.reader-card-header]:sr-only [&>.reader-card-body]:p-0" : undefined}>

      <form onSubmit={submit} className="voting-panel-form">
        <label htmlFor={inputId} className="voting-panel-label">
          Your street address or ZIP
        </label>
        <input
          id={inputId}
          className="voting-panel-input"
          value={address}
          onChange={(e) => { pendingRequest.current?.abort(); setAddress(e.target.value); setState({ kind: "idle" }); }}
          maxLength={200}
          placeholder={PLACEHOLDER_ADDRESS}
          // The design popup opens with the cursor in the address field.
          autoFocus={embedded}
          autoComplete="off"
          inputMode="text"
        />
        <button type="submit" className="voting-panel-submit">
          Show me
        </button>
      </form>

      {state.kind === "asking" && (
        <p className="voting-panel-status">Looking&hellip;</p>
      )}

      {state.kind === "failed" && (
        <p className="voting-panel-status">
          Something went wrong on our end. Try again.
        </p>
      )}

      {state.kind === "answered" && !state.answer.match && !state.answer.outsideCoverage && (
        <p className="voting-panel-status">
          We could not turn that into a location. Try including the town and
          state.
        </p>
      )}

      {state.kind === "answered" &&
        state.answer.outsideCoverage && (
          <div className="voting-panel-status" data-voting-coverage-gap>
            <p>{readerCopy("copy.working")}.</p>
            <a href={feedbackHref({ about: "Voting locations", zip: /^\d{5}$/.test(address.trim()) ? address.trim() : null })}>
              Want us to get this sooner?
            </a>
          </div>
        )}

      {state.kind === "answered" && <VotingJurisdictionRecords answer={state.answer} selectedSiteId={selectedSiteId} onSelectSite={onSelectSite} />}
      </Card>
    </section>
  );
}


/** The actual answered jurisdiction/site body shared by both panel entry paths. */
export function VotingJurisdictionRecords({ answer, selectedSiteId, onSelectSite }: { answer: VotingSitesAnswer; selectedSiteId: string | null; onSelectSite: (id: string | null) => void }) {
  const gaps = useMemo(() => votingAnswerGaps(answer), [answer]);
  return <>
      <CardGapsContribution id="voting-answer" gaps={gaps} />
      {answer.jurisdictions.map((j) => (
          <article key={j.ocdId} className="voting-jurisdiction" data-voting-jurisdiction={j.ocdId}>
            <h3 className="voting-jurisdiction-name">{j.name}</h3>
            <p className="voting-model">{j.modelSentence}</p>
            {/* Which site is yours, or the refusal with its rungs; never a best guess. */}
            <p
              className="voting-narrowing"
              data-kind={j.narrowing.kind.toLowerCase()}
            >
              {j.narrowing.sentence}
            </p>
            {j.narrowing.kind === "REFUSED" && j.narrowing.rungs.length > 0 && (
              <details className="voting-narrowing-rungs">
                <summary>What we tried</summary>
                <ol className="voting-rungs">
                  {j.narrowing.rungs.map((r, i) => (
                    <li key={`${r.rung}-${i}`}>
                      <span className="voting-rung-what">{r.what}</span>
                      <span className="voting-rung-result">{r.result}</span>
                      <span className="voting-rung-when">{r.attemptedAt}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {j.publication?.status === "POSTED_LATER" && <p className="voting-panel-status">{j.publication.text}</p>}
            {j.rules?.map((rule, index) => <p className="voting-rule" key={`${rule.source.url}-${index}`}>{rule.text}</p>)}
            {j.office && <div className="voting-office">
              <h4>Local election office: {j.office.name}</h4>
              {j.office.phone && <p>Phone: <a href={`tel:${j.office.phone.replace(/[^+\d]/g, "")}`}>{j.office.phone}</a></p>}
              {j.office.email && <p>Email: <a href={`mailto:${j.office.email}`}>{j.office.email}</a></p>}
              {j.office.address && <p>{j.office.address}</p>}
            </div>}
            {j.election && j.publication?.status !== "NO_GENERAL_ELECTION" && (
              <p className="voting-election">
                Published for the {j.election}.
              </p>
            )}

            {j.refusal && (
              <div className="voting-refusal">
                <p>{j.refusalLine}</p>
                <p className="voting-refusal-wall">{j.refusal.wall}</p>
                <details>
                  <summary>What we tried</summary>
                  <ol className="voting-rungs">
                    {j.refusal.rungs.map((r, i) => (
                      <li key={`${r.rung}-${i}`}>
                        <span className="voting-rung-what">{r.what}</span>
                        <span className="voting-rung-result">{r.result}</span>
                        <span className="voting-rung-when">{r.attemptedAt}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            )}

            {/* Nearest first, a sort and never a filter: every site in the county stays. */}
            {j.sites.length > 0 && (
              <ul className="voting-sites">
                {votingSitesForDisplay(j, answer.point).map(({ site, miles }) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    checkedAt={j.collectedAt}
                    miles={miles}
                    selected={site.id === selectedSiteId}
                    onSelect={() =>
                      onSelectSite(site.id === selectedSiteId ? null : site.id)
                    }
                  />
                ))}
              </ul>
            )}

            <CardSourcesContribution id={`voting-sites:${j.name}`} sources={votingSources(j)} />
          </article>
        ))}
  </>;
}

/** One contribution per answer avoids a separate card update for every missing site field. */
function votingAnswerGaps(answer: VotingSitesAnswer): CardGap[] {
  if (answer.outsideCoverage) return [];
  const gaps = new Map<string, CardGap>();
  const add = (gap: CardGap) => {
    const key = `${gap.kind ?? "not-held"}:${gap.label}:${gap.unit ?? ""}`;
    const prior = gaps.get(key);
    gaps.set(key, prior ? { ...prior, count: (prior.count ?? 1) + (gap.count ?? 1) } : gap);
  };
  for (const j of answer.jurisdictions) {
    if (answer.precision === "ADDRESS" && j.narrowing.kind === "REFUSED")
      add({ id: `voting-precinct:${j.ocdId}`, label: "your Election Day polling place" });
    for (const blank of j.blanks ?? []) add({ id: `voting-owed:${blank.id}`, label: blank.owed });
    const electionLabel = j.electionDate && /^\d{4}-\d{2}-\d{2}$/.test(j.electionDate)
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${j.electionDate}T12:00:00Z`)) : "Upcoming";
    for (const site of j.sites) {
      if (!site.hours && !site.schedules?.some(schedule => schedule.hours))
        add({ id: `voting-hours:${site.id}`, label: "hours", unit: "voting location" });
      if (site.election === null && !site.electionDate)
        add({ id: `voting-election:${site.id}`, label: "election dates", unit: "voting location" });
      if (!site.electionDate || j.electionDate && site.electionDate !== j.electionDate)
        add({ id: `voting-confirmation:${site.id}`, label: `${electionLabel} election confirmation`, unit: "voting location" });
      if (!isPinnable(site)) add({ id: `voting-map:${site.id}`, label: "map locations", unit: "voting location" });
    }
  }
  return [...gaps.values()];
}

const KIND_LABEL: Record<VotingSite["kind"], string> = {
  ELECTION_DAY: "Election-day polling place",
  EARLY_VOTING: "Early voting",
  MOBILE: "Mobile voting site",
  DROP_BOX: "Ballot drop box",
  VOTE_CENTER: "Vote center",
  SATELLITE: "Satellite election office",
};

function SiteRow({
  site,
  checkedAt,
  miles,
  selected,
  onSelect,
}: {
  site: VotingSite;
  checkedAt: string;
  /** Miles from the address the reader typed, or null if unplaceable. */
  miles: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const lastChecked = site.sources?.flatMap(source => source.checkedAt ? [source.checkedAt] : []).sort().at(-1) ?? checkedAt;
  return (
    <li className="voting-site" data-selected={selected} data-voting-site={site.id} data-aiannh={site.aiannhGeoid}>
      <button type="button" className="voting-site-head" onClick={onSelect}>
        <MapPin aria-hidden size={14} className="voting-site-icon" />
        <span className="voting-site-name">{site.name}</span>
      </button>
      {site.address && <p className="voting-site-address">{site.address}</p>}
      {/* A null distance renders nothing; map gaps join the card footer. */}
      {miles !== null && <p className="voting-site-distance">{milesLabel(miles)}</p>}
      {site.room && <p className="voting-site-room">{site.room}</p>}
      <p className="voting-site-kind">{(site.kinds ?? [site.kind]).map(kind => KIND_LABEL[kind]).join(" · ")}</p>
      {site.election && <p className="voting-site-election">Publisher&rsquo;s election label: {site.election}</p>}
      {site.electionDate && <p className="voting-site-election">Election date: {site.electionDate}</p>}
      {(site.precincts?.length || site.precinct) && <p className="voting-site-serves">Precinct: {(site.precincts ?? [site.precinct]).join(", ")}</p>}
      {site.serves && <p className="voting-site-serves">{site.serves}</p>}
      {site.schedules?.length ? site.schedules.map((schedule, index) => <p className="voting-site-hours whitespace-pre-line" key={index}>
        {KIND_LABEL[schedule.kind]}{schedule.electionDate ? ` · ${schedule.electionDate}` : ""}{schedule.days ? ` · ${schedule.days}` : ""}{schedule.hours ? `: ${schedule.hours}` : ""}
      </p>) : <>
        {site.days && <p className="voting-site-days">Days: {site.days}</p>}
        {site.hours && <p className="voting-site-hours whitespace-pre-line">Hours: {site.hours}</p>}
      </>}
      {site.locationNotes && <p className="voting-site-notes">{site.locationNotes}</p>}
      {site.accessibilityNotes && <p className="voting-site-accessibility">Accessibility: {site.accessibilityNotes}</p>}
      {site.rules?.map((rule, index) => <p className="voting-rule" key={`${rule.source.url}-${index}`}>{rule.text}</p>)}
      {site.office && <p className="voting-site-office">{site.office.name}{site.office.phone ? ` — ${site.office.phone}` : ""}{site.office.email ? ` — ${site.office.email}` : ""}</p>}
      <p className="voting-site-checked">Last checked: <time dateTime={lastChecked}>{lastChecked.slice(0, 10)}</time></p>
      {site.address && <a
        className="voting-site-directions"
        href={directionsUrl(site)}
        target="_blank"
        rel="noreferrer noopener"
      >
        Directions
      </a>}
    </li>
  );
}

/** Every displayed rule and change notice contributes its own source, including file dates. */
export function votingSources(j: VotingJurisdiction) {
  const sources: VotingSource[] = [
    { publisher: j.sourceOrg, url: j.sourceUrl, checkedAt: j.collectedAt }, ...(j.sources ?? []),
    ...(j.publication ? [j.publication.source] : []), ...(j.rules ?? []).map(rule => rule.source),
    ...j.sites.flatMap(site => [...(site.sources ?? []).map(source => ({ ...source, lastUpdated: source.lastUpdated ?? site.lastUpdated })), ...(site.rules ?? []).map(rule => rule.source)]),
  ];
  const unique = new Map<string, VotingSource>();
  for (const source of sources) unique.set(`${source.url}|${source.title ?? ""}`, source);
  return [...unique.values()].map(source => ({
    what: `${source.title ?? "Voting locations, hours and rules"}${source.lastUpdated ? ` — file last updated ${source.lastUpdated}` : ""}`,
    provenance: { sourceUrl: source.url, sourceOrg: source.publisher, collectedAt: source.checkedAt ?? j.collectedAt, verifiedAt: null },
  }));
}
