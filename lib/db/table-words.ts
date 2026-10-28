/** Human labels for the small transfer meter's table names. */
export const tableWords=(value:string)=>value.split(',').map(table=>{
  const key=table.split(':')[0].replace(/^civic_data_/,'');
  return ({payload_parts:'Published record parts',promotions:'Published records',candidates:'Record versions',candidate_events:'Publication history',
    clock_versions:'Source update times',owner_flag:'Flagged facts',fact:'Facts',source_copy:'Saved sources',socket:'Connection',query:'Database query'} as Record<string,string>)[key]
    ??table.replace(/\.m?[jt]s$/,'').replaceAll(/[_:-]+/g,' ');
}).join(', ');
