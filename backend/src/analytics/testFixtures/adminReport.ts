import {EXTRACTION_KEYS,SNAPSHOT_KEYS,type RawAdminReport} from '../adminReport';
export function adminFixture():RawAdminReport{return {
 days:7,end_day:'2026-03-10',generated_at:'2026-03-10T12:00:00Z',refreshed_at:'2026-03-10T11:59:00Z',daily:[],breakdowns:[],coverage:[],health:[],
 activity:{active_24h:0,active_7d:0,windows_24h:0,windows_7d:0},snapshot:Object.fromEntries(SNAPSHOT_KEYS.map(k=>[k,0])) as RawAdminReport['snapshot'],
 extraction:Object.fromEntries(EXTRACTION_KEYS.map(k=>[k,0])) as RawAdminReport['extraction'],source_statuses:[],ingest_statuses:[],reconciliation:null,
};}
export function fullAdminCoverage(raw:RawAdminReport){
 raw.coverage=Array.from({length:raw.days*2},(_,i)=>({day:new Date(Date.parse(`${raw.end_day}T00:00:00Z`)-(raw.days*2-i)*86400000).toISOString().slice(0,10),windows:288}));return raw;
}
