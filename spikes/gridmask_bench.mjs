import fs from 'node:fs';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import bboxClip from '@turf/bbox-clip';
import area from '@turf/area';
import { polygon as tPolygon, featureCollection, point } from '@turf/helpers';

const RES = 0.05, ORIGIN = -179.975;               // CRW 5 km grid: cell centres at ORIGIN + k*RES
const snap = v => Math.round((v - ORIGIN) / RES);  // centre index
const centre = k => ORIGIN + k * RES;

// polygon parts as arrays of rings, each ring [[x,y],...]; plus per-part bbox
function parts(gj) {
  const out = [];
  for (const f of gj.features) {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of polys) {
      let xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9;
      for (const [x,y] of rings[0]) { if(x<xmin)xmin=x; if(x>xmax)xmax=x; if(y<ymin)ymin=y; if(y>ymax)ymax=y; }
      out.push({ rings, bbox:[xmin,ymin,xmax,ymax], feat: tPolygon(rings) });
    }
  }
  return out;
}

// candidate grid cells = union over parts of cells whose centre lies in the part bbox
function candidates(ps) {
  const set = new Map();
  for (const p of ps) {
    const [x0,y0,x1,y1] = p.bbox;
    for (let i = snap(x0); i <= snap(x1); i++) for (let j = snap(y0); j <= snap(y1); j++) set.set(i+','+j, [i,j]);
  }
  return [...set.values()];
}

// A) turf point-in-polygon per candidate (with part-bbox prefilter)
function maskTurf(ps, cands) {
  const m = new Set();
  for (const [i,j] of cands) {
    const x = centre(i), y = centre(j);
    for (const p of ps) {
      const [x0,y0,x1,y1] = p.bbox;
      if (x<x0||x>x1||y<y0||y>y1) continue;
      if (booleanPointInPolygon([x,y], p.feat)) { m.add(i+','+j); break; }
    }
  }
  return m;
}

// B) scanline: for each grid row (lat), collect x-crossings of all rings, fill between pairs
function maskScan(ps) {
  const m = new Set();
  for (const p of ps) {
    const [ , y0, , y1] = p.bbox;
    for (let j = snap(y0); j <= snap(y1); j++) {
      const y = centre(j), xs = [];
      for (const ring of p.rings) {
        for (let k = 0, n = ring.length - 1; k < n; k++) {
          const [ax,ay] = ring[k], [bx,by] = ring[k+1];
          if ((ay > y) !== (by > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
        }
      }
      xs.sort((a,b)=>a-b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let i = Math.ceil((xs[k]-ORIGIN)/RES); i <= Math.floor((xs[k+1]-ORIGIN)/RES); i++) m.add(i+','+j);
    }
  }
  return m;
}

// C) boundary-cell area weights: cells whose square touches the polygon get weight = intersect area / cell area
function weights(ps, mask) {
  const w = new Map(); let nBoundary = 0;
  const all = new Set(mask);
  // consider mask cells and their 8-neighbours (cells partially inside but centre outside)
  for (const key of mask) { const [i,j] = key.split(',').map(Number);
    for (let di=-1;di<=1;di++) for (let dj=-1;dj<=1;dj++) all.add((i+di)+','+(j+dj)); }
  for (const key of all) {
    const [i,j] = key.split(',').map(Number);
    const x = centre(i), y = centre(j), h = RES/2;
    const cell = tPolygon([[[x-h,y-h],[x+h,y-h],[x+h,y+h],[x-h,y+h],[x-h,y-h]]]);
    const cellArea = area(cell); let a = 0;
    for (const p of ps) {
      const [x0,y0,x1,y1] = p.bbox; if (x+h<x0||x-h>x1||y+h<y0||y-h>y1) continue;
      const ix = bboxClip(p.feat, [x-h,y-h,x+h,y+h]); a += area(ix);
    }
    const f = a / cellArea; if (f > 0) { w.set(key, Math.min(f,1)); if (f < 0.999) nBoundary++; }
  }
  return { w, nBoundary };
}

for (const name of ['HIHWNMS','CINMS','FKNMS','PMNM']) {
  const gj = JSON.parse(fs.readFileSync(name+'.geojson'));
  const ps = parts(gj); const nv = ps.reduce((s,p)=>s+p.rings.reduce((t,r)=>t+r.length,0),0);
  const cands = candidates(ps);
  let t = performance.now(); const a = maskTurf(ps, cands); const tA = performance.now()-t;
  t = performance.now(); const b = maskScan(ps); const tB = performance.now()-t;
  let same = a.size===b.size && [...a].every(k=>b.has(k));
  t = performance.now(); const {w, nBoundary} = weights(ps, b); const tC = performance.now()-t;
  const wsum = [...w.values()].reduce((s,v)=>s+v,0);
  console.log(`${name.padEnd(8)} parts=${ps.length} vertices=${nv} bboxCells=${cands.length} inside: turf=${a.size} scan=${b.size} agree=${same} | turf ${tA.toFixed(0)} ms, scan ${tB.toFixed(1)} ms | weights: cells=${w.size} boundary=${nBoundary} sumW=${wsum.toFixed(1)} in ${tC.toFixed(0)} ms`);
}
