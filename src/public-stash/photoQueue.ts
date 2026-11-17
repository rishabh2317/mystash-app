/** Bounds public provider demand without caching Google resources or changing private images. */
const waiting:{cancelled:boolean;work:()=>Promise<void>}[]=[];
let active=0;
function drain(){
 while(active<4&&waiting.length){
  const task=waiting.shift()!;if(task.cancelled)continue;
  active++;
  void task.work().catch(()=>{}).finally(()=>{active--;drain();});
 }
}
export function queuePublicPhoto(work:()=>Promise<void>){
 const task={cancelled:false,work};
 if(waiting.length>=128)return()=>{};
 waiting.push(task);drain();return()=>{task.cancelled=true;};
}
