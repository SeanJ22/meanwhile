"use client";

/**
 * **THE FIX QUEUE'S ONE SEND.** "Go fix these" sends what is waiting in the
 * queue. It sits above the Fix list so the queue can be sent from the view
 * that shows it.
 */
import { Card, Actions } from "./ui.tsx";

export function FixQueueControls() {
  return (
    <Card title="The fix queue">
      <Actions actions={[{ kind: "fix-go", target: "fix-queue" }]} primaryFirst />
    </Card>
  );
}
