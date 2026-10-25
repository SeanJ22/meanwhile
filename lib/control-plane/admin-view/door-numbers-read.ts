/** Each read fails alone to null, so its row says why it is not measured instead of showing a zero. */
import { neon } from "@neondatabase/serverless";
import type { PostingToLiveRow } from "../../civic-data/posting-to-live.ts";
import { readPostingWindow } from "../line-keeper/posting.ts";
import { type DoorRecord } from "../../doors/registry.ts";
import { fixItems } from "../fix-list.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { DoorNumberReadings } from "./door-numbers.ts";
import type { LineState } from "../line-keeper/model.ts";

async function attempt<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch { return null; }
}

export async function readRecentPostingToLive(): Promise<readonly PostingToLiveRow[]> {
  const url=process.env.DATABASE_URL;
  if(!url) throw Error("The reader database is not configured");
  const now=new Date();
  return readPostingWindow(neon(url,{readOnly:true}),new Date(now.getTime()-7*86_400_000).toISOString(),now.toISOString());
}

export async function readDoorNumbers(input: { readonly now: string; readonly doors: readonly DoorRecord[] | null; readonly config: AdminConfig | null;readonly keeper?:LineState|null }): Promise<Omit<DoorNumberReadings, "shutDoors">> {
  const posting=await attempt(() => readRecentPostingToLive());
  return {now:input.now,overdue:null,scheduled:null,posting,fixes:input.config===null?null:fixItems(input.config)};
}
