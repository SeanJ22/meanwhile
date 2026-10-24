import { neon } from "@neondatabase/serverless";
import { installDatabaseTransferCounter } from "../../db/transfer.ts";
import { withStoreBudget } from "../repository/request-bounds.ts";
import { runLineKeeper, retireLineInventory } from "./keep.ts";
function clients() {
  const control=process.env.WTP_CONTROL_PLANE_DATABASE_URL,reader=process.env.DATABASE_URL;
  if(!control||!reader)throw Error("The line keeper needs both database connections");
  installDatabaseTransferCounter();
  return {control:neon(control),reader:neon(reader,{readOnly:true})};
}
export async function hourlyLineKeeper(at=new Date().toISOString()) {
  const {control,reader}=clients();
  const result=await withStoreBudget("line keeper hourly",60_000,()=>runLineKeeper(control,reader,at));
  console.log(JSON.stringify({lineKeeper:"hourly",hour:result.hour.from,problems:result.hour.problems.length,...result.hour.own}));
  return result;
}
export async function seedLineKeeper() {
  await retireLineInventory(clients().control);
}
