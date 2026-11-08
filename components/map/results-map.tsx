"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FilterSpecification, MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NATIONAL_BOUNDARIES_SOURCE } from "@/lib/map/districts";
import { CONUS_BOUNDS } from "@/lib/map/style";
import { loadStateOutlines, stateAbbrFromOcdId, stateFilter, type StateOutlines } from "@/lib/map/state-focus";
import { houseFlipsByState, parseDistrictOcd, stateOcd, type DistrictResult } from "@/lib/map/results";
import { districtCard, houseStateMeta, senateCard } from "@/lib/map/results-card";
import { countyChoices, outlineBounds, type CountyChoice } from "@/lib/map/results-counties";
import { canDrawResults, clearResultLayers, drawResultLayers } from "@/lib/map/results-apply";
import { countyOutlineLayers, resultLayers, resultsLayerId, stateBadgeLayers, stateBadgePoints, type ResultsSurface, type ResultsTheme } from "@/lib/map/results-style";
import { closeResults, setResultsDistricts, setResultsScope, showResultsState, useResultsScope, type ResultsState } from "@/lib/map/results-scope";
import { Banner, CountyChip, GettingBanner, Legend, MapCard, PillButton, Segmented, Sheet, WinnerRow, type LegendKey } from "./results-chrome";
import { useMapInstance } from "./map-instance";
import styles from "./results-map.module.css";

type StateLayer = "sen" | "house" | "cd";
const BOUNDARY = { sen: "state-senate", house: "state-house", cd: "congressional" } as const;
const STATE_LAYERS = [{ id: "sen", label: "State Senate" }, { id: "house", label: "State House" }, { id: "cd", label: "U.S. House" }] as const;
const NATION_LAYERS = [{ id: "sen", label: "U.S. Senate" }, { id: "house", label: "U.S. House" }] as const;
const HOUSE_SEATS = 435;

type Results = Readonly<Record<string, DistrictResult>>;
const loads = new Map<string, Promise<Results>>();
function readResults(request: string): Promise<Results> {
  let load = loads.get(request);
  if (!load) {
    load = fetch(`/api/map-results?${request}`).then(async response => {
      if (!response.ok) throw new Error(`Results: ${response.status}`);
      return (await response.json() as { results: Results }).results;
    });
    loads.set(request, load);
    load.catch(() => { if (loads.get(request) === load) loads.delete(request); });
  }
  return load;
}

/** Filed results for one request. `null` while they load; `failed` when they could not be read. */
function useResults(request: string): { results: Results | null; failed: boolean } {
  const [held, setHeld] = useState<{ request: string; results: Results | null; failed: boolean }>({ request, results: null, failed: false });
  useEffect(() => {
    let live = true;
    readResults(request).then(results => { if (live) setHeld({ request, results, failed: false }); }, () => { if (live) setHeld({ request, results: null, failed: true }); });
    return () => { live = false; };
  }, [request]);
  return held.request === request ? held : { results: null, failed: false };
}

