import { createReadStream } from "node:fs";
import type { RecordProjection } from "./types.ts";

export type JsonSink=(text:string)=>Promise<void>|void;
export interface JsonScan {
  readonly arrays?:(path:readonly string[],cursor:JsonFileCursor,out:JsonSink|undefined)=>Promise<boolean>;
  readonly objects?:(path:readonly string[],cursor:JsonFileCursor,out:JsonSink|undefined)=>Promise<boolean>;
  readonly watch?:ReadonlyMap<string,(value:unknown)=>void>;
  readonly start?:(path:readonly string[])=>void;
}
const at=(path:readonly string[])=>JSON.stringify(path);
/** Structural JSON scanning keeps source strings in 64 KiB chunks. Only selected keys or members are assembled. */
export class JsonFileCursor {
  readonly #stream;readonly #iterator;#buffer="";#offset=0;
  constructor(file:string){this.#stream=createReadStream(file,{encoding:"utf8",highWaterMark:64*1024});this.#iterator=this.#stream[Symbol.asyncIterator]();}
  async close(){this.#stream.destroy();}
  async #ready():Promise<boolean>{while(this.#offset>=this.#buffer.length){const next=await this.#iterator.next();if(next.done)return false;this.#buffer=next.value as string;this.#offset=0;}return true;}
  async peek():Promise<string>{while(await this.#ready()){while(this.#offset<this.#buffer.length&&/\s/.test(this.#buffer[this.#offset]))this.#offset++;if(this.#offset<this.#buffer.length)return this.#buffer[this.#offset];}return"";}
  async expect(char:string){if(await this.peek()!==char)throw new Error(`JSON expected ${char}`);this.#offset++;}
  async #string(out?:JsonSink,capture=false):Promise<string>{
    if(await this.peek()!=='"')throw new Error("JSON string required");
    let raw="",escaped=false,unicode=0,first=true;
    while(await this.#ready()){
      const start=this.#offset;let done=false;
      while(this.#offset<this.#buffer.length){const c=this.#buffer[this.#offset++];
        if(first){first=false;continue;}
        if(unicode){if(!/[0-9a-f]/i.test(c))throw new Error("Invalid JSON unicode escape");unicode--;continue;}
        if(escaped){escaped=false;if(c==='u')unicode=4;else if(!'"\\/bfnrt'.includes(c))throw new Error("Invalid JSON escape");continue;}
        if(c==='\\'){escaped=true;continue;}if(c==='"'){done=true;break;}if(c.charCodeAt(0)<32)throw new Error("Invalid JSON string control");
      }
      const part=this.#buffer.slice(start,this.#offset);if(out)await out(part);if(capture)raw+=part;
      if(done)return capture?JSON.parse(raw):"";
    }throw new Error("Truncated JSON string");
  }
  async #primitive(out:JsonSink|undefined,watch:((value:unknown)=>void)|undefined){
    let raw="";
    while(await this.#ready()){
      const start=this.#offset;while(this.#offset<this.#buffer.length&&!/[\s,\]}]/.test(this.#buffer[this.#offset]))this.#offset++;
      raw+=this.#buffer.slice(start,this.#offset);if(this.#offset<this.#buffer.length)break;
    }
    if(!/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(raw))throw new Error("Invalid JSON scalar");
    if(out)await out(raw);watch?.(JSON.parse(raw));
  }
  async value(out?:JsonSink,projection?:RecordProjection,path:readonly string[]=[],scan:JsonScan={}):Promise<void>{
    scan.start?.(path);const char=await this.peek(),watch=scan.watch?.get(at(path));
    if(char==='['){if(await scan.arrays?.(path,this,out))return;await this.array(async(index)=>this.value(out,undefined,[...path,String(index)],scan),out);return;}
    if(char==='{'){if(await scan.objects?.(path,this,out))return;await this.object(async(key,emit)=>{
      const keep=projection===undefined?true:projection[key];
      const child=Array.isArray(keep)?Object.fromEntries(keep.map(key=>[key,true])):keep&&typeof keep==="object"?keep as RecordProjection:undefined;
      await this.value(keep?emit:undefined,child,[...path,key],scan);
    },out,projection?key=>Object.prototype.hasOwnProperty.call(projection,key):undefined);return;}
    if(char==='"'){const parsed=await this.#string(out,!!watch);if(watch)watch(parsed);return;}
    await this.#primitive(out,watch);
  }
  async array(member:(index:number)=>Promise<void>,out?:JsonSink):Promise<void>{
    await this.expect('[');if(out)await out('[');let index=0;
    if(await this.peek()!==']')for(;;){if(index&&out)await out(',');await member(index++);const next=await this.peek();if(next===']')break;await this.expect(',');}
    await this.expect(']');if(out)await out(']');
  }
  async object(member:(key:string,out:JsonSink|undefined)=>Promise<void>,out?:JsonSink,include?:(key:string)=>boolean,
    tail?:(emit:(key:string,value:unknown)=>Promise<void>)=>Promise<void>):Promise<void>{
    await this.expect('{');if(out)await out('{');let count=0;
    const keyOut=async(key:string)=>{if(!out)return;if(count++)await out(',');await out(JSON.stringify(key)+':');};
    if(await this.peek()!=='}')for(;;){const key=await this.#string(undefined,true);await this.expect(':');const keep=!include||include(key);
      if(keep)await keyOut(key);await member(key,keep?out:undefined);if(await this.peek()==='}')break;await this.expect(',');}
    await this.expect('}');
    if(tail)await tail(async(key,value)=>{await keyOut(key);if(out)await out(JSON.stringify(value));});
    if(out)await out('}');
  }
  async finish(){if(await this.peek()!=="")throw new Error("JSON trailing content");}
}
export const jsonWatchKey=at;
