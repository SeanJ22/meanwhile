"use client";

/**
 * **THE FIX QUEUE'S ONE SEND.** Items reach the queue from gaps anywhere in the
 * console (or by asking the chat); "Go fix these" sends what is waiting, and the
 * next decision sync opens a work row for each. It sits above the Fix list so
 * the queue can be sent from the view that shows it.
 */
import { Card, cx, Actions } from "./ui.tsx";
import s from "./v6.module.css";

export function FixQueueControls() {
  return (
    <Card title="The fix queue">
      <p className={cx(s.p, s.small, s.dim)}>
        Items waiting under “Needs attention” stay there until you send them. Sending opens one work row for each; each row then moves to “Being fixed”.
      </p>
      <Actions actions={[{ kind: "fix-go", target: "fix-queue" }]} primaryFirst />
    </Card>
  );
}