function useOutlines(): StateOutlines | null {
  const [outlines, setOutlines] = useState<StateOutlines | null>(null);
  useEffect(() => {
    let live = true;
    loadStateOutlines().then(value => { if (live) setOutlines(value); }, () => undefined);
    return () => { live = false; };
  }, []);
  return outlines;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ResultsMapProps {
  theme: ResultsTheme;
  phone: boolean;
  /** The reader's districts from their ZIP. */
  yours: readonly string[];
  zip: string | null;
  /** The scorecard when one is mounted: a right panel on desktop, a bottom sheet on phone. */
  scorecard?: ReactNode;
}

export default function ResultsMap({ theme, phone, yours, zip, scorecard }: ResultsMapProps) {
  const map = useMapInstance();
  const router = useRouter();
  const onBack = () => { closeResults(); if (zip) router.push(`/ballot?zip=${zip}`); };
  const { scope, state, home } = useResultsScope();
  const outlines = useOutlines();
  const [layer, setLayer] = useState<StateLayer>("sen");
  const [natLayer, setNatLayer] = useState<"sen" | "house">("sen");
  const [houseState, setHouseState] = useState<ResultsState | null>(null);
  // A county or a tapped district belongs to the scene it was chosen in; a new scene starts clear.
  const [countyHeld, setCountyHeld] = useState<{ scene: string; county: CountyChoice | null } | null>(null);
  const [counties, setCounties] = useState<CountyChoice[]>([]);
  const [pickedHeld, setPickedHeld] = useState<{ scene: string; ocdId: string; name: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const [topBottom, setTopBottom] = useState(0);

  const nation = scope === "nation";
  const statesFirst = nation && natLayer === "house" && phone && !houseState;
  const sceneKey = !nation ? `state:${state.abbr}` : houseState ? `house:${houseState.abbr}` : "nation";
  const county = countyHeld?.scene === sceneKey ? countyHeld.county : null;
  const picked = pickedHeld?.scene === sceneKey ? pickedHeld : null;
  const setCounty = (value: CountyChoice | null) => setCountyHeld({ scene: sceneKey, county: value });
  const setPicked = (value: { ocdId: string; name: string } | null) => setPickedHeld(value && { scene: sceneKey, ...value });
  const houseAbbr = houseState?.abbr ?? null;
  const surface: ResultsSurface = useMemo(() => !nation
    ? { kind: "districts", boundary: BOUNDARY[layer], state: state.abbr }
    : natLayer === "sen" || statesFirst ? { kind: "states" }
    : { kind: "districts", boundary: "congressional", state: phone ? houseAbbr : null },
  [nation, layer, state.abbr, natLayer, statesFirst, phone, houseAbbr]);
  const needsDistricts = surface.kind === "districts";
  useEffect(() => { setResultsDistricts(needsDistricts); }, [needsDistricts]);

  const request = !nation ? `scope=state&state=${state.abbr}` : natLayer === "sen" ? "scope=us-senate" : "scope=us-house";
  const { results, failed } = useResults(request);
  const flips = useMemo(() => results ? houseFlipsByState(results) : {}, [results]);

  // The phone's first House view colors a state by the party that flipped its seats.
  const drawn: Results = useMemo(() => {
    if (!results) return {};
    if (!statesFirst) return results;
    return Object.fromEntries(Object.entries(flips).map(([abbr, { party }]) => [stateOcd(abbr),
      { ocdId: stateOcd(abbr), status: "called" as const, seats: [{ party }], flipTo: null, candidates: [] }]));
  }, [results, statesFirst, flips]);

  const stateName = useCallback((abbr: string) => outlines?.features.find(f => stateAbbrFromOcdId(f.properties.ocdId) === abbr)?.properties.name ?? abbr, [outlines]);
  const yoursOnSurface = useMemo(() => surface.kind === "states" ? [stateOcd(home.abbr)] : yours.filter(id => id.includes(surface.boundary === "congressional" ? "/cd:" : surface.boundary === "state-senate" ? "/sldu:" : "/sldl:")),
    [surface, yours, home.abbr]);

  /* ------------------------------------------------------ layers on the map --- */
  const specs = useMemo(() => {
    const base = resultLayers(surface, drawn, { theme, yours: yoursOnSurface });
    const badges = surface.kind === "states" && outlines
      ? stateBadgePoints(outlines.features, statesFirst
        ? Object.fromEntries(Object.entries(flips).map(([abbr, { party, count }]) => [stateOcd(abbr), { party, count }]))
        : Object.fromEntries(Object.values(drawn).flatMap(result => result.flipTo ? [[result.ocdId, { party: result.flipTo }]] : [])))
      : null;
    return { layers: [...base, ...(badges ? stateBadgeLayers(statesFirst) : []), ...(county && surface.kind === "districts" ? countyOutlineLayers(county.ocdId, theme) : [])], badges };
  }, [surface, drawn, theme, yoursOnSurface, outlines, statesFirst, flips, county]);

  useEffect(() => {
    let attaching = false;
    const ensure = () => {
      if (attaching || !canDrawResults(map, surface.kind === "districts")) return;
      attaching = true;
      try { drawResultLayers(map, specs.layers, { theme, states: surface.kind === "states" || !surface.state, badges: specs.badges }); }
      catch { /* The style is mid-change; the next styledata puts the layers back. */ }
      finally { attaching = false; }
    };
    ensure();
    const onStyle = () => { if (!attaching && !map.getLayer(resultsLayerId("fill")) && canDrawResults(map, surface.kind === "districts")) ensure(); };
    map.on("styledata", onStyle);
    return () => { map.off("styledata", onStyle); try { clearResultLayers(map); } catch { /* The map is gone. */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, specs, theme]);

  /* ------------------------------------------------------------- the camera --- */
  const fit = useCallback((bounds: [[number, number], [number, number]], maxZoom = 14) => {
    const panel = !phone && scorecard ? 460 : 16;
    map.fitBounds(bounds, { padding: phone ? { top: 130, bottom: scorecard ? 236 : 70, left: 20, right: 20 } : { top: 130, bottom: 40, left: 240, right: panel + 24 }, maxZoom, duration: reducedMotion() ? 0 : 600 });
  }, [map, phone, scorecard]);
  const fitState = useCallback(() => {
    const feature = outlines?.features.find(f => stateAbbrFromOcdId(f.properties.ocdId) === state.abbr) ?? null;
    const bounds = outlineBounds(feature);
    if (bounds) fit(bounds);
  }, [outlines, state.abbr, fit]);
  useEffect(() => {
    if (!nation && outlines) fitState();
    else if (nation && houseAbbr) {
      const bounds = outlineBounds(outlines?.features.find(f => stateAbbrFromOcdId(f.properties.ocdId) === houseAbbr) ?? null);
      if (bounds) fit(bounds);
    } else if (nation) fit(CONUS_BOUNDS, 5);
    // The camera moves when the scene changes, not when the outlines or padding objects do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey, !outlines]);

  /* --------------------------------------------------------------- counties --- */
  useEffect(() => {
    if (nation) return;
    const read = () => {
      if (!map.getSource(NATIONAL_BOUNDARIES_SOURCE)) return;
      const found = countyChoices(map.querySourceFeatures(NATIONAL_BOUNDARIES_SOURCE, { sourceLayer: "districts",
        filter: ["all", ["==", ["get", "boundaryType"], "county"], stateFilter(state.abbr)] as FilterSpecification }));
      setCounties(held => held.length === found.length && held.every((c, i) => c.ocdId === found[i].ocdId) ? held : found);
    };
    read();
    map.on("idle", read);
    return () => { map.off("idle", read); setCounties([]); };
  }, [map, nation, state.abbr]);

  /* ------------------------------------------------------------------ taps --- */
  useEffect(() => {
    const target = resultsLayerId("fill");
    const onClick = (event: MapMouseEvent) => {
      if (!map.getLayer(target)) return;
      const feature = map.queryRenderedFeatures(event.point, { layers: [target] })[0];
      const ocdId = String(feature?.properties?.ocdId ?? "");
      setPickedHeld(ocdId ? { scene: sceneKey, ocdId, name: String(feature?.properties?.name ?? "") } : null);
    };
    const hand = () => { map.getCanvas().style.cursor = "pointer"; }, arrow = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", onClick);
    map.on("mouseenter", target, hand);
    map.on("mouseleave", target, arrow);
    return () => { map.off("click", onClick); map.off("mouseenter", target, hand); map.off("mouseleave", target, arrow); arrow(); };
  }, [map, sceneKey, layer, natLayer]);

  useLayoutEffect(() => {
    const top = topRef.current;
    if (!top) return;
    const measure = () => setTopBottom(Math.round(top.getBoundingClientRect().bottom - (top.parentElement?.getBoundingClientRect().top ?? 0)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(top);
    return () => observer.disconnect();
  }, []);

  /* ------------------------------------------------------------------ copy --- */
  const count = Object.keys(results ?? {}).length;
  const banner = failed ? <>We couldn&apos;t load results just now. Reload to try again.</>
    : !results ? null
    : nation && houseState ? <>{houseState.name} districts. <button type="button" onClick={() => setHouseState(null)}>Back to all states</button></>
    : statesFirst ? <>Numbers show House seats flipped so far. Tap a state to see its districts.</>
    : nation && natLayer === "house" && count < HOUSE_SEATS ? <GettingBanner about="results for every House district" />
    : nation && count === 0 ? <GettingBanner about="U.S. Senate results" />
    : !nation && !Object.keys(results).some(id => id.includes(layer === "cd" ? "/cd:" : layer === "sen" ? "/sldu:" : "/sldl:")) ? <GettingBanner about={`${state.name} district results`} />
    : null;

  const legend: { key: LegendKey; label: string }[] = [
    { key: "D", label: nation ? "Democrat won" : "Democrat" }, { key: "R", label: nation ? "Republican won" : "Republican" },
    ...(!nation && layer === "house" ? [{ key: "split" as const, label: "One seat each" }] : []),
    { key: "counting", label: "Still counting" },
    ...(nation ? [{ key: "none" as const, label: natLayer === "sen" ? "No Senate race this year" : "No results yet" }] : []),
    { key: "flipD", label: "Flipped to Democrat" }, { key: "flipR", label: "Flipped to Republican" },
    { key: "yours", label: nation ? (surface.kind === "states" ? "Your state" : "Your district") : `Your district${zip ? ` · ${zip}` : ""}` },
  ];

  const card = (() => {
    if (!picked) return null;
    const close = () => setPicked(null);
    if (surface.kind === "districts" && nation && !phone) {
      // On the national House map a district opens its state's card.
      const abbr = parseDistrictOcd(picked.ocdId)?.state.toUpperCase() ?? "", name = stateName(abbr);
      const model = houseStateMeta(name, flips[abbr.toLowerCase()]?.count ?? 0, abbr === home.abbr);
      return <MapCard title={model.title} meta={model.meta} onClose={close}>
        <PillButton arrow="right" onClick={() => showResultsState({ abbr, name })}>See more about {name}</PillButton>
      </MapCard>;
    }
    if (surface.kind === "districts") {
      const model = districtCard(picked.ocdId, results?.[picked.ocdId], yours.includes(picked.ocdId));
      return <MapCard title={model.title} meta={model.meta} flip={model.flip} onClose={close}>
        {model.hasResult
          ? model.rows.map((row, index) => <WinnerRow key={index} {...row} />)
          : <GettingBanner about="this district's results" />}
        {yours.includes(picked.ocdId) && zip && <Link className={styles.link} href={`/ballot?zip=${zip}`}>Open the full card</Link>}
      </MapCard>;
    }
    const abbr = stateAbbrFromOcdId(picked.ocdId) ?? "", name = picked.name || stateName(abbr), mine = abbr === home.abbr;
    if (statesFirst) {
      const model = houseStateMeta(name, flips[abbr.toLowerCase()]?.count ?? 0, mine);
      return <MapCard title={model.title} meta={model.meta} onClose={close}>
        <PillButton arrow="right" onClick={() => { setHouseState({ abbr, name }); setPicked(null); }}>See {name}&rsquo;s districts</PillButton>
      </MapCard>;
    }
    const model = senateCard(name, results?.[picked.ocdId], mine);
    return <MapCard title={model.title} meta={model.meta} flip={model.flip} onClose={close}>
      {model.raceThisYear ? model.rows.map((row, index) => <WinnerRow key={index} {...row} />)
        : <p className={styles.dim} style={{ margin: 0, lineHeight: 1.45 }}>Governor, U.S. House, legislature and local races are on the state view.</p>}
      <PillButton arrow="right" onClick={() => showResultsState({ abbr, name })}>See more about {name}</PillButton>
    </MapCard>;
  })();

  const scopeChip = nation
    ? <button type="button" onClick={() => showResultsState(home)}>{home.name}</button>
    : <button type="button" onClick={() => setResultsScope("nation")}>United States</button>;

  return (
    <div className={styles.root} data-results-map={sceneKey}>
      <div ref={topRef} className={styles.top} style={phone ? { left: 10, right: 10, maxWidth: "none" } : undefined}>
        <div className={styles.chips}>
          <PillButton arrow="left" onClick={onBack}>Back to your ballot</PillButton>
          {zip && <span className={styles.pill} style={{ background: "var(--panel)", color: "var(--text)", boxShadow: "inset 0 0 0 1px var(--panel-border)", height: 32, padding: "0 12px" }}>Ballot · {zip}</span>}
        </div>
        {!nation && state.abbr !== home.abbr && <PillButton arrow="left" onClick={() => showResultsState(home)}>Back to {home.name}</PillButton>}
        {nation
          ? <Segmented label="Show" items={NATION_LAYERS} value={natLayer} onChange={id => { setNatLayer(id); setHouseState(null); setPicked(null); }} />
          : <Segmented label="Show" items={STATE_LAYERS} value={layer} onChange={id => { setLayer(id); setPicked(null); }} />}
        <div className={styles.chips}>
          {!nation && <>
            <button type="button" aria-pressed={county === null} onClick={() => { setCounty(null); fitState(); }}>Statewide</button>
            <CountyChip counties={counties} selected={county} onPick={choice => { setCounty(choice); fit(choice.bounds); }} />
          </>}
          {scopeChip}
        </div>
      </div>

      {banner && <Banner phone={phone} below={topBottom}>{banner}</Banner>}

      {!phone && scorecard && <aside className={styles.rightPanel} aria-label="Results scorecard">{scorecard}</aside>}

      <div className={styles.bottom} style={phone ? { left: 10, right: 10, bottom: scorecard ? (sheetOpen ? 630 : 226) : 10, maxWidth: "none", alignItems: "stretch" } : { bottom: 16 }}>
        {card}
        <Legend rows={legend} theme={theme} phone={phone} />
      </div>

      {phone && scorecard && <Sheet open={sheetOpen} onToggle={() => setSheetOpen(open => !open)}>{scorecard}</Sheet>}
    </div>
  );
}
