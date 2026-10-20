/** A repeatable disk-backed sequence. Views stream one row and never retain the containing collection. */
export class DiskRows<T> implements Iterable<T> {
  private readonly rows: () => Iterable<T>;
  private readonly count?: () => number;
  constructor(rows: () => Iterable<T>, count?: () => number) { this.rows=rows;this.count=count; }
  [Symbol.iterator](): Iterator<T> { return this.rows()[Symbol.iterator](); }
  get length(): number { if(this.count)return this.count();let n=0;for(const _row of this)n++;return n; }
  async visit(visit: (row:T,index:number)=>void|Promise<void>): Promise<void> {let n=0;for(const row of this)await visit(row,n++);}
  map<U>(map:(row:T,index:number)=>U):DiskRows<U> {return new DiskRows(function*(this:DiskRows<T>){let n=0;for(const row of this)yield map(row,n++);}.bind(this),()=>this.length);}
  filter(keep:(row:T,index:number)=>unknown):DiskRows<T> {return new DiskRows(function*(this:DiskRows<T>){let n=0;for(const row of this)if(keep(row,n++))yield row;}.bind(this));}
  flatMap<U>(map:(row:T,index:number)=>Iterable<U>):DiskRows<U> {return new DiskRows(function*(this:DiskRows<T>){let n=0;for(const row of this)yield*map(row,n++);}.bind(this));}
  slice(start=0,end=Infinity):DiskRows<T> {return new DiskRows(function*(this:DiskRows<T>){let n=0;const count=start<0||end<0?this.length:0,from=start<0?Math.max(0,count+start):start,through=end<0?Math.max(0,count+end):end;for(const row of this){if(n>=through)break;if(n++>=from)yield row;}}.bind(this));}
  some(test:(row:T,index:number)=>boolean):boolean {let n=0;for(const row of this)if(test(row,n++))return true;return false;}
  every(test:(row:T,index:number)=>boolean):boolean {let n=0;for(const row of this)if(!test(row,n++))return false;return true;}
  find(test:(row:T,index:number)=>boolean):T|undefined {let n=0;for(const row of this)if(test(row,n++))return row;return undefined;}
  reduce<U>(reduce:(held:U,row:T,index:number)=>U,initial:U):U {let n=0,held=initial;for(const row of this)held=reduce(held,row,n++);return held;}
  forEach(visit:(row:T,index:number)=>void):void {let n=0;for(const row of this)visit(row,n++);}
}
