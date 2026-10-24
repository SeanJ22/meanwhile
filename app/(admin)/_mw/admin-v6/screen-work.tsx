"use client";

import { useV6 } from "./context.tsx";
import { WorkCounts } from "./work-counts.tsx";
import s from "./v6.module.css";

export function WorkScreen() {
  const v = useV6();
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Work</h1>
      </header>
      <WorkCounts />
    </>
  );
}
