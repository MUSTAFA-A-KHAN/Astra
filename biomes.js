const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export function hash(x,z,seed=0) {let n=Math.imul(x|0,374761393)+Math.imul(z|0,668265263)+Math.imul(seed|0,144269);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
export function noise(x,z,seed=0) {
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
  return (hash(ix,iz,seed)*(1-u)+hash(ix+1,iz,seed)*u)*(1-v)+(hash(ix,iz+1,seed)*(1-u)+hash(ix+1,iz+1,seed)*u)*v;
}
export const BIOMES=Object.freeze({
  forest:{name:'Forest',material:'grass',vegetation:.82,trees:.9,rocks:.1,color:'#506440',fog:1.06,ambience:'forest',wildlife:'deer',flowers:.08},
  meadow:{name:'Meadow',material:'grass',vegetation:1,trees:.14,rocks:.08,color:'#7d8051',fog:1,ambience:'wind',wildlife:'birds',flowers:.4},
  mountain:{name:'Mountain',material:'rock',vegetation:.2,trees:.12,rocks:.8,color:'#777c72',fog:.9,ambience:'wind',wildlife:'birds',flowers:.03},
  rocky:{name:'Rocky uplands',material:'rock',vegetation:.22,trees:.18,rocks:.85,color:'#79766b',fog:1,ambience:'wind',wildlife:'birds',flowers:.03},
  river:{name:'Riverbank',material:'mud',vegetation:.9,trees:.24,rocks:.3,color:'#62694b',fog:1.08,ambience:'water',wildlife:'birds',flowers:.12},
  lake:{name:'Stillwater',material:'water',vegetation:0,trees:0,rocks:0,color:'#536f6b',fog:1.05,ambience:'water',wildlife:'birds',flowers:0},
  plains:{name:'High plains',material:'grass',vegetation:.6,trees:.06,rocks:.14,color:'#898462',fog:.96,ambience:'wind',wildlife:'deer',flowers:.1},
  ruins:{name:'Sanctuary ruins',material:'dirt',vegetation:.3,trees:.08,rocks:.16,color:'#7b7c62',fog:1,ambience:'forest',wildlife:'birds',flowers:.12},
});

export class BiomeManager {
  constructor(terrain) {this.terrain=terrain;this.normal={x:0,y:1,z:0};}
  sample(x,z,out={}) {
    const height=this.terrain.getHeight(x,z);
    this.terrain.getNormal(x,z,this.normal);
    const slope=1-this.normal.y,moisture=noise(x*.005,z*.005,71),temperature=clamp(.8-height*.003+noise(x*.002,z*.002,31)*.2);
    const waterLevel=this.terrain.getWaterLevel?.(x,z);
    const waterDistance=Math.abs(Math.hypot((x+54)/19,(z+38)/12)-1)*15;
    let key='meadow';
    if(waterLevel!=null && height<waterLevel)key='lake';
    else if(waterDistance<4)key='river';
    else if(slope>.21)key='rocky';
    else if(height>65)key='mountain';
    else if(Math.hypot(x,z+59)<24)key='ruins';
    else if(moisture>.47 && height<62)key='forest';
    else if(moisture<.3)key='plains';
    Object.assign(out,BIOMES[key]);out.key=key;out.height=height;out.slope=slope;out.moisture=moisture;out.temperature=temperature;out.waterDistance=waterDistance;
    return out;
  }
}
