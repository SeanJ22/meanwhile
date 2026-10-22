import { neon } from "@neondatabase/serverless";
import { installDatabaseTransferCounter } from "../../db/transfer.ts";
import { withQueryCaller } from "../../db/transfer-by-caller.ts";
import { withStoreBudget } from "../repository/request-bounds.ts";
import { initializeLineKeeper, ownReading, runLineKeeper } from "./keep.ts";
import { publishCountryScores } from "./country.ts";

function clients() {
  const control=process.env.WTP_CONTROL_PLANE_DATABASE_URL,reader=process.env.DATABASE_URL;
  if(!control||!reader) throw Error("The line keeper needs both database connections");
  installDatabaseTransferCounter();
  return {control:neon(control),reader:neon(reader,{readOnly:true})};
}
export async function hourlyLineKeeper(at=new Date().toISOString()) {
  const {control,reader}=clients();
  const baseline=ownReading().byCaller;
  const result=await withStoreBudget("line keeper hourly",12*60_000,()=>runLineKeeper(control,reader,at,{measureCountry:true}));
  console.log(JSON.stringify({lineKeeper:"hourly",from:result.hour.from,problems:result.hour.problems.length,...ownReading(baseline)}));
  return result;
}
/** The deployment seed is a separate invocation. Hourly work never falls back to an inventory scan. */
export async function seedLineKeeper(at=new Date().toISOString()) {
  const {control,reader}=clients();
  const baseline=ownReading().byCaller;
  const state=await withQueryCaller("line-keeper.initialize",()=>initializeLineKeeper(control,reader,at));
  await withQueryCaller("line-keeper.country",()=>publishCountryScores(control,reader,at,at,at,{initialize:true}));
  console.log(JSON.stringify({lineKeeper:"initialized",sources:Object.keys(state.doors).length,...ownReading(baseline)}));
}
