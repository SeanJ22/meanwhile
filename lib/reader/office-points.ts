import {POST} from "../../app/api/geocode/route.ts";
import {PUBLIC_SITE_ORIGIN} from "../ops/origins.ts";
import {officeOwners,directoryOffices} from "../map/office-pins.ts";
import {isOfficeStreetAddress,type OfficePoint} from "../map/office-locator.ts";
import {personIdentityKeys} from "../officials/people-identity.ts";
import type {ReaderStateResponse} from "./client.ts";

type ResolvePoint = (address:string,signal:AbortSignal)=>Promise<OfficePoint|null>;
const resolvePoint:ResolvePoint=async(address,signal)=>{
  const response=await POST(new Request(`${PUBLIC_SITE_ORIGIN}/api/geocode`,{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({address}),signal}));
  const body=await response.json() as {match?:boolean;lat:number;lng:number};
  return body.match ? {lat:body.lat,lng:body.lng} : null;
};

/** Only held public district offices are inputs. Slow lookups stay with the existing browser fallback. */
export async function publicOfficePoints(value:ReaderStateResponse,resolve:ResolvePoint=resolvePoint,budgetMs=450):Promise<Record<string,OfficePoint>> {
  const addresses=new Set<string>();
  for(const owner of officeOwners(value.coverage)) {
    const keys=personIdentityKeys(owner.holder);
    const directory=value.memberDirectories?.find(row=>row.ids.some(id=>keys.has(id)))?.directory;
    if(directory)for(const office of directoryOffices(owner,directory))
      if(!office.point&&isOfficeStreetAddress(office.address))addresses.add(office.address);
  }
  if(!addresses.size)return {};
  const points:Record<string,OfficePoint>={},controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>;
  const deadline=new Promise<void>(done=>{timer=setTimeout(()=>{controller.abort();done()},budgetMs)});
  const reads=Promise.all([...addresses].map(async address=>{
    try {const point=await resolve(address,controller.signal);if(point&&!controller.signal.aborted)points[address]=point;}catch{/* The browser retains its retry. */}
  }));
  try {await Promise.race([reads,deadline]);return points;}
  finally {clearTimeout(timer!);controller.abort();}
}
