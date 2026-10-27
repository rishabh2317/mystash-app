export function visibleFraction(x:number,y:number,width:number,height:number,viewportWidth:number,top:number,bottom:number):number {
  if(![x,y,width,height,viewportWidth,top,bottom].every(Number.isFinite)||width<=0||height<=0)return 0;
  const horizontal=Math.max(0,Math.min(x+width,viewportWidth)-Math.max(x,0));
  const vertical=Math.max(0,Math.min(y+height,bottom)-Math.max(y,top));
  return horizontal*vertical/(width*height);
}
export class ExposureDwell {
  private since:number|null=null;private last:number|null=null;
  reset(){this.since=null;this.last=null;}
  observe(fraction:number,foreground:boolean,now:number){
    if(!foreground||fraction<0.5||!Number.isFinite(fraction)){this.reset();return false;}
    if(this.last===null||now<this.last||now-this.last>750)this.since=now;
    this.last=now;return this.since!==null&&now-this.since>=1000;
  }
}
