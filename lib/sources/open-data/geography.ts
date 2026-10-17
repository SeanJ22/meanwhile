import { DEFAULT_RADIUS_KM } from "../../meetings/constants.ts";
import { haversineKm } from "../../geo/distance.ts";
import type { OpenDataFact } from "./model.ts";
export const FACILITY_RADIUS_KM=DEFAULT_RADIUS_KM;
const CELL=0.5;
export function facilityPoint(row:OpenDataFact):{lat:number;lng:number}|null {
  if(row.fields.latitude===null || row.fields.longitude===null)return null;
  const lat=Number(row.fields.latitude),lng=Number(row.fields.longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}
export const facilityCell=(lat:number,lng:number)=>`cell:${Math.floor(lat/CELL)}:${Math.floor(lng/CELL)}`;
export function nearbyFacilityCells(point:{lat:number;lng:number}):string[] {
  const dLat=FACILITY_RADIUS_KM/110.574,dLng=FACILITY_RADIUS_KM/(111.32*Math.cos(point.lat*Math.PI/180));
  const result:string[]=[];
  for(let lat=Math.floor((point.lat-dLat)/CELL);lat<=Math.floor((point.lat+dLat)/CELL);lat++)
    for(let lng=Math.floor((point.lng-dLng)/CELL);lng<=Math.floor((point.lng+dLng)/CELL);lng++)result.push(`cell:${lat}:${lng}`);
  return result;
}
export function facilityNear(row:OpenDataFact,point:{lat:number;lng:number}) {
  const held=facilityPoint(row);return !!held&&haversineKm(point.lat,point.lng,held.lat,held.lng)<=FACILITY_RADIUS_KM;
}
