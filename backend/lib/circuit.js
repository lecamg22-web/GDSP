'use strict';
const {parseFastLane,compactFastLane,elevationProfile}=require('../../tools/lib/fastLane');
const {parseSurfaces,parseSectors,parseUiTrack,validateSectors}=require('../../tools/lib/modFiles');
/** Build a versionable circuit round fiche from raw mod files (Buffers/strings). */
function buildCircuitRound({roundId='M1', label='', fastLaneBuffer, surfacesText=null, overlaysText=null, uiTrackText=null, date=null, winner=null}){
  if(!fastLaneBuffer) throw new Error('fast_lane.ai obligatoire');
  const parsed=parseFastLane(fastLaneBuffer);
  const compact=compactFastLane(parsed);
  const ui=uiTrackText?parseUiTrack(uiTrackText):null;
  const lapMeters=compact.totalDistance|| (ui&&ui.length?parseFloat(ui.length):null);
  const sectors=overlaysText?parseSectors(overlaysText, lapMeters):[];
  if(sectors.length && !validateSectors(sectors)) throw new Error('Secteurs invalides: le dernier secteur doit se terminer sur la ligne d\u2019arrivée (fraction 1)');
  return { id:roundId, label:label||'À confirmer',
    date:date||null, dateLabel:date||'Date à confirmer', // NEVER invent a date
    winner:winner||null, winnerLabel:winner||'À confirmer',
    track: ui||{name:'À confirmer'},
    layout:compact, elevation:elevationProfile(compact),
    corners:compact.corners, sectors,
    surfaces:surfacesText?parseSurfaces(surfacesText):[],
    pitCapacity: ui&&ui.pitboxes!=null?ui.pitboxes:null,
    pitCapacityLabel: ui&&ui.pitboxes!=null?String(ui.pitboxes):'À confirmer' };
}
function svgPathFromLayout(layout, {width=600,height=400,padding=20}={}){
  const pts=layout.points; if(!pts||!pts.length) return '';
  const xs=pts.map(p=>p.x), zs=pts.map(p=>p.z);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  const sx=(width-2*padding)/((maxX-minX)||1), sz=(height-2*padding)/((maxZ-minZ)||1), s=Math.min(sx,sz);
  const proj=p=>`${(padding+(p.x-minX)*s).toFixed(1)},${(height-padding-(p.z-minZ)*s).toFixed(1)}`;
  return `M${pts.map(proj).join(' L')} Z`;
}
module.exports={buildCircuitRound,svgPathFromLayout};
