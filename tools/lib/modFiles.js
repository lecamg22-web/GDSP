'use strict';
function parseIni(text){
  const sections={}; let current=null;
  for(const rawLine of String(text).split(/\r?\n/)){
    const line=rawLine.replace(/;.*$/,'').trim(); if(!line) continue;
    const sec=line.match(/^\[(.+)\]$/); if(sec){ current=sec[1].trim(); sections[current]={}; continue; }
    const kv=line.match(/^([^=]+)=(.*)$/); if(kv&&current) sections[current][kv[1].trim().toUpperCase()]=kv[2].trim();
  }
  return sections;
}
/** surfaces.ini: the surface NAME is the KEY= value, never the [SURFACE_n] header. */
function parseSurfaces(text){
  const ini=parseIni(text);
  return Object.entries(ini).filter(([name])=>/^SURFACE_/i.test(name)).map(([,v])=>({
    name:v.KEY||'À confirmer', friction:v.FRICTION!=null?Number(v.FRICTION):null,
    damping:v.DAMPING!=null?Number(v.DAMPING):null, validity:v.VALIDITY!=null?v.VALIDITY:null,
    isValidTrack:v.IS_VALID_TRACK!=null?Number(v.IS_VALID_TRACK)===1:null }));
}
/** overlays.ini: each [SECTOR_n] START is the START of sector n. N starts => N sectors, covering the whole lap. */
function parseSectors(text, lapLength=null){
  const ini=parseIni(text);
  const starts=Object.entries(ini).filter(([name])=>/^SECTOR_\d+$/i.test(name))
    .map(([name,v])=>({sector:Number(name.split('_')[1]), startMeters:Number(v.START??v.START_POSITION??0)}))
    .filter(s=>Number.isFinite(s.startMeters)).sort((a,b)=>a.startMeters-b.startMeters);
  if(!starts.length) return [];
  const total = lapLength || Math.max(...starts.map(s=>s.startMeters))*1.25; // caller should pass real lap length
  return starts.map((s,i)=>{ const next=starts[i+1];
    const endMeters = next?next.startMeters:total; // last sector ALWAYS closes on the finish line
    return { number:i+1, startMeters:s.startMeters, endMeters,
      startFraction:Math.round(s.startMeters/total*10000)/10000,
      endFraction: next?Math.round(next.startMeters/total*10000)/10000:1 }; });
}
function sectorsFromFractions(startFractions){
  const starts=[...startFractions].sort((a,b)=>a-b);
  return starts.map((start,i)=>({number:i+1,startFraction:start,endFraction:starts[i+1]??1}));
}
function parseUiTrack(text){
  const j=JSON.parse(text);
  return { name:j.name||'À confirmer', city:j.city||null, country:j.country||null,
    length:j.length||null, width:j.width||null, pitboxes:j.pitboxes!=null?Number(j.pitboxes):null,
    description:j.description||null };
}
function validateSectors(sectors){
  if(!sectors.length) return false;
  if(sectors[0].startFraction!==0 && sectors[0].startFraction>0.001) return false;
  for(let i=0;i<sectors.length;i++){ if(sectors[i].endFraction<=sectors[i].startFraction) return false;
    if(i&&Math.abs(sectors[i].startFraction-sectors[i-1].endFraction)>0.0001) return false; }
  return sectors[sectors.length-1].endFraction===1;
}
module.exports={parseIni,parseSurfaces,parseSectors,sectorsFromFractions,parseUiTrack,validateSectors};
