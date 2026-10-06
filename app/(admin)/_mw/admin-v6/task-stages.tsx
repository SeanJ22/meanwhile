"use client";

/** How far an engineering task has got, as a row of stage chips; a fix with no linked task shows a dash. */
import { TASK_STAGES } from "./model.ts";
import { cx } from "./ui.tsx";
import s from "./v6.module.css";

export function TaskStages(props: { readonly stage: number | null }) {
  if (props.stage === null) return <span className={s.meta}>—</span>;
  return (
    <div className={s.stepper} aria-label={`Task progress: ${TASK_STAGES[props.stage]}`}>
      {TASK_STAGES.map((label, n) => <span key={label} className={cx(s.stepChip, n <= props.stage! && s.stepChipOn)}>{label}</span>)}
    </div>
  );
}
