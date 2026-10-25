import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { operationalStatePath } from "../ops/operational-state-path.ts";
import { CivicReadCache } from "./civic-read-cache.ts";

/** Directly invoked jobs share the same changed-capture cache across processes too. */
export function portraitReadCache():CivicReadCache {
  const url=new URL(process.env.DATABASE_URL!);
  const database=createHash("sha256").update(url.hostname+url.pathname).digest("hex");
  const directory=operationalStatePath(process.env.WTP_PORTRAIT_READ_CACHE_DIR ?? join(tmpdir(),"meanwhile-portrait-read-cache",database));
  return new CivicReadCache({
    read:async key=>{try{return await readFile(join(directory,key),"utf8");}catch{return null;}},
    write:async(key,value)=>{
      await mkdir(directory,{recursive:true});
      const temporary=join(directory,`${key}.${randomUUID()}.tmp`);
      await writeFile(temporary,value,{mode:0o600});await rename(temporary,join(directory,key));
    },
  });
}
