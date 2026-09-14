import fs from 'node:fs';
import squareGrid from '@turf/square-grid';
import pointGrid from '@turf/point-grid';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import bboxClip from '@turf/bbox-clip';
import area from '@turf/area';
import { polygon as tPolygon } from '@turf/helpers';

const RES = 0.05, ORIGIN = -179.975;
const snap = v => Math.round((v - ORIGIN) / RES), centre = k => ORIGIN + k * RES;
const key = (x,y) => snap(x)+','+snap(y);

function parts(gj){ const out=[]; for(const f of gj.features){ const g=f.geometry; const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  for(const rings of polys){ let xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9; for(const [x,y] of rings[0]){ if(x<xmin)xmin=x; if(x>xmax)xmax=x; if(y<ymin)ymin=y; if(y>ymax)ymax=y; }
    out.push({rings,bbox:[xmin,ymin,xmax,ymax],feat:tPolygon(rings)}); } } return out; }
// bbox snapped outward to ERDDAP cell EDGES so turf's grid starts on an edge with no centring offset
const edgeBbox = ([x0,y0,x1,y1]) => [centre(snap(x0))-RES/2, centre(snap(y0))-RES/2, centre(snap(x1))+RES/2, centre(snap(y1))+RES/2];
// reference scanline mask (from bench.mjs)
function maskScan(ps){ const m=new Set(); for(const p of ps){ const [,y0,,y1]=p.bbox; for(let j=snap(y0);j<=snap(y1);j++){ const y=centre(j),xs=[];
  for(const ring of p.rings) for(let k=0,n=ring.length-1;k<n;k++){ const [ax,ay]=ring[k],[bx,by]=ring[k+1]; if((ay>y)!==(by>y)) xs.push(ax+(y-ay)*(bx-ax)/(by-ay)); }
  xs.sort((a,b)=>a-b); for(let k=0;k+1<xs.length;k+=2) for(let i=Math.ceil((xs[k]-ORIGIN)/RES);i<=Math.floor((xs[k+1]-ORIGIN)/RES);i++) m.add(i+','+j); } } return m; }

for (const name of ['HIHWNMS','CINMS','FKNMS','PMNM']) {
  const ps = parts(JSON.parse(fs.readFileSync(name+'.geojson')));
  const ref = maskScan(ps);
  // 1) pointGrid per part + booleanPointInPolygon; check alignment of generated points to ERDDAP centres
  let t=performance.now(); const pg=new Set(); let misaligned=0, nPts=0;
  for(const p of ps){ const grid=pointGrid(edgeBbox(p.bbox), RES, {units:'degrees'});
    for(const f of grid.features){ const [x,y]=f.geometry.coordinates; nPts++;
      const cx=x+RES/2, cy=y+RES/2;   // pointGrid emits the grid origin corner of each cell; shift to centre
      if(Math.abs(cx-centre(snap(cx)))>1e-6||Math.abs(cy-centre(snap(cy)))>1e-6) misaligned++;
      if(booleanPointInPolygon([cx,cy],p.feat)) pg.add(key(cx,cy)); } }
  const tPG=performance.now()-t;
  // 2) squareGrid with mask option (cells intersecting the polygon), then centre-inside + area weights
  t=performance.now(); let sqCells=0, sqInside=new Set(), wsum=0, nBoundary=0, misSq=0;
  for(const p of ps){ const grid=squareGrid(edgeBbox(p.bbox), RES, {units:'degrees', mask:p.feat}); sqCells+=grid.features.length;
    for(const f of grid.features){ const r=f.geometry.coordinates[0]; const cx=(r[0][0]+r[2][0])/2, cy=(r[0][1]+r[2][1])/2;
      if(Math.abs(cx-centre(snap(cx)))>1e-6) misSq++;
      if(booleanPointInPolygon([cx,cy],p.feat)) sqInside.add(key(cx,cy));
      const w=area(bboxClip(p.feat,[r[0][0],r[0][1],r[2][0],r[2][1]]))/area(f); wsum+=w; if(w<0.999) nBoundary++; } }
  const tSQ=performance.now()-t;
  const agreePG = pg.size===ref.size && [...pg].every(k=>ref.has(k));
  const agreeSQ = sqInside.size===ref.size && [...sqInside].every(k=>ref.has(k));
  console.log(`${name.padEnd(8)} ref=${ref.size} | pointGrid: pts=${nPts} inside=${pg.size} agree=${agreePG} misaligned=${misaligned} ${tPG.toFixed(0)} ms | squareGrid(mask): cells=${sqCells} centreInside=${sqInside.size} agree=${agreeSQ} misaligned=${misSq} boundary=${nBoundary} sumW=${wsum.toFixed(1)} ${tSQ.toFixed(0)} ms`);
}
