import type { ScheduleInput } from "@/lib/control-plane/gateway/scheduled-orders.ts";
import { easternLocalToIso } from "@/lib/control-plane/eastern-time.ts";

export type WhenMode = "now" | "at" | "after" | "repeat" | "finish-by";
export interface OrderWhen { readonly mode: WhenMode; readonly startAt?: string; readonly after?: string; readonly repeat?: "hourly" | "daily" | "weekly"; readonly finishBy?: string }
/** Calendar entries are Eastern. A missing or nonexistent time never becomes now. */
export function orderWhen(mode:WhenMode,start:string,after:string,repeat:"hourly"|"daily"|"weekly",finish:string):OrderWhen|null {
  if(mode==="now")return {mode};
  if(mode==="after")return after ? {mode,after} : null;
  if(mode==="finish-by"){const finishBy=easternLocalToIso(finish);return finishBy ? {mode,finishBy} : null;}
  const startAt=easternLocalToIso(start);return startAt ? {mode,startAt,...(mode==="repeat"?{repeat}:{})} : null;
}
export function scheduledWhen(when:OrderWhen,now:string):ScheduleInput|null {
  if(when.mode==="now")return null;
  return {startAt:when.startAt ?? (when.mode==="finish-by"?now:null),after:when.after??null,repeat:when.repeat??null,finishBy:when.finishBy??null};
}
