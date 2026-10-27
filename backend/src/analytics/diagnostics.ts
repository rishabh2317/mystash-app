import type { SupabaseClient } from '@supabase/supabase-js';
import { analyticsEnabled } from './flags';
type Metric='payload_rejected_batches'|'rate_limited_events'|'write_failed_batches';
/** Minute-buffered operational counts; no payloads, identities or addresses. */
export class MeasurementDiagnostics {
  private counts=new Map<Metric,number>();private busy=false;
  add(name:Metric,n=1){this.counts.set(name,Math.min(1000000,(this.counts.get(name)??0)+n));}
  async flush(admin:SupabaseClient){
    if(this.busy||!analyticsEnabled())return;this.busy=true;
    try {for(const [metric,n] of [...this.counts]){
      this.counts.delete(metric);
      try{const {error}=await admin.rpc('analytics_health',{p_metric:metric,p_delta:n});if(error)this.add(metric,n);}
      catch{this.add(metric,n);}
    }}finally{this.busy=false;}
  }
}
