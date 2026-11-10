'use strict';
/** fast_lane.ai: header 16 bytes = 4 x int32 LE [version,count,0,0];
 *  then count records of 20 bytes: float32 x, y(altitude), z, distance, uint32 id. */
function parseFastLane(buffer){
  if(!Buffer.isBuffer(buffer)) buffer=Buffer.from(buffer);
  if(buffer.length<16) throw new Error('fast_lane.ai tronqué (en-tête)');
  const version=buffer.readInt32LE(0), count=buffer.readInt32LE(4);
  if(count<0 || 16+count*20>buffer.length) throw new Error(`fast_lane.ai tronqué: ${count} points annoncés`);
  const points=[];
  for(let i=0;i<count;i++){ const o=16+i*20;
    points.push({x:buffer.readFloatLE(o), y:buffer.readFloatLE(o+4), z:buffer.readFloatLE(o+8), distance:buffer.readFloatLE(o+12), id:buffer.readUInt32LE(o+16)}); }
  return {version,count,points};
}
function smooth(values, window=5){
  const half=Math.floor(window/2), out=[];
  for(let i=0;i<values.length;i++){ let s=0,n=0; for(let k=-half;k<=half;k++){ const v=values[(i+k+values.length)%values.length]; s+=v; n++; } out.push(s/n); }
  return out;
}
/** Corner detection MUST run on the full-resolution line: curvature peaks on the smoothed signal. */
function detectCorners(points, {threshold=0.04, minLapFractionGap=0.015, smoothWindow=9}={}){
  const n=points.length; if(n<10) return [];
  const stride=Math.max(1,Math.floor(n/720)); // direction change over a look-ahead window: resolution-independent
  const raw=[];
  for(let i=0;i<n;i++){
    const a=points[(i-stride+n)%n], b=points[i], c=points[(i+stride)%n];
    const v1x=b.x-a.x, v1z=b.z-a.z, v2x=c.x-b.x, v2z=c.z-b.z;
    const m1=Math.hypot(v1x,v1z)||1, m2=Math.hypot(v2x,v2z)||1;
    const cos=Math.max(-1,Math.min(1,(v1x*v2x+v1z*v2z)/(m1*m2)));
    raw.push(Math.acos(cos));
  }
  const curv=smooth(raw,smoothWindow);
  const totalDistance = points[n-1].distance>0 ? points[n-1].distance : n;
  const peaks=[];
  for(let i=0;i<n;i++){
    const prev=curv[(i-1+n)%n], cur=curv[i], next=curv[(i+1)%n];
    if(cur>threshold && cur>=prev && cur>=next) peaks.push({index:i,curvature:cur});
  }
  peaks.sort((a,b)=>b.curvature-a.curvature);
  const kept=[];
  for(const p of peaks){ const frac=(points[p.index].distance||p.index)/totalDistance;
    if(kept.every(k=>Math.abs(k.lapFraction-frac)>minLapFractionGap && Math.abs(k.lapFraction-frac)<1-minLapFractionGap))
      kept.push({number:0, lapFraction:Math.round(frac*10000)/10000, curvature:Math.round(p.curvature*1000)/1000}); }
  return kept.sort((a,b)=>a.lapFraction-b.lapFraction).map((c,i)=>({...c,number:i+1}));
}
const round1=v=>Math.round(v*10)/10;
/** Compact to ~target points (x/y/z at 0.1 m) + corners as lap fractions. Corners detected BEFORE decimation. */
function compactFastLane(parsed, {targetPoints=220}={}){
  const points=parsed.points||parsed;
  const corners=detectCorners(points);
  const step=Math.max(1, Math.floor(points.length/targetPoints));
  const sampled=[]; for(let i=0;i<points.length;i+=step) sampled.push(points[i]);
  if(sampled[sampled.length-1]!==points[points.length-1]) sampled.push(points[points.length-1]);
  const total=points[points.length-1].distance||points.length;
  return { version:1, pointCount:sampled.length, sourcePointCount:points.length, totalDistance:round1(total),
    points:sampled.map(p=>({x:round1(p.x),y:round1(p.y),z:round1(p.z),
      lapFraction:Math.round(((p.distance||0)/(total||1))*10000)/10000})),
    corners };
}
function elevationProfile(compact, samples=60){
  const pts=compact.points, out=[];
  for(let i=0;i<samples;i++){ const p=pts[Math.floor(i/samples*pts.length)]; out.push({lapFraction:Math.round(i/samples*10000)/10000, altitude:p.y}); }
  return out;
}
module.exports={parseFastLane,detectCorners,compactFastLane,elevationProfile,smooth};
