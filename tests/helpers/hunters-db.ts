import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {BOOTSTRAP_DDL,CONTROL_READS_EXPAND_DDL} from '../../lib/control-plane/repository/pg-schema.ts';
import type {FactDb,Query} from '../../lib/facts/publish.ts';

/** The real reader migrations and control-plane schema, with no substitute tables or views. */
export async function factDb():Promise<FactDb & {query:Query;pg:PGlite}>{
 const pg=new PGlite();
 const directory=join(import.meta.dirname,'../../lib/db/migrations');
 const journal=JSON.parse(readFileSync(join(directory,'meta/_journal.json'),'utf8')) as {entries:{tag:string}[]};
 for(const migration of journal.entries)for(const statement of readFileSync(join(directory,migration.tag+'.sql'),'utf8').split('--> statement-breakpoint'))if(statement.trim())await pg.exec(statement);
 // PGlite has one connection. The production index definitions are identical;
 // only the online-build keyword is unnecessary in this empty test database.
 for(const statement of [...BOOTSTRAP_DDL,...CONTROL_READS_EXPAND_DDL])await pg.exec(statement.replaceAll('CREATE INDEX CONCURRENTLY','CREATE INDEX').replaceAll('CREATE UNIQUE INDEX CONCURRENTLY','CREATE UNIQUE INDEX'));
 const query:Query=async(text,params=[])=>(await pg.query<Record<string,unknown>>(text,[...params])).rows;
 return {pg,query,transaction:work=>pg.transaction(tx=>work(async(text,params=[])=>(await tx.query<Record<string,unknown>>(text,[...params])).rows))};
}
