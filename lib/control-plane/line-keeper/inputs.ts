import { gzipSync,gunzipSync } from 'node:zlib';
import type { PlaceInputMemo } from '../../civic-data/held-place-slices.ts';

/** Retain the exact readonly source result, including its disposition. Compression
 * keeps replay data out of Admin's hot configuration record and off its readers. */
export function retainedInputs(held:Readonly<Record<string,string>>|null|undefined,changed:(recordClass:string,scope:string)=>boolean,initialize=false){
 const inputs:Record<string,string>={...held};
 const memo:PlaceInputMemo=async <T>(recordClass:string,scope:string,load:()=>Promise<T>):Promise<T>=>{
  const key=JSON.stringify([recordClass,scope]);
  if(!initialize&&!changed(recordClass,scope)){
   if(!Object.hasOwn(inputs,key))throw Error(`Missing retained ${recordClass} input; deployment initialization is required`);
   return JSON.parse(gunzipSync(Buffer.from(inputs[key],'base64')).toString('utf8')) as T;
  }
  const value=await load();
  if(value&&typeof value==='object'&&'kind' in value&&!['PROMOTED','NOT_RECORDED','HELD'].includes(String(value.kind)))throw Error(`The ${recordClass} source input could not be read`);
  inputs[key]=gzipSync(JSON.stringify(value)).toString('base64');
  return value;
 };
 return {inputs,memo};
}
