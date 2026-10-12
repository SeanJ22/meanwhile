"use client";

import { CaptureHealthPanel } from "./capture-health.tsx";
import { DataSwitchesPanel } from "./data-switches.tsx";
import { ReaderDemandPanel } from "./reader-demand.tsx";
import { TopicCountsPanel } from "./topic-counts.tsx";
import s from "./v6.module.css";

export function DataBusinessScreen() {
  return (
    <>
      <header>
        <p className={s.eyebrow}>Whole system</p>
        <h1 className={s.h1}>Data business</h1>
      </header>
      <ReaderDemandPanel />
      <CaptureHealthPanel />
      <TopicCountsPanel />
      <DataSwitchesPanel />
    </>
  );
}
