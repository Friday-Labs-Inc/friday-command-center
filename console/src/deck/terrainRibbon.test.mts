import { classifyCost, ribbonStats, sensedBBox } from '/home/friday/fcc-bench/apps/friday_command_center/console/src/deck/terrainRibbon.ts'
import zlib from 'node:zlib'
const W=240,H=240
const g=new Uint8Array(W*H).fill(0xff)
const fill=(x0:number,y0:number,x1:number,y1:number,v:number)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)g[y*W+x]=v}
fill(100,100,140,160,0)     // drive region 40x60=2400 (x100..139, y100..159)
fill(105,105,110,115,40)    // gentle (still 'drive') within
fill(120,120,125,130,60)    // caution 5x10=50
fill(130,130,135,135,100)   // block 5x5=25
const b64 = zlib.deflateSync(Buffer.from(g)).toString('base64')       // zlib-wrapped, like the rover
const bin = Uint8Array.from(atob(b64), c=>c.charCodeAt(0))            // decode like the deck
const cells = new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
const m = {w:W,h:H,res:0.2,ox:-19,oy:-21,cells}
const st = ribbonStats(m); const bb = sensedBBox(m)
console.log('stats', st); console.log('bbox', bb)
console.log('classify 0/40/60/70/100/255 =', classifyCost(0),classifyCost(40),classifyCost(60),classifyCost(70),classifyCost(100),classifyCost(255))
const A=(c:boolean,m:string)=>{if(!c)throw new Error('FAIL '+m)}
A(cells.length===W*H,'decode length')
A(st.sensed===2400,'sensed='+st.sensed)
A(st.block===25,'block='+st.block)
A(st.caution===50,'caution='+st.caution)
A(st.drive===2325,'drive='+st.drive)
A(!!bb && bb.x0===100 && bb.x1===139 && bb.y0===100 && bb.y1===159,'bbox '+JSON.stringify(bb))
A(classifyCost(0)==='drive'&&classifyCost(40)==='drive'&&classifyCost(60)==='caution'&&classifyCost(100)==='block'&&classifyCost(255)==='unknown','classify')
console.log('\nALL RIBBON TESTS PASSED ✅')
