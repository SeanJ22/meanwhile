"use client";

/**
 * **DEVELOPMENT PREVIEW HARNESS — never mounted by a production route.**
 *
 * Renders the command center against the sample world with the prototype's
 * review controls (connection, role, forced outcome, outreach permission,
 * data state), plus one extra view: the production bundle with no backend
 * announced, to check every "Not connected yet — turns on by itself" state.
 */
import { useMemo, useState } from "react";

import { CommandCenter } from "../command-center.tsx";
import type { Connection } from "../eligibility.ts";
import { liveExecutor } from "../executor.ts";
import { buildLiveBundle, type LiveReference } from "../live-data.ts";
import { SECTION_IDS, type SectionId } from "../contract.ts";
import type { SectionState } from "../live-sync.ts";
import type { AdminV6Data, Definition, LoadState } from "../model.ts";
import { workerStatusFromPulse } from "../pulse-view.ts";
import s from "../v6.module.css";
import { sampleExecutor, type ForcedOutcome } from "./executor.ts";
import { buildSampleData, INITIAL_WORLD, sampleItemState, type SampleWorld } from "./world.ts";

export function PreviewHarness(props: { readonly definitions: readonly Definition[]; readonly profileVersion: string; readonly reference: LiveReference }) {
  const [world, setWorld] = useState<SampleWorld>(INITIAL_WORLD);
  const [scope, setScope] = useState("us");
  const [connection, setConnection] = useState<Connection>("live");
  const [role, setRole] = useState<"owner" | "viewer">("owner");
  const [canSpend, setCanSpend] = useState(true);
  const [outreach, setOutreach] = useState(false);
  const [forced, setForced] = useState<ForcedOutcome>("natural");
  const [dataState, setDataState] = useState<LoadState>("ready");
  const [source, setSource] = useState<"sample" | "unconnected">("sample");
  const [openedAt] = useState("2026-09-28T06:53:00.000Z");

  const sampleData = useMemo(() => buildSampleData(world, props.definitions, props.profileVersion, scope), [world, props.definitions, props.profileVersion, scope]);
  const data: AdminV6Data = useMemo(() => {
    if (source === "unconnected") {
      const waiting = Object.fromEntries(SECTION_IDS.map((id) => [id, { phase: "waiting", data: null, asOf: null, revision: null, missingParts: [], attempts: 0 } satisfies SectionState])) as unknown as Record<SectionId, SectionState>;
      return buildLiveBundle(waiting, props.reference, workerStatusFromPulse(null));
    }
    if (dataState === "ready") return sampleData;
    const d = sampleData;
    if (dataState === "loading") return { ...d, stuck: { ...d.stuck, load: "loading", data: null }, results: { ...d.results, load: "loading", data: null } };
    if (dataState === "failed") return { ...d, stuck: { ...d.stuck, load: "failed", data: null }, results: { ...d.results, load: "failed", data: null } };
    return { ...d, money: { ...d.money, load: "partial", missingParts: ["GitHub’s report didn’t arrive. Its last amount is kept and marked old."] }, stuck: { ...d.stuck, load: "partial", missingParts: ["The “waiting for the publisher” group couldn’t be read, so it may be undercounted."] } } as AdminV6Data;
  }, [source, dataState, sampleData, props.reference]);

  const names = (id: string) => sampleData.stuck.data?.find((i) => i.id === id)?.title ?? sampleData.places.data?.find((p) => p.key === id)?.name ?? id;
  const executor = useMemo(() => source === "unconnected"
    ? liveExecutor({ capabilities: () => null, fetch: async () => ({ status: 0, json: async () => null }) })
    : sampleExecutor({ names, applyEffect: (fx) => setWorld((w) => fx(w)), forced: () => forced }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [source, forced]);

  const panel = (
    <details className={s.card} style={{ borderStyle: "dashed" }}>
      <summary className={s.small} style={{ cursor: "pointer" }}>Review states (development preview only)</summary>
      <div className={s.inline} style={{ marginTop: 10 }}>
        <Sel label="Data" value={source} set={setSource} opts={[["sample", "Sample data"], ["unconnected", "Production page, backend not connected yet"]]} />
        <Sel label="Connection" value={connection} set={setConnection} opts={[["live", "Live"], ["stale", "Out of date"], ["reconnecting", "Reconnecting"], ["offline", "Disconnected"], ["connecting", "Connecting"]]} />
        <Sel label="Loading" value={dataState} set={setDataState} opts={[["ready", "Ready"], ["loading", "Loading"], ["partial", "Partly arrived"], ["failed", "Failed"]]} />
        <Sel label="Role" value={role} set={setRole} opts={[["owner", "Owner"], ["viewer", "View only"]]} />
        <Sel label="Spending permission" value={canSpend ? "yes" : "no"} set={(x) => setCanSpend(x === "yes")} opts={[["yes", "Yes"], ["no", "No"]]} />
        <Sel label="Outreach permission" value={outreach ? "yes" : "no"} set={(x) => setOutreach(x === "yes")} opts={[["no", "No"], ["yes", "Yes"]]} />
        <Sel label="Force every result" value={forced} set={setForced} opts={[["natural", "Natural"], ["done", "Done"], ["partial", "Partly done"], ["refused", "Refused"], ["failed", "Failed"], ["unknown", "Result unknown"]]} />
        <button type="button" className={s.btn} onClick={() => setWorld(INITIAL_WORLD)}>Reset the sample</button>
      </div>
    </details>
  );

  return (
    <CommandCenter
      data={data}
      mode={source === "sample" ? "sample" : "live"}
      executor={executor}
      scopeKey={scope}
      onScopeChange={setScope}
      connection={connection}
      lastGoodAt={connection === "live" ? openedAt : "2026-09-28T06:39:00.000Z"}
      recovered={false}
      access={{ role, canSpend, outreachAuthorized: outreach }}
      itemState={source === "sample" ? (kind, target) => sampleItemState(world, kind, target, { hunts: sampleData.hunts.data ?? [], placeKind: sampleData.places.data?.find((p) => p.key === target)?.kind ?? null }) : undefined}
      reviewPanel={panel}
    />
  );
}

function Sel<T extends string>(props: { readonly label: string; readonly value: T; readonly set: (v: T) => void; readonly opts: readonly (readonly [T, string])[] }) {
  return (
    <label className={s.inline} style={{ gap: 6 }}>
      <span className={s.meta}>{props.label}</span>
      <select className={s.select} value={props.value} onChange={(e) => props.set(e.target.value as T)}>
        {props.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
