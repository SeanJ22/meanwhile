import { storedKeyValue } from "../../core/keys-values.ts";
import { neon } from "../../db/client.ts";
import { installDatabaseTransferCounter } from "../../db/transfer.ts";
import { withStoreBudget } from "../repository/request-bounds.ts";
import { runLineKeeper } from "./keep.ts";
import { shareVersionedRows } from "../../db/versioned-rows.ts";
function clients() {
  const control=process.env.WTP_CONTROL_PLANE_DATABASE_URL,reader=storedKeyValue("DATABASE_URL");
  if(!control||!reader)throw Error("The line keeper needs both database connections");
  installDatabaseTransferCounter();
  const controlSql=neon(control);
  shareVersionedRows(controlSql,control);
  return {control:controlSql,reader:neon(reader,{readOnly:true})};
}
export async function hourlyLineKeeper(at=new Date().toISOString()) {
  const {control,reader}=clients();
  const result=await withStoreBudget("line keeper hourly",60_000,()=>runLineKeeper(control,reader,at));
  console.log(JSON.stringify({lineKeeper:"hourly",hour:result.hour.from,problems:result.hour.problems.length,...result.hour.own}));
  return result;
}
export async function seedLineKeeper() {
  await hourlyLineKeeper();
}
