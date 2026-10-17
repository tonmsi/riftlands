import './respawn-transition.css';

/** Hide camera relocation until the destination has rendered underneath black. */
export class RespawnTransition {
  private readonly veil=document.createElement('div');
  private phase:'idle'|'out'|'prepare'|'covered'|'in'='idle';
  private since=0;
  private readonly reduced=matchMedia('(prefers-reduced-motion: reduce)');
  constructor(private readonly clock=()=>performance.now()){
    this.veil.className='respawn-veil';this.veil.setAttribute('aria-hidden','true');document.body.append(this.veil);
  }
  get blocked():boolean{return this.phase!=='idle';}
  get holdCamera():boolean{return this.phase==='out';}
  start():void {
    this.phase='out';this.since=this.clock();this.veil.classList.add('active','covered');
  }
  /** True once, when the screen has faded to black and the camera may snap. */
  placeCamera():boolean {
    if(this.phase!=='out'||this.clock()-this.since<(this.reduced.matches?0:160))return false;
    this.phase='prepare';return true;
  }
  rendered():void {
    if(this.phase==='prepare'){this.phase='covered';this.since=this.clock();}
    else if(this.phase==='covered'&&this.clock()-this.since>=60){
      this.phase='in';this.since=this.clock();this.veil.classList.remove('covered');
    }else if(this.phase==='in'&&this.clock()-this.since>=(this.reduced.matches?0:160))this.cancel();
  }
  cancel():void {this.phase='idle';this.veil.classList.remove('active','covered');}
  destroy():void {this.cancel();this.veil.remove();}
}
